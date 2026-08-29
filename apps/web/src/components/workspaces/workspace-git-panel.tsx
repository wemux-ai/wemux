// [INPUT]: A task-scoped workspace session and its project Git capabilities.
// [OUTPUT]: Source Control changes, staged commits, history, rebase, and PR workspace UI.
// [POS]: Reusable Git panel embedded by workspace detail and workspace session list pages.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type {
  ExecutorGitCommitDiffResult,
  ExecutorGitChange,
  ExecutorGitFileDiffResult,
  ExecutorGitGraphResult,
  ProjectVersionControl,
  ExecutorGitRebaseResult,
  TaskGitPullRequestResult,
  ExecutorGitWorkingTreeDiffResult,
  WorkspaceSession,
  Workspace,
} from '@shared/types'
import { ArrowUpRight, Check, ChevronDown, FileCode2, GitBranch, GitPullRequest, Loader2, MoreHorizontal, RefreshCw, RotateCcw, Trash2, Undo2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import type { Task } from '@shared/types'
import { resolveWorkspaceSessionExecutorId } from '@shared/task-workspace'
import { api } from '../../lib/api'
import { useApp } from '../../lib/app-provider'
import { useTranslation } from '../../lib/i18n/react'
import { applyTaskPullRequestResult } from '../../lib/task-pull-request'
import { cn } from '../../lib/utils'
import { buildWorkspaceGitScopeKey, workspaceQueryKeys } from '../../lib/workspace-query-keys'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { Input } from '../ui/input'
import { SearchableSelect } from '../ui/searchable-select'
import { ScrollArea } from '../ui/scroll-area'
import { Textarea } from '../ui/textarea'
import { WorkspaceGitGraph } from './workspace-git-graph'
import { buildWorkspacePanelUiScopeKey, useWorkspacePanelUiField } from './workspace-panel-ui-store'
import { useWorkspaceSidePanelHeaderActions } from './workspace-side-panel-header-actions'
import { WorkspaceUnifiedDiff } from './workspace-unified-diff'

const emptyWorkingTreeDiffResult = (): ExecutorGitWorkingTreeDiffResult => ({
  ok: false,
  message: '',
  currentBranch: '',
  files: [],
  patch: '',
})

const emptyCommitDiffResult = (commitSha: string): ExecutorGitCommitDiffResult => ({
  ok: false,
  message: '',
  commitSha,
  files: [],
  patch: '',
})

const emptyGraphResult = (baseBranch: string): ExecutorGitGraphResult => ({
  ok: false,
  message: '',
  baseBranch,
  currentBranch: '',
  limit: 40,
  commitCount: 0,
  graph: '',
  commits: [],
})

const WORKSPACE_GIT_DIFF_CACHE_TTL_MS = 10_000
const WORKSPACE_GIT_GRAPH_CACHE_TTL_MS = 15_000
const WORKSPACE_GIT_COMMIT_DIFF_CACHE_TTL_MS = 30_000

type WorkspaceGitPanelProps = {
  task: Task | null
  workspace: Workspace | null
  workspaceSession: WorkspaceSession | null
  projectDefaultBranch?: string
  versionControl?: ProjectVersionControl
  uiScopeKey?: string
  className?: string
}

type GitPanelTab = 'diff' | 'graph' | 'commit-diff'

export function WorkspaceGitPanel({
  task,
  workspace,
  workspaceSession,
  projectDefaultBranch,
  versionControl,
  uiScopeKey,
  className,
}: WorkspaceGitPanelProps) {
  const { t } = useTranslation()
  const { setState } = useApp()
  const queryClient = useQueryClient()
  const headerActions = useWorkspaceSidePanelHeaderActions()
  const panelUiScopeKey = uiScopeKey || buildWorkspacePanelUiScopeKey({
    workspaceId: workspace?.id,
    workspaceSessionId: workspaceSession?.id,
    panel: 'git',
  })
  const [activeTab, setActiveTab] = useWorkspacePanelUiField(panelUiScopeKey, 'git', 'activeTab', 'diff')
  const [graphLimit, setGraphLimit] = useWorkspacePanelUiField(panelUiScopeKey, 'git', 'graphLimit', 40)
  const [selectedGraphCommitSha, setSelectedGraphCommitSha] = useWorkspacePanelUiField(panelUiScopeKey, 'git', 'selectedGraphCommitSha', '')
  const [workingTreeDiffResult, setWorkingTreeDiffResult] = useState<ExecutorGitWorkingTreeDiffResult | null>(null)
  const [gitStatusChanges, setGitStatusChanges] = useState<ExecutorGitChange[]>([])
  const [selectedChange, setSelectedChange] = useState<ExecutorGitChange | null>(null)
  const [fileDiffResult, setFileDiffResult] = useState<ExecutorGitFileDiffResult | null>(null)
  const [graphResult, setGraphResult] = useState<ExecutorGitGraphResult | null>(null)
  const [rebaseResult, setRebaseResult] = useState<ExecutorGitRebaseResult | null>(null)
  const [pullRequestResult, setPullRequestResult] = useState<TaskGitPullRequestResult | null>(null)
  const [commitDiffResult, setCommitDiffResult] = useState<ExecutorGitCommitDiffResult | null>(null)
  const [pullRequestTitle, setPullRequestTitle] = useState('')
  const [pullRequestBody, setPullRequestBody] = useState('')
  const [pullRequestDialogOpen, setPullRequestDialogOpen] = useState(false)
  const [diffLoading, setDiffLoading] = useState(false)
  const [graphLoading, setGraphLoading] = useState(false)
  const [rebaseLoading, setRebaseLoading] = useState(false)
  const [pullRequestLoading, setPullRequestLoading] = useState(false)
  const [pullRequestStatusLoading, setPullRequestStatusLoading] = useState(false)
  const [commitDiffLoading, setCommitDiffLoading] = useState(false)
  const [gitStatusLoading, setGitStatusLoading] = useState(false)
  const [fileDiffLoading, setFileDiffLoading] = useState(false)
  const [gitActionLoading, setGitActionLoading] = useState(false)
  const [commitLoading, setCommitLoading] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [discardPaths, setDiscardPaths] = useState<string[]>([])
  const [rebaseDialogOpen, setRebaseDialogOpen] = useState(false)
  const [rebaseTargetBranch, setRebaseTargetBranch] = useState('')
  const [rebaseBranchOptions, setRebaseBranchOptions] = useState<string[]>([])
  const [rebaseBranchLoading, setRebaseBranchLoading] = useState(false)
  const [rebaseBranchMessage, setRebaseBranchMessage] = useState('')

  const baseBranch = useMemo(
    () => workspace?.codeBaseBranch || workspaceSession?.baseBranch || task?.baseBranch || task?.baseBranchHint || workspace?.suggestedBaseBranch || workspace?.defaultBranch || projectDefaultBranch || 'main',
    [projectDefaultBranch, task?.baseBranch, task?.baseBranchHint, workspace?.codeBaseBranch, workspace?.defaultBranch, workspace?.suggestedBaseBranch, workspaceSession?.baseBranch],
  )
  const compareBranch = workspace?.codeBranchName || workspaceSession?.branchName || ''
  const displayBaseBranch = graphResult?.baseBranch || rebaseResult?.baseBranch || baseBranch
  const displayCompareBranch = workingTreeDiffResult?.currentBranch || graphResult?.currentBranch || rebaseResult?.currentBranch || compareBranch
  const gitAvailable = versionControl !== 'none'
  const remoteGitEnabled = versionControl === 'git-remote'
  const publishPolicy = workspaceSession?.publishPolicy ?? (remoteGitEnabled ? 'pull-request' : 'none')
  const gitAuthPreference = workspaceSession?.gitAuthPreference ?? 'project-default'
  const pullRequestAllowed = publishPolicy === 'pull-request'
  const originalDirReady = workspaceSession?.workingDirectoryMode === 'original-dir' && Boolean(workspace?.repoPath)
  const gitReady = Boolean(gitAvailable && task && workspace && (workspaceSession?.worktreeStatus === 'created' || originalDirReady))
  const gitScopeKey = task && workspace
    ? buildWorkspaceGitScopeKey({
        taskId: task.id,
        workspaceId: workspace.id,
        workspaceSessionId: workspaceSession?.id,
        compareBranch,
        worktreeStatus: workspaceSession?.worktreeStatus,
        baseBranch,
      })
    : ''
  const diffRequestIdRef = useRef(0)
  const graphRequestIdRef = useRef(0)
  const commitDiffRequestIdRef = useRef(0)
  const statusRequestIdRef = useRef(0)
  const fileDiffRequestIdRef = useRef(0)

  useEffect(() => {
    if (!task) {
      setPullRequestTitle('')
      setPullRequestBody('')
      setPullRequestResult(null)
      return
    }

    const persistedPullRequest = task.result?.delivery?.pullRequest
    const nextTitle = (persistedPullRequest?.title || task.title?.trim() || task.description?.trim() || t('workspace.git.defaultPrTitle', { defaultValue: 'Workspace update' })).replace(/\s+/g, ' ')
    const truncatedTitle = nextTitle.length > 72 ? `${nextTitle.slice(0, 69)}...` : nextTitle
    setPullRequestTitle(truncatedTitle)
    setPullRequestBody(persistedPullRequest?.description || [
      '## Summary',
      `- ${task.description?.trim() || task.title?.trim() || t('workspace.git.defaultPrTitle', { defaultValue: 'Workspace update' })}`,
      '',
      '## Branches',
      `- Base: ${displayBaseBranch}`,
      `- Compare: ${displayCompareBranch || t('workspace.git.unprepared', { defaultValue: '未准备' })}`,
    ].join('\n'))

    if (persistedPullRequest?.compareBranch || persistedPullRequest?.url || persistedPullRequest?.number) {
      setPullRequestResult({
        ok: true,
        message: persistedPullRequest.state === 'merged'
          ? t('workspace.git.prStateMerged', { defaultValue: 'PR 已合并。' })
          : persistedPullRequest.state === 'open'
            ? t('workspace.git.prStateOpen', { defaultValue: 'PR 审核中。' })
            : persistedPullRequest.state === 'closed'
              ? t('workspace.git.prStateClosed', { defaultValue: 'PR 已关闭。' })
              : t('workspace.git.prStateRecorded', { defaultValue: '已记录 PR 信息。' }),
        provider: 'github',
        title: persistedPullRequest.title || truncatedTitle,
        body: persistedPullRequest.description || '',
        baseBranch: persistedPullRequest.baseBranch || displayBaseBranch,
        compareBranch: persistedPullRequest.compareBranch || displayCompareBranch,
        number: persistedPullRequest.number,
        url: persistedPullRequest.url,
        state: persistedPullRequest.state,
      })
    }
  }, [displayBaseBranch, displayCompareBranch, t, task])

  useEffect(() => {
    if (pullRequestDialogOpen) {
      setPullRequestResult(null)
    }
  }, [pullRequestDialogOpen])

  useEffect(() => {
    if (!task?.result?.delivery?.pullRequest) {
      setPullRequestResult(null)
    }
  }, [
    task?.id,
    workspace?.id,
    task?.result?.delivery?.pullRequest?.number,
    task?.result?.delivery?.pullRequest?.url,
    task?.result?.delivery?.pullRequest?.compareBranch,
  ])

  useEffect(() => {
    if (!rebaseDialogOpen || !workspace) {
      return
    }

    let cancelled = false
    setRebaseBranchLoading(true)
    setRebaseBranchMessage('')

    void api.listWorkspaceBranches(workspace.id)
      .then((response) => {
        if (cancelled) {
          return
        }

        setRebaseBranchOptions(response.branches)
        setRebaseTargetBranch((current) => {
          if (current && response.branches.includes(current)) return current
          if (displayBaseBranch && response.branches.includes(displayBaseBranch)) return displayBaseBranch
          if (response.defaultBranch && response.branches.includes(response.defaultBranch)) return response.defaultBranch
          return response.branches[0] || ''
        })
        setRebaseBranchMessage(response.message ?? '')
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        setRebaseBranchOptions([])
        setRebaseBranchMessage(error instanceof Error ? error.message : t('workspace.git.branchLoadFailed', { defaultValue: '分支列表加载失败' }))
      })
      .finally(() => {
        if (!cancelled) {
          setRebaseBranchLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [displayBaseBranch, rebaseDialogOpen, t, workspace])

  useEffect(() => {
    diffRequestIdRef.current += 1
    graphRequestIdRef.current += 1
    commitDiffRequestIdRef.current += 1
    setDiffLoading(false)
    setGraphLoading(false)
    setCommitDiffLoading(false)
    setWorkingTreeDiffResult(null)
    setGitStatusChanges([])
    setSelectedChange(null)
    setFileDiffResult(null)
    setGraphResult(null)
    setCommitDiffResult(null)
    setSelectedGraphCommitSha('')
  }, [gitScopeKey])

  useEffect(() => {
    if (!gitReady || !task || !workspace) {
      setGraphResult(null)
      setSelectedGraphCommitSha('')
      return
    }

    if (activeTab !== 'graph') {
      return
    }

    void loadGraph()
  }, [activeTab, baseBranch, compareBranch, gitReady, graphLimit, task?.id, workspace?.id, workspaceSession?.id, workspaceSession?.worktreeStatus])

  useEffect(() => {
    if (!gitReady || !task || !workspace) {
      setWorkingTreeDiffResult(null)
      return
    }

    void loadGitStatus(true)
  }, [compareBranch, gitReady, task?.id, workspace?.id, workspaceSession?.id, workspaceSession?.worktreeStatus])

  useEffect(() => {
    if (!graphResult?.commits?.length) {
      setSelectedGraphCommitSha('')
      setCommitDiffResult(null)
      setActiveTab((current) => (current === 'commit-diff' ? 'graph' : current))
      return
    }

    if (selectedGraphCommitSha && !graphResult.commits.some((commit) => commit.sha === selectedGraphCommitSha)) {
      setSelectedGraphCommitSha('')
    }
  }, [graphResult, selectedGraphCommitSha])

  useEffect(() => {
    if (!task || !workspace) {
      setActiveTab('diff')
    }
  }, [task, workspace])

  useEffect(() => {
    if (!task || !workspace || !selectedGraphCommitSha || !graphResult?.ok) {
      setCommitDiffResult(null)
      return
    }

    let cancelled = false
    const requestId = ++commitDiffRequestIdRef.current
    const loadCommitDiff = async () => {
      setCommitDiffLoading(true)
      try {
        const result = await queryClient.fetchQuery({
          queryKey: workspaceQueryKeys.gitCommitDiff(task.id, workspace.id, workspaceSession?.id, selectedGraphCommitSha),
          queryFn: () => api.getTaskGitCommitDiff(task.id, selectedGraphCommitSha, workspace.id, workspaceSession?.id),
          staleTime: WORKSPACE_GIT_COMMIT_DIFF_CACHE_TTL_MS,
        })
        if (!cancelled && requestId === commitDiffRequestIdRef.current) {
          setCommitDiffResult(result)
        }
      } catch (error) {
        if (!cancelled && requestId === commitDiffRequestIdRef.current) {
          toast.error(error instanceof Error ? error.message : t('workspace.git.commitDiffLoadFailed', { defaultValue: '读取 commit diff 失败' }))
          setCommitDiffResult(emptyCommitDiffResult(selectedGraphCommitSha))
        }
      } finally {
        if (!cancelled && requestId === commitDiffRequestIdRef.current) {
          setCommitDiffLoading(false)
        }
      }
    }

    void loadCommitDiff()
    return () => {
      cancelled = true
    }
  }, [graphResult?.ok, queryClient, selectedGraphCommitSha, t, task, workspace, workspaceSession?.id])

  const loadWorkingTreeDiff = async (silent = false, options?: { forceRefresh?: boolean }) => {
    if (!task || !workspace) {
      return
    }

    const requestId = ++diffRequestIdRef.current
    setDiffLoading(true)
    try {
      const result = await queryClient.fetchQuery({
        queryKey: workspaceQueryKeys.gitWorkingTreeDiff(task.id, workspace.id, workspaceSession?.id, gitScopeKey),
        queryFn: () => api.getTaskGitWorkingTreeDiff(task.id, workspace.id, workspaceSession?.id),
        staleTime: options?.forceRefresh ? 0 : WORKSPACE_GIT_DIFF_CACHE_TTL_MS,
      })
      if (requestId !== diffRequestIdRef.current) {
        return
      }

      setWorkingTreeDiffResult(result)
      if (!result.ok) {
        toast.error(result.message || t('workspace.git.diffLoadFailed', { defaultValue: '读取 Git diff 失败' }))
        return
      }
      if (!silent && !result.patch.trim()) {
        toast.success(result.message || t('workspace.git.diffEmpty', { defaultValue: '当前没有可展示的 diff。' }))
      }
    } catch (error) {
      if (requestId !== diffRequestIdRef.current) {
        return
      }

      toast.error(error instanceof Error ? error.message : t('workspace.git.diffLoadFailed', { defaultValue: '读取 Git diff 失败' }))
      setWorkingTreeDiffResult(emptyWorkingTreeDiffResult())
    } finally {
      if (requestId === diffRequestIdRef.current) {
        setDiffLoading(false)
      }
    }
  }

  const loadGitStatus = async (silent = false) => {
    if (!task || !workspace) return

    const requestId = ++statusRequestIdRef.current
    setGitStatusLoading(true)
    try {
      const result = await api.getTaskGitStatus(task.id, workspace.id, workspaceSession?.id)
      if (requestId !== statusRequestIdRef.current) return
      if (!result.ok) {
        if (!silent) toast.error(result.message || '读取 Git 状态失败')
        setGitStatusChanges([])
        return
      }
      setGitStatusChanges(result.changes)
      setSelectedChange((current) => {
        if (current && result.changes.some((change) => change.path === current.path && change.stage === current.stage)) {
          return current
        }
        return result.changes[0] ?? null
      })
    } catch (error) {
      if (requestId === statusRequestIdRef.current) {
        setGitStatusChanges([])
        if (!silent) toast.error(error instanceof Error ? error.message : '读取 Git 状态失败')
      }
    } finally {
      if (requestId === statusRequestIdRef.current) setGitStatusLoading(false)
    }
  }

  useEffect(() => {
    if (!task || !workspace || !selectedChange || !gitReady) {
      setFileDiffResult(null)
      return
    }
    let cancelled = false
    const requestId = ++fileDiffRequestIdRef.current
    setFileDiffLoading(true)
    void api.getTaskGitFileDiff(task.id, selectedChange.path, selectedChange.stage, workspace.id, workspaceSession?.id)
      .then((result) => {
        if (!cancelled && requestId === fileDiffRequestIdRef.current) setFileDiffResult(result)
      })
      .catch((error) => {
        if (!cancelled && requestId === fileDiffRequestIdRef.current) {
          setFileDiffResult(null)
          toast.error(error instanceof Error ? error.message : '读取文件 diff 失败')
        }
      })
      .finally(() => {
        if (!cancelled && requestId === fileDiffRequestIdRef.current) setFileDiffLoading(false)
      })
    return () => { cancelled = true }
  }, [gitReady, selectedChange?.path, selectedChange?.stage, task?.id, workspace?.id, workspaceSession?.id])

  const applyGitChange = async (action: 'stage' | 'unstage' | 'discard', paths: string[]) => {
    if (!task || !workspace || paths.length === 0) return
    setGitActionLoading(true)
    try {
      const result = await api.applyTaskGitChange(task.id, {
        workspaceId: workspace.id,
        workspaceSessionId: workspaceSession?.id,
        action,
        paths,
      })
      if (!result.ok) {
        toast.error(result.message || '更新 Git 改动失败')
        return
      }
      toast.success(result.message)
      await Promise.all([loadGitStatus(true), loadWorkingTreeDiff(true, { forceRefresh: true })])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新 Git 改动失败')
    } finally {
      setGitActionLoading(false)
      setDiscardPaths([])
    }
  }

  const commitStagedChanges = async (push: boolean) => {
    if (!task || !workspace || !commitMessage.trim()) return
    setCommitLoading(true)
    try {
      const result = await api.commitTaskGitStagedChanges(task.id, {
        workspaceId: workspace.id,
        workspaceSessionId: workspaceSession?.id,
        commitMessage: commitMessage.trim(),
        push,
      })
      if (!result.ok) {
        toast.error(result.message || '提交 Git 改动失败')
        return
      }
      toast.success(result.message)
      setCommitMessage('')
      await Promise.all([loadGitStatus(true), loadWorkingTreeDiff(true, { forceRefresh: true }), loadGraph({ forceRefresh: true })])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '提交 Git 改动失败')
    } finally {
      setCommitLoading(false)
    }
  }

  const loadGraph = async (options?: { forceRefresh?: boolean }) => {
    if (!task || !workspace) {
      return
    }

    const requestId = ++graphRequestIdRef.current
    setGraphLoading(true)
    try {
      const result = await queryClient.fetchQuery({
        queryKey: workspaceQueryKeys.gitGraph(task.id, workspace.id, workspaceSession?.id, graphLimit, gitScopeKey),
        queryFn: () => api.getTaskGitGraph(task.id, workspace.id, workspaceSession?.id, graphLimit),
        staleTime: options?.forceRefresh ? 0 : WORKSPACE_GIT_GRAPH_CACHE_TTL_MS,
      })
      if (requestId !== graphRequestIdRef.current) {
        return
      }

      setGraphResult(result)
      if (!result.ok) {
        toast.error(result.message || t('workspace.git.graphLoadFailed', { defaultValue: '读取 Git graph 失败' }))
      }
    } catch (error) {
      if (requestId !== graphRequestIdRef.current) {
        return
      }

      toast.error(error instanceof Error ? error.message : t('workspace.git.graphLoadFailed', { defaultValue: '读取 Git graph 失败' }))
      setGraphResult(emptyGraphResult(baseBranch))
    } finally {
      if (requestId === graphRequestIdRef.current) {
        setGraphLoading(false)
      }
    }
  }

  const runRebase = async (nextBaseBranch: string) => {
    if (!task || !workspace) {
      return false
    }

    setRebaseLoading(true)
    try {
      const result = await api.rebaseTaskGit(task.id, workspace.id, workspaceSession?.id, nextBaseBranch)
      setRebaseResult(result)
      if (result.ok) {
        toast.success(result.message)
        await Promise.all([
          loadWorkingTreeDiff(false, { forceRefresh: true }),
          loadGraph({ forceRefresh: true }),
        ])
        return true
      }

      toast.error(result.message || t('workspace.git.rebaseFailed', { defaultValue: '执行 rebase 失败' }))
      return false
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.git.rebaseFailed', { defaultValue: '执行 rebase 失败' }))
      return false
    } finally {
      setRebaseLoading(false)
    }
  }

  const createPullRequest = async () => {
    if (!task || !workspace) {
      return
    }

    setPullRequestLoading(true)
    try {
      const result = await api.createTaskPullRequest(task.id, {
        workspaceId: workspace.id,
        workspaceSessionId: workspaceSession?.id,
        title: pullRequestTitle,
        body: pullRequestBody,
        baseBranch: displayBaseBranch,
      })
      setPullRequestResult(result)
      if (!result.ok) {
        toast.error(result.message || t('workspace.git.createPrFailed', { defaultValue: '创建 PR 失败' }))
        return
      }

      toast.success(result.message)
      setState((current) => ({
        ...current,
        tasks: current.tasks.map((item) => (
          item.id === task.id
            ? applyTaskPullRequestResult({
                task: item,
                pullRequest: result,
                repoUrl: task.result?.delivery?.pullRequest?.repoUrl || '',
                executorNodeId: resolveWorkspaceSessionExecutorId(workspaceSession, workspace.executorNodeId),
                workspaceId: workspace.id,
                workspaceSessionId: workspaceSession?.id,
              })
            : item
        )),
      }))
      setPullRequestDialogOpen(false)
      if (result.url) {
        window.open(result.url, '_blank', 'noopener,noreferrer')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.git.createPrFailed', { defaultValue: '创建 PR 失败' }))
    } finally {
      setPullRequestLoading(false)
    }
  }

  const refreshPullRequestStatus = async () => {
    if (!task || !workspace) {
      return
    }

    setPullRequestStatusLoading(true)
    try {
      const result = await api.refreshTaskPullRequestStatus(task.id, {
        workspaceId: workspace.id,
        workspaceSessionId: workspaceSession?.id,
      })
      setPullRequestResult(result)
      if (!result.ok) {
        toast.error(result.message || t('workspace.git.refreshPrFailed', { defaultValue: '刷新 PR 状态失败' }))
        return
      }

      setState((current) => ({
        ...current,
        tasks: current.tasks.map((item) => (
          item.id === task.id
            ? applyTaskPullRequestResult({
                task: item,
                pullRequest: result,
                repoUrl: task.result?.delivery?.pullRequest?.repoUrl || '',
                executorNodeId: resolveWorkspaceSessionExecutorId(workspaceSession, workspace.executorNodeId),
                workspaceId: workspace.id,
                workspaceSessionId: workspaceSession?.id,
              })
            : item
        )),
      }))
      toast.success(result.state === 'merged'
        ? t('workspace.git.prMergedTaskCompleted', { defaultValue: 'PR 已合并，任务已自动进入已完成' })
        : result.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.git.refreshPrFailed', { defaultValue: '刷新 PR 状态失败' }))
    } finally {
      setPullRequestStatusLoading(false)
    }
  }

  const handleSelectGraphCommit = (sha: string) => {
    setSelectedGraphCommitSha((current) => (current === sha ? '' : sha))
  }

  const stagedChanges = gitStatusChanges.filter((change) => change.stage === 'staged' && !change.conflicted)
  const unstagedChanges = gitStatusChanges.filter((change) => change.stage === 'unstaged' && !change.conflicted)
  const conflictedChanges = gitStatusChanges.filter((change) => change.conflicted)
  const diffFileCount = gitStatusChanges.length || workingTreeDiffResult?.files.length || 0
  const tabOptions: Array<{ value: GitPanelTab; label: string; disabled?: boolean }> = [
    { value: 'diff', label: 'Current Diff' },
    { value: 'graph', label: 'Graph' },
    { value: 'commit-diff', label: 'Commit Diff', disabled: !selectedGraphCommitSha },
  ]

  const statusBadge = rebaseResult ? (
    <Badge className={cn(
      'h-5 shrink-0 border text-[10px]',
      rebaseResult.ok
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
        : 'border-amber-500/20 bg-amber-500/10 text-amber-200',
    )}>
      {rebaseResult.ok ? 'Rebase OK' : 'Rebase 冲突'}
    </Badge>
  ) : pullRequestResult?.ok ? (
    <Badge className={cn(
      'h-5 shrink-0 border text-[10px]',
      pullRequestResult.state === 'merged'
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
        : pullRequestResult.state === 'open'
          ? 'border-sky-500/20 bg-sky-500/10 text-sky-300'
          : 'border-zinc-700 bg-zinc-950/80 text-zinc-400',
    )}>
      PR: {pullRequestResult.state}
      {typeof pullRequestResult.number === 'number' ? ` #${pullRequestResult.number}` : ''}
    </Badge>
  ) : null
  const publishPolicyLabel = publishPolicy === 'pull-request'
    ? 'PR enabled'
    : publishPolicy === 'push-branch'
      ? 'Push only'
      : 'Publish off'
  const gitAuthPreferenceLabel = gitAuthPreference === 'github-app'
    ? 'GitHub App'
    : gitAuthPreference === 'credential'
      ? 'PAT / SSH'
      : 'Project default'

  return (
    <Card className={cn('flex h-full min-h-0 flex-col border-zinc-800 bg-zinc-950/60 text-zinc-100 shadow-none', className)}>
      <CardHeader className="shrink-0 border-b border-zinc-800 px-2 py-1.5">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
            <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
              <GitBranch className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                {t('workspace.git.title', { defaultValue: 'Git' })}
              </span>
              <div className="mx-0.5 h-3 w-px shrink-0 bg-zinc-800" />
              <span className="truncate font-mono text-[10px] text-zinc-400">
                {displayCompareBranch || 'HEAD'}
              </span>
              {displayBaseBranch ? (
                <span className="text-[10px] text-zinc-600">→ {displayBaseBranch}</span>
              ) : null}
              {statusBadge}
            </div>
            <div className="flex min-w-0 items-center gap-2 text-[10px] text-zinc-600">
              <span>{publishPolicyLabel}</span>
              <span className="h-2.5 w-px bg-zinc-800" />
              <span>{gitAuthPreferenceLabel}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setRebaseDialogOpen(true)}
              disabled={rebaseLoading || !gitReady}
              className="h-6 w-6 rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title="Rebase"
            >
              {rebaseLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setPullRequestDialogOpen(true)}
              disabled={!compareBranch || !remoteGitEnabled || !gitReady || !pullRequestAllowed}
              className="h-6 w-6 rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title={t('workspace.git.createPr', { defaultValue: '创建 PR' })}
            >
              <GitPullRequest className="h-3.5 w-3.5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={!gitReady}
                  className="h-6 w-6 rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  title={t('workspace.git.moreActions', { defaultValue: '更多操作' })}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void loadWorkingTreeDiff(false, { forceRefresh: true })} disabled={diffLoading}>
                  {diffLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {t('workspace.git.refreshDiff', { defaultValue: '刷新 Diff' })}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void loadGitStatus(false)} disabled={gitStatusLoading}>
                  {gitStatusLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  刷新变更
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void refreshPullRequestStatus()} disabled={!compareBranch || !remoteGitEnabled || pullRequestStatusLoading}>
                  {pullRequestStatusLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {t('workspace.git.refreshPrStatus', { defaultValue: '刷新 PR 状态' })}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void loadGraph({ forceRefresh: true })} disabled={graphLoading}>
                  {graphLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {t('workspace.git.refreshGraph', { defaultValue: '刷新 Graph' })}
                </DropdownMenuItem>
                {pullRequestResult?.url ? (
                  <DropdownMenuItem onSelect={() => window.open(pullRequestResult.url, '_blank')}>
                    <ArrowUpRight className="h-4 w-4" />
                    {t('workspace.git.viewPr', { defaultValue: '查看 PR' })}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            {headerActions}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        {!gitAvailable ? (
          <div className="px-3 py-4 text-xs text-zinc-500">{t('workspace.git.notEnabled', { defaultValue: '初始化 Git 后可用。' })}</div>
        ) : !gitReady ? (
          <div className="px-3 py-4 text-xs text-zinc-500">{t('workspace.git.notReady', { defaultValue: '准备工作目录后可用。' })}</div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex shrink-0 items-center gap-1 border-b border-zinc-800 px-2">
              {tabOptions.map(({ value, label, disabled }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setActiveTab(value)}
                  disabled={disabled}
                  className={cn(
                    'relative px-2.5 py-1.5 text-[11px] transition-colors',
                    activeTab === value
                      ? 'text-zinc-100 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300',
                    disabled && 'cursor-not-allowed opacity-40 hover:text-zinc-500',
                  )}
                >
                  {label}
                </button>
              ))}
              <div className="flex-1" />
              {activeTab === 'graph' ? (
                <div className="flex items-center gap-0.5 py-1">
                  {[20, 40, 80, 120].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setGraphLimit(value as 20 | 40 | 80 | 120)}
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                        graphLimit === value
                          ? 'bg-zinc-800 text-zinc-200'
                          : 'text-zinc-600 hover:text-zinc-400',
                      )}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              ) : null}
              {workingTreeDiffResult && activeTab === 'diff' ? (
                <span className="text-[10px] text-zinc-600">{diffFileCount} files</span>
              ) : null}
              {graphResult?.ok && activeTab === 'graph' ? (
                <span className="text-[10px] text-zinc-600">{graphResult.commitCount} commits</span>
              ) : null}
            </div>

            {/* Content */}
            <div className="relative min-h-0 flex-1 overflow-hidden">
              {activeTab === 'diff' ? (
                <div className="flex h-full min-h-0 flex-col lg:flex-row">
                  <aside className="flex min-h-0 w-full shrink-0 flex-col border-b border-zinc-800 bg-[#060607] lg:w-[280px] lg:border-b-0 lg:border-r">
                    <div className="border-b border-zinc-800 p-2">
                      <Textarea
                        value={commitMessage}
                        onChange={(event) => setCommitMessage(event.target.value)}
                        placeholder="提交信息"
                        disabled={commitLoading}
                        className="min-h-[60px] resize-none border-zinc-800 bg-zinc-950 text-xs text-zinc-100 placeholder:text-zinc-600"
                      />
                      <div className="mt-1.5 flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void commitStagedChanges(false)}
                          disabled={commitLoading || stagedChanges.length === 0 || !commitMessage.trim()}
                          className="h-7 flex-1 rounded-md bg-zinc-100 px-2 text-xs text-zinc-950 hover:bg-zinc-200"
                        >
                          {commitLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Commit
                        </Button>
                        {remoteGitEnabled ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" size="icon" disabled={commitLoading || stagedChanges.length === 0 || !commitMessage.trim()} className="h-7 w-7 rounded-md bg-zinc-100 text-zinc-950 hover:bg-zinc-200" title="Commit and push">
                                <ChevronDown className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => void commitStagedChanges(true)}>
                                <Upload className="h-4 w-4" />
                                Commit and Push
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </div>
                    </div>
                    <ScrollArea className="min-h-0 flex-1">
                      {([
                        { label: 'STAGED CHANGES', changes: stagedChanges },
                        { label: 'CHANGES', changes: unstagedChanges },
                        { label: 'MERGE CHANGES', changes: conflictedChanges },
                      ] as const).map(({ label, changes }) => changes.length > 0 ? (
                        <div key={label} className="border-b border-zinc-900 py-1">
                          <div className="flex h-7 items-center gap-1 px-2 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                            <span className="min-w-0 flex-1 truncate">{label} ({changes.length})</span>
                            {label === 'CHANGES' ? (
                              <Button type="button" variant="ghost" size="icon" className="h-5 w-5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200" title="Stage all" disabled={gitActionLoading} onClick={() => void applyGitChange('stage', changes.map((change) => change.path))}>
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                            ) : null}
                            {label === 'STAGED CHANGES' ? (
                              <Button type="button" variant="ghost" size="icon" className="h-5 w-5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200" title="Unstage all" disabled={gitActionLoading} onClick={() => void applyGitChange('unstage', changes.map((change) => change.path))}>
                                <Undo2 className="h-3.5 w-3.5" />
                              </Button>
                            ) : null}
                          </div>
                          {changes.map((change) => {
                            const selected = selectedChange?.path === change.path && selectedChange.stage === change.stage
                            const fileName = change.path.split('/').at(-1) || change.path
                            const directory = change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/')) : ''
                            return (
                              <div key={`${change.stage}:${change.path}`} className={cn('group flex min-w-0 items-center gap-1 px-2 py-1 text-left', selected ? 'bg-zinc-900/80' : 'hover:bg-zinc-900/40')}>
                                <button type="button" onClick={() => setSelectedChange(change)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                                  <FileCode2 className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-300" title={change.path}>{fileName}</span>
                                  <span className={cn('shrink-0 text-[10px] font-medium', change.conflicted ? 'text-rose-300' : change.status === '??' || change.status === 'A' ? 'text-emerald-300' : 'text-amber-300')}>{change.conflicted ? 'U' : change.status}</span>
                                </button>
                                {!change.conflicted ? (
                                  <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                                    <Button type="button" variant="ghost" size="icon" className="h-5 w-5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100" title={change.stage === 'staged' ? 'Unstage' : 'Stage'} disabled={gitActionLoading} onClick={() => void applyGitChange(change.stage === 'staged' ? 'unstage' : 'stage', [change.path])}>
                                      {change.stage === 'staged' ? <Undo2 className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                                    </Button>
                                    {change.stage === 'unstaged' ? (
                                      <Button type="button" variant="ghost" size="icon" className="h-5 w-5 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-200" title="Discard changes" disabled={gitActionLoading} onClick={() => setDiscardPaths([change.path])}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    ) : null}
                                  </div>
                                ) : null}
                                {directory ? <span className="sr-only">{directory}</span> : null}
                              </div>
                            )
                          })}
                        </div>
                      ) : null)}
                      {!gitStatusLoading && gitStatusChanges.length === 0 ? <div className="px-3 py-6 text-center text-xs text-zinc-600">没有待提交的改动。</div> : null}
                      {gitStatusLoading ? <div className="flex items-center gap-1.5 px-3 py-3 text-xs text-zinc-600"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在读取改动…</div> : null}
                    </ScrollArea>
                  </aside>
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#050505]">
                    <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
                      <FileCode2 className="h-3.5 w-3.5 text-zinc-500" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">{selectedChange?.path || '选择一个文件查看 diff'}</span>
                      {selectedChange ? <span className="text-[10px] uppercase text-zinc-600">{selectedChange.stage}</span> : null}
                    </div>
                    {fileDiffLoading ? (
                      <div className="flex h-full items-center justify-center text-xs text-zinc-600"><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />正在加载 diff…</div>
                    ) : fileDiffResult?.patch ? (
                      <WorkspaceUnifiedDiff patch={fileDiffResult.patch} className="h-full rounded-none border-0 bg-transparent" />
                    ) : (
                      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-zinc-600">{fileDiffResult?.message || '选择一个文件查看 diff。'}</div>
                    )}
                  </div>
                </div>
              ) : null}

              {activeTab === 'graph' ? (
                !graphResult?.ok ? (
                  <div className="flex h-full items-center justify-center text-xs text-zinc-600">
                    {graphResult?.message || t('workspace.git.graphPending', { defaultValue: '加载中…' })}
                  </div>
                ) : (
                  <WorkspaceGitGraph
                    commits={graphResult.commits}
                    currentBranch={graphResult.currentBranch}
                    baseBranch={graphResult.baseBranch}
                    rawGraph={graphResult.graph}
                    commitDiffResult={commitDiffResult}
                    commitDiffLoading={commitDiffLoading}
                    selectedCommitSha={selectedGraphCommitSha}
                    onSelectCommit={handleSelectGraphCommit}
                  />
                )
              ) : null}

              {activeTab === 'commit-diff' ? (
                !selectedGraphCommitSha ? (
                  <div className="flex h-full items-center justify-center text-xs text-zinc-600">
                    {t('workspace.git.noCommitSelected', { defaultValue: '选择一个提交查看 diff。' })}
                  </div>
                ) : commitDiffLoading ? (
                  <div className="flex h-full items-center justify-center text-xs text-zinc-600">
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    {t('workspace.git.commitDiffLoading', { defaultValue: '加载中…' })}
                  </div>
                ) : commitDiffResult?.patch ? (
                  <WorkspaceUnifiedDiff patch={commitDiffResult.patch} className="h-full rounded-none border-0 bg-transparent" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-zinc-600">
                    {commitDiffResult?.message || t('workspace.git.commitDiffEmpty', { defaultValue: '没有 diff。' })}
                  </div>
                )
              ) : null}
            </div>
          </>
        )}
      </CardContent>
      <Dialog open={discardPaths.length > 0} onOpenChange={(open) => {
        if (!open && !gitActionLoading) setDiscardPaths([])
      }}>
        <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-zinc-100"><Trash2 className="h-4 w-4 text-rose-300" />丢弃文件改动</DialogTitle>
            <DialogDescription className="text-zinc-500">此操作会恢复已跟踪文件，或永久删除未跟踪文件，且无法撤销。</DialogDescription>
          </DialogHeader>
          <div className="max-h-32 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300">
            {discardPaths.join('\n')}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={gitActionLoading} onClick={() => setDiscardPaths([])} className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50">取消</Button>
            <Button type="button" disabled={gitActionLoading} onClick={() => void applyGitChange('discard', discardPaths)} className="bg-rose-600 text-white hover:bg-rose-500">
              {gitActionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}丢弃改动
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={rebaseDialogOpen}
        onOpenChange={(open) => {
          setRebaseDialogOpen(open)
          if (!open && !rebaseLoading) {
            setRebaseTargetBranch(displayBaseBranch)
          }
        }}
      >
        <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-zinc-100">
              <RotateCcw className="h-4 w-4" />
              {t('workspace.git.rebaseDialog.title', { defaultValue: 'Rebase 工作区' })}
            </DialogTitle>
            <DialogDescription className="text-zinc-500">
              {t('workspace.git.rebaseDialog.description', { defaultValue: '先选择要 rebase 到的目标分支，再执行同步。' })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 px-5 py-4">
            <div className="space-y-2">
              <p className="text-sm text-zinc-300">{t('workspace.git.rebaseDialog.targetBranch', { defaultValue: '目标分支' })}</p>
              <SearchableSelect
                value={rebaseTargetBranch}
                options={rebaseBranchOptions.map((branch) => ({
                  value: branch,
                  label: branch,
                  keywords: [branch],
                }))}
                placeholder={t('workspace.git.rebaseDialog.selectBranch', { defaultValue: '选择目标分支' })}
                searchPlaceholder={t('workspace.git.rebaseDialog.searchBranch', { defaultValue: '搜索分支' })}
                emptyText={rebaseBranchLoading
                  ? t('workspace.git.rebaseDialog.loadingBranches', { defaultValue: '正在加载分支…' })
                  : t('workspace.git.rebaseDialog.noBranches', { defaultValue: '没有匹配的分支' })}
                disabled={rebaseLoading || rebaseBranchLoading}
                onChange={setRebaseTargetBranch}
              />
              {rebaseBranchMessage ? <p className="text-xs text-zinc-500">{rebaseBranchMessage}</p> : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge className="border border-zinc-800 bg-zinc-950 text-zinc-300">{t('workspace.git.rebaseDialog.currentBase', { defaultValue: '当前 base: {{value}}', value: displayBaseBranch })}</Badge>
              <Badge className="border border-zinc-800 bg-zinc-950 text-zinc-300">{t('workspace.git.rebaseDialog.workingBranch', { defaultValue: '工作分支: {{value}}', value: displayCompareBranch || t('workspace.git.unprepared', { defaultValue: '未准备' }) })}</Badge>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={rebaseLoading}
              onClick={() => setRebaseDialogOpen(false)}
              className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
            >
              {t('common.cancel', { defaultValue: '取消' })}
            </Button>
            <Button
              type="button"
              disabled={rebaseLoading || rebaseBranchLoading || !rebaseTargetBranch}
              onClick={async () => {
                const ok = await runRebase(rebaseTargetBranch)
                if (ok) {
                  setRebaseDialogOpen(false)
                }
              }}
              className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
            >
              {rebaseLoading
                ? t('workspace.git.rebaseDialog.rebasing', { defaultValue: 'Rebase 中…' })
                : t('workspace.git.rebaseDialog.start', { defaultValue: '开始 Rebase' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={pullRequestDialogOpen} onOpenChange={setPullRequestDialogOpen}>
        <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-zinc-100">
              <GitPullRequest className="h-4 w-4" />
              {t('workspace.git.createPr', { defaultValue: '创建 PR' })}
            </DialogTitle>
            <DialogDescription className="text-zinc-500">
              {t('workspace.git.prDialog.description', { defaultValue: '从当前工作区分支发起 Pull Request。实际仓库操作会在 worker 上执行。' })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge className="border border-zinc-800 bg-zinc-950 text-zinc-300">base: {displayBaseBranch}</Badge>
              <Badge className="border border-zinc-800 bg-zinc-950 text-zinc-300">branch: {displayCompareBranch || t('workspace.git.prDialog.unpreparedBranch', { defaultValue: '未准备分支' })}</Badge>
            </div>
            <Input
              value={pullRequestTitle}
              onChange={(event) => setPullRequestTitle(event.target.value)}
              placeholder={t('workspace.git.prDialog.titlePlaceholder', { defaultValue: 'PR 标题' })}
              className="border-zinc-800 bg-zinc-950 text-zinc-100"
            />
            <Textarea
              value={pullRequestBody}
              onChange={(event) => setPullRequestBody(event.target.value)}
              placeholder={t('workspace.git.prDialog.bodyPlaceholder', { defaultValue: 'PR 描述' })}
              className="min-h-32 border-zinc-800 bg-zinc-950 text-zinc-100"
            />
            {pullRequestResult ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className={cn('text-xs', pullRequestResult.ok ? 'text-emerald-300' : 'text-amber-300')}>{pullRequestResult.message}</p>
                {pullRequestResult.url ? (
                  <a
                    href={pullRequestResult.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-sky-300 hover:text-sky-200"
                  >
                    {t('workspace.git.viewPr', { defaultValue: '查看 PR' })}
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPullRequestDialogOpen(false)}
              className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
            >
              {t('common.cancel', { defaultValue: '取消' })}
            </Button>
            <Button
              type="button"
              onClick={() => void createPullRequest()}
              disabled={pullRequestLoading || !compareBranch || !remoteGitEnabled || !pullRequestAllowed}
              className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
            >
              {pullRequestLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <GitPullRequest className="mr-1.5 h-4 w-4" />}
              {t('workspace.git.createPr', { defaultValue: '创建 PR' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
