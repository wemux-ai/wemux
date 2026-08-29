import { Fragment, useMemo } from 'react'
import type { ExecutorGitCommitDiffResult, ExecutorGitGraphCommit, TaskGitDiffFile } from '@shared/types'
import { FileText, Folder, Loader2 } from 'lucide-react'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { ScrollArea } from '../ui/scroll-area'

type WorkspaceGitGraphProps = {
  commits: ExecutorGitGraphCommit[]
  currentBranch: string
  baseBranch: string
  rawGraph?: string
  commitDiffResult?: ExecutorGitCommitDiffResult | null
  commitDiffLoading?: boolean
  selectedCommitSha?: string
  onSelectCommit?: (sha: string) => void
}

type GraphNode = {
  commit: ExecutorGitGraphCommit
  row: number
  lane: number
}

type GraphEdge = {
  fromRow: number
  toRow: number
  fromLane: number
  toLane: number
}

type ChangedFileTreeNode = {
  kind: 'directory' | 'file'
  name: string
  path: string
  additions: number
  deletions: number
  status?: string
  children: ChangedFileTreeNode[]
}

const LANE_COLORS = [
  '#22c55e',
  '#38bdf8',
  '#a78bfa',
  '#f59e0b',
  '#ef4444',
  '#14b8a6',
]

const GRAPH_ROW_HEIGHT = 31
const GRAPH_EXPANDED_PANEL_HEIGHT = 288
const GRAPH_LANE_WIDTH = 16
const GRAPH_LEFT_PADDING = 24
const GRAPH_RIGHT_PADDING = 14
const GRAPH_TABLE_DESCRIPTION_MIN_WIDTH = 520
const GRAPH_TABLE_DATE_WIDTH = 144
const GRAPH_TABLE_AUTHOR_WIDTH = 104
const GRAPH_TABLE_COMMIT_WIDTH = 92
const TREE_BASE_INDENT = 10
const TREE_STEP_INDENT = 14
const MAX_VISIBLE_ROW_REFS = 2
const MAX_ROW_REF_CHARS = 24

const pickLaneColor = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length]

const findOrCreateLane = (lanes: Array<string | null>, sha: string) => {
  const existingIndex = lanes.indexOf(sha)
  if (existingIndex >= 0) {
    return existingIndex
  }

  const emptyIndex = lanes.indexOf(null)
  if (emptyIndex >= 0) {
    lanes[emptyIndex] = sha
    return emptyIndex
  }

  lanes.push(sha)
  return lanes.length - 1
}

const compactTrailingLanes = (lanes: Array<string | null>) => {
  while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
    lanes.pop()
  }
}

const buildGraphLayout = (commits: ExecutorGitGraphCommit[]) => {
  const lanes: Array<string | null> = []
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  const rowBySha = new Map<string, number>()
  commits.forEach((commit, row) => {
    rowBySha.set(commit.sha, row)
  })

  commits.forEach((commit, row) => {
    const lane = findOrCreateLane(lanes, commit.sha)
    nodes.push({ commit, row, lane })

    lanes[lane] = commit.parents[0] ?? null
    for (const parent of commit.parents.slice(1)) {
      const parentLane = lanes.includes(parent)
        ? lanes.indexOf(parent)
        : findOrCreateLane(lanes, parent)
      if (parentLane >= 0) {
        lanes[parentLane] = parent
      }
    }

    compactTrailingLanes(lanes)
  })

  const laneBySha = new Map(nodes.map((node) => [node.commit.sha, node.lane]))
  for (const node of nodes) {
    for (const parent of node.commit.parents) {
      const toRow = rowBySha.get(parent)
      const toLane = laneBySha.get(parent)
      if (typeof toRow !== 'number' || typeof toLane !== 'number' || toRow <= node.row) {
        continue
      }

      edges.push({
        fromRow: node.row,
        toRow,
        fromLane: node.lane,
        toLane,
      })
    }
  }

  return {
    nodes,
    edges,
    laneCount: Math.max(...nodes.map((node) => node.lane), 0) + 1,
  }
}

const formatRefTone = (ref: string, currentBranch: string, baseBranch: string) => {
  if (ref.includes(`-> ${currentBranch}`) || ref === currentBranch || ref === `origin/${currentBranch}` || ref === 'HEAD') {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-200'
  }

  if (ref === baseBranch || ref === `origin/${baseBranch}`) {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  }

  return 'border-zinc-800 bg-zinc-950 text-zinc-300'
}

const sortRefsForRow = (refs: string[], currentBranch: string, baseBranch: string) => (
  [...new Set(refs)].sort((left, right) => {
    const getPriority = (ref: string) => {
      if (ref.includes(`-> ${currentBranch}`) || ref === currentBranch || ref === `origin/${currentBranch}` || ref === 'HEAD') {
        return 0
      }

      if (ref === baseBranch || ref === `origin/${baseBranch}`) {
        return 1
      }

      if (ref.startsWith('origin/')) {
        return 2
      }

      return 3
    }

    const priorityDiff = getPriority(left) - getPriority(right)
    if (priorityDiff !== 0) {
      return priorityDiff
    }

    const lengthDiff = left.length - right.length
    if (lengthDiff !== 0) {
      return lengthDiff
    }

    return left.localeCompare(right)
  })
)

const splitVisibleRowRefs = (refs: string[], currentBranch: string, baseBranch: string) => {
  const sortedRefs = sortRefsForRow(refs, currentBranch, baseBranch)
  return {
    visibleRefs: sortedRefs.slice(0, MAX_VISIBLE_ROW_REFS),
    hiddenCount: Math.max(0, sortedRefs.length - MAX_VISIBLE_ROW_REFS),
  }
}

const truncateRowRefLabel = (ref: string) => {
  if (ref.length <= MAX_ROW_REF_CHARS) {
    return ref
  }

  return `${ref.slice(0, MAX_ROW_REF_CHARS - 1)}…`
}

const formatCommitAuthorDateTime = (authorDate: string) => {
  const trimmed = authorDate.trim()
  if (!trimmed) {
    return '---- -- -- --:--'
  }

  const dateTimeMatch = trimmed.match(/\b(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?\b/)
  if (dateTimeMatch) {
    return `${dateTimeMatch[1]} ${dateTimeMatch[2]}`
  }

  const dateMatch = trimmed.match(/\b\d{4}-\d{2}-\d{2}\b/)
  if (dateMatch) {
    return `${dateMatch[0]} --:--`
  }

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    return trimmed
  }

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const date = String(parsed.getDate()).padStart(2, '0')
  const hours = String(parsed.getHours()).padStart(2, '0')
  const minutes = String(parsed.getMinutes()).padStart(2, '0')

  return `${year}-${month}-${date} ${hours}:${minutes}`
}

const formatExpandedCommitDateTime = (authorDate: string) => {
  const trimmed = authorDate.trim()
  return trimmed || '----'
}

const buildChangedTreeIndent = (depth: number) => ({
  paddingLeft: `${TREE_BASE_INDENT + depth * TREE_STEP_INDENT}px`,
})

const sortChangedFileTree = (nodes: ChangedFileTreeNode[]): ChangedFileTreeNode[] => (
  nodes
    .map((node) => (
      node.kind === 'directory'
        ? { ...node, children: sortChangedFileTree(node.children) }
        : node
    ))
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'directory' ? -1 : 1
      }

      return left.name.localeCompare(right.name)
    })
)

const buildChangedFileTree = (files: TaskGitDiffFile[]) => {
  const root: ChangedFileTreeNode = {
    kind: 'directory',
    name: '',
    path: '',
    additions: 0,
    deletions: 0,
    children: [],
  }

  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean)
    const normalizedSegments = segments.length > 0 ? segments : [file.path || '/']
    let currentNode = root
    let currentPath = ''

    for (let index = 0; index < normalizedSegments.length; index += 1) {
      const segment = normalizedSegments[index]
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      const isLeaf = index === normalizedSegments.length - 1

      if (isLeaf) {
        currentNode.children.push({
          kind: 'file',
          name: segment,
          path: file.path,
          additions: file.additions,
          deletions: file.deletions,
          status: file.status,
          children: [],
        })
        continue
      }

      let nextNode = currentNode.children.find((child) => child.kind === 'directory' && child.name === segment)
      if (!nextNode) {
        nextNode = {
          kind: 'directory',
          name: segment,
          path: currentPath,
          additions: 0,
          deletions: 0,
          children: [],
        }
        currentNode.children.push(nextNode)
      }

      nextNode.additions += file.additions
      nextNode.deletions += file.deletions
      currentNode = nextNode
    }
  }

  return sortChangedFileTree(root.children)
}

const summarizeDiffFiles = (files: TaskGitDiffFile[]) => files.reduce(
  (summary, file) => ({
    additions: summary.additions + file.additions,
    deletions: summary.deletions + file.deletions,
  }),
  { additions: 0, deletions: 0 },
)

const formatFileStatusMeta = (status: string | undefined) => {
  const normalizedStatus = (status || 'M').trim().toUpperCase()
  const statusCode = normalizedStatus.startsWith('R')
    ? 'R'
    : normalizedStatus.startsWith('A')
      ? 'A'
      : normalizedStatus.startsWith('D')
        ? 'D'
        : normalizedStatus.startsWith('C')
          ? 'C'
          : 'M'

  if (statusCode === 'A') {
    return {
      label: 'A',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    }
  }

  if (statusCode === 'D') {
    return {
      label: 'D',
      className: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
    }
  }

  if (statusCode === 'R') {
    return {
      label: 'R',
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    }
  }

  if (statusCode === 'C') {
    return {
      label: 'C',
      className: 'border-violet-500/30 bg-violet-500/10 text-violet-200',
    }
  }

  return {
    label: 'M',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  }
}

const buildGraphRowTop = (row: number, expandedRowIndex: number) => (
  row * GRAPH_ROW_HEIGHT + (expandedRowIndex >= 0 && row > expandedRowIndex ? GRAPH_EXPANDED_PANEL_HEIGHT : 0)
)

const buildGraphRowCenter = (row: number, expandedRowIndex: number) => (
  buildGraphRowTop(row, expandedRowIndex) + GRAPH_ROW_HEIGHT / 2
)

function ChangedFilesTree({
  nodes,
  depth = 0,
}: {
  nodes: ChangedFileTreeNode[]
  depth?: number
}) {
  return (
    <div>
      {nodes.map((node) => {
        if (node.kind === 'directory') {
          return (
            <div key={node.path}>
              <div
                className="flex min-h-7 items-center gap-2 rounded-md py-0.5 pr-2 text-[12px] text-zinc-300"
                style={buildChangedTreeIndent(depth)}
              >
                <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                <span className="truncate">{node.name}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-500">
                  <span className="text-emerald-400">+{node.additions}</span>
                  <span className="px-1 text-zinc-700">|</span>
                  <span className="text-rose-400">-{node.deletions}</span>
                </span>
              </div>
              <ChangedFilesTree nodes={node.children} depth={depth + 1} />
            </div>
          )
        }

        const statusMeta = formatFileStatusMeta(node.status)
        return (
          <div
            key={node.path}
            className="flex min-h-7 items-center gap-2 rounded-md py-0.5 pr-2 text-[12px] text-zinc-300"
            style={buildChangedTreeIndent(depth)}
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <span className="truncate">{node.name}</span>
            <Badge className={cn('shrink-0 border px-1.5 py-0 text-[10px]', statusMeta.className)}>
              {statusMeta.label}
            </Badge>
            <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-500">
              <span className="text-emerald-400">+{node.additions}</span>
              <span className="px-1 text-zinc-700">|</span>
              <span className="text-rose-400">-{node.deletions}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function WorkspaceGitGraph({
  commits,
  currentBranch,
  baseBranch,
  commitDiffResult,
  commitDiffLoading = false,
  selectedCommitSha,
  onSelectCommit,
}: WorkspaceGitGraphProps) {
  const { t } = useTranslation()
  const layout = useMemo(() => buildGraphLayout(commits), [commits])
  const selectedCommit = useMemo(
    () => commits.find((commit) => commit.sha === selectedCommitSha) ?? null,
    [commits, selectedCommitSha],
  )

  const selectedCommitIndex = useMemo(
    () => layout.nodes.findIndex((node) => node.commit.sha === selectedCommit?.sha),
    [layout.nodes, selectedCommit?.sha],
  )

  const expandedRowIndex = selectedCommitIndex >= 0 ? selectedCommitIndex : -1
  const graphColumnWidth = Math.max(110, layout.laneCount * GRAPH_LANE_WIDTH + GRAPH_LEFT_PADDING + GRAPH_RIGHT_PADDING)
  const tableMinWidth = graphColumnWidth + GRAPH_TABLE_DESCRIPTION_MIN_WIDTH + GRAPH_TABLE_DATE_WIDTH + GRAPH_TABLE_AUTHOR_WIDTH + GRAPH_TABLE_COMMIT_WIDTH
  const svgHeight = commits.length * GRAPH_ROW_HEIGHT + (selectedCommit ? GRAPH_EXPANDED_PANEL_HEIGHT : 0)
  const displayCurrentBranch = currentBranch || t('workspace.git.unprepared', { defaultValue: '未准备' })
  const activeCommitDiffResult = selectedCommit && commitDiffResult?.commitSha === selectedCommit.sha ? commitDiffResult : null
  const changedFileTree = useMemo(
    () => buildChangedFileTree(activeCommitDiffResult?.files ?? []),
    [activeCommitDiffResult?.files],
  )
  const changedFileSummary = useMemo(
    () => summarizeDiffFiles(activeCommitDiffResult?.files ?? []),
    [activeCommitDiffResult?.files],
  )

  if (commits.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 text-xs text-zinc-500">
        {t('workspace.git.graphEmpty', { defaultValue: '还没有可渲染的提交图。' })}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2 text-[11px] text-zinc-500">
        <Badge className="gap-1.5 border-sky-500/30 bg-sky-500/10 py-0.5 pl-2 text-sky-200">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
          <span
            className="block max-w-[28rem] truncate"
            title={t('workspace.git.currentBranchHeadValue', { defaultValue: '当前分支 / HEAD: {{value}}', value: displayCurrentBranch })}
          >
            {t('workspace.git.currentBranchHeadValue', { defaultValue: '当前分支 / HEAD: {{value}}', value: displayCurrentBranch })}
          </span>
        </Badge>
        <Badge className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 py-0.5 pl-2 text-emerald-200">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
          <span
            className="block max-w-[14rem] truncate"
            title={t('workspace.git.baseBranchValue', { defaultValue: 'Base branch: {{value}}', value: baseBranch })}
          >
            {t('workspace.git.baseBranchValue', { defaultValue: 'Base branch: {{value}}', value: baseBranch })}
          </span>
        </Badge>
        <span className="ml-auto text-zinc-600">{t('workspace.git.graphExpandHint', { defaultValue: '点击节点或行可展开提交详情' })}</span>
      </div>

      <ScrollArea className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block">
        <div style={{ minWidth: `${tableMinWidth}px` }}>
          <div
            className="grid border-b border-zinc-800 bg-zinc-950/95 text-[10.5px] font-medium uppercase tracking-[0.12em] text-zinc-500"
            style={{
              gridTemplateColumns: `${graphColumnWidth}px minmax(${GRAPH_TABLE_DESCRIPTION_MIN_WIDTH}px, 1fr) ${GRAPH_TABLE_DATE_WIDTH}px ${GRAPH_TABLE_AUTHOR_WIDTH}px ${GRAPH_TABLE_COMMIT_WIDTH}px`,
            }}
          >
            <div className="border-r border-zinc-800 px-4 py-2">{t('workspace.git.graphColumn', { defaultValue: 'Graph' })}</div>
            <div className="border-r border-zinc-800 px-4 py-2">{t('workspace.git.descriptionColumn', { defaultValue: 'Description' })}</div>
            <div className="border-r border-zinc-800 px-4 py-2">{t('workspace.git.dateColumn', { defaultValue: 'Date' })}</div>
            <div className="border-r border-zinc-800 px-4 py-2">{t('workspace.git.authorColumn', { defaultValue: 'Author' })}</div>
            <div className="px-4 py-2">{t('workspace.git.commitColumn', { defaultValue: 'Commit' })}</div>
          </div>

          <div
            className="grid"
            style={{ gridTemplateColumns: `${graphColumnWidth}px minmax(0, 1fr)` }}
          >
            <div className="border-r border-zinc-800 bg-zinc-950/90">
              <svg width={graphColumnWidth} height={svgHeight} className="block">
                {selectedCommit && expandedRowIndex >= 0 ? (
                  <>
                    <rect
                      x={0}
                      y={buildGraphRowTop(expandedRowIndex, expandedRowIndex)}
                      width={graphColumnWidth}
                      height={GRAPH_ROW_HEIGHT}
                      fill="#18181b"
                      opacity="0.95"
                    />
                    <rect
                      x={0}
                      y={buildGraphRowTop(expandedRowIndex, expandedRowIndex) + GRAPH_ROW_HEIGHT}
                      width={graphColumnWidth}
                      height={GRAPH_EXPANDED_PANEL_HEIGHT}
                      fill="#09090b"
                      opacity="0.82"
                    />
                  </>
                ) : null}

                {layout.edges.map((edge) => {
                  const color = pickLaneColor(edge.fromLane)
                  const x1 = GRAPH_LEFT_PADDING + edge.fromLane * GRAPH_LANE_WIDTH
                  const y1 = buildGraphRowCenter(edge.fromRow, expandedRowIndex)
                  const x2 = GRAPH_LEFT_PADDING + edge.toLane * GRAPH_LANE_WIDTH
                  const y2 = buildGraphRowCenter(edge.toRow, expandedRowIndex)
                  const midY = (y1 + y2) / 2

                  return (
                    <path
                      key={`${edge.fromRow}-${edge.toRow}-${edge.fromLane}-${edge.toLane}`}
                      d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                      fill="none"
                      stroke={color}
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity="0.9"
                    />
                  )
                })}

                {layout.nodes.map((node) => {
                  const color = pickLaneColor(node.lane)
                  const x = GRAPH_LEFT_PADDING + node.lane * GRAPH_LANE_WIDTH
                  const y = buildGraphRowCenter(node.row, expandedRowIndex)
                  const isSelected = node.commit.sha === selectedCommit?.sha

                  return (
                    <g
                      key={node.commit.sha}
                      className="cursor-pointer"
                      onClick={() => onSelectCommit?.(node.commit.sha)}
                    >
                      {isSelected ? (
                        <circle
                          cx={x}
                          cy={y}
                          r={11}
                          fill={color}
                          opacity="0.16"
                        />
                      ) : null}
                      {node.commit.isHead ? (
                        <circle
                          cx={x}
                          cy={y}
                          r={7.5}
                          fill="none"
                          stroke={color}
                          strokeWidth="1"
                          opacity="0.55"
                        />
                      ) : null}
                      <circle
                        cx={x}
                        cy={y}
                        r={isSelected ? 5.5 : 4}
                        fill={color}
                        stroke={isSelected ? '#fafafa' : '#09090b'}
                        strokeWidth={isSelected ? '2' : '1.5'}
                      />
                    </g>
                  )
                })}
              </svg>
            </div>

            <div>
              {layout.nodes.map((node) => {
                const isSelected = node.commit.sha === selectedCommit?.sha
                const { visibleRefs, hiddenCount } = splitVisibleRowRefs(node.commit.refs, currentBranch, baseBranch)

                return (
                  <Fragment key={node.commit.sha}>
                    <button
                      type="button"
                      onClick={() => onSelectCommit?.(node.commit.sha)}
                      className={cn(
                        'grid items-center border-b border-zinc-900/80 text-left transition-colors',
                        isSelected
                          ? 'border-b-0 bg-zinc-900/80'
                          : 'hover:bg-zinc-900/40',
                      )}
                      aria-expanded={isSelected}
                      aria-controls={isSelected ? `workspace-git-graph-details-${node.commit.sha}` : undefined}
                      style={{
                        height: `${GRAPH_ROW_HEIGHT}px`,
                        gridTemplateColumns: `minmax(${GRAPH_TABLE_DESCRIPTION_MIN_WIDTH}px, 1fr) ${GRAPH_TABLE_DATE_WIDTH}px ${GRAPH_TABLE_AUTHOR_WIDTH}px ${GRAPH_TABLE_COMMIT_WIDTH}px`,
                      }}
                    >
                      <div className="min-w-0 px-2.5">
                        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                          {visibleRefs.map((ref) => (
                            <Badge
                              key={`${node.commit.sha}-${ref}`}
                              className={cn(
                                'max-w-[11rem] shrink-0 border px-1.5 py-0 text-[9px] leading-4',
                                formatRefTone(ref, currentBranch, baseBranch),
                              )}
                              title={ref}
                            >
                              <span className="block truncate">{truncateRowRefLabel(ref)}</span>
                            </Badge>
                          ))}
                          {hiddenCount > 0 ? (
                            <Badge className="shrink-0 border border-zinc-800 bg-zinc-950 px-1.5 py-0 text-[9px] leading-4 text-zinc-400">
                              +{hiddenCount}
                            </Badge>
                          ) : null}
                          <span
                            className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-zinc-100"
                            title={node.commit.subject || '(no subject)'}
                          >
                            {node.commit.subject || '(no subject)'}
                          </span>
                        </div>
                      </div>
                      <div className="truncate px-2.5 text-[12px] text-zinc-400">
                        {formatCommitAuthorDateTime(node.commit.authorDate)}
                      </div>
                      <div className="truncate px-2.5 text-[12px] text-zinc-500">
                        {node.commit.authorName || '--'}
                      </div>
                      <div className="px-2.5 font-mono text-[12px] text-zinc-500">
                        {node.commit.shortSha}
                      </div>
                    </button>

                    {isSelected ? (
                      <div
                        id={`workspace-git-graph-details-${node.commit.sha}`}
                        className="border-b border-zinc-800 bg-zinc-950/70"
                        style={{ height: `${GRAPH_EXPANDED_PANEL_HEIGHT}px` }}
                      >
                        <div className="grid h-full grid-cols-[minmax(400px,1fr)_minmax(320px,0.95fr)] divide-x divide-zinc-800">
                          <div className="min-h-0 overflow-auto px-4 py-3.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-600">
                                  {t('workspace.git.commitDetailsTitle', { defaultValue: 'Commit Details' })}
                                </p>
                                {node.commit.refs.length > 0 ? (
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    {node.commit.refs.map((ref) => (
                                      <Badge
                                        key={`${node.commit.sha}-details-${ref}`}
                                        className={cn('border px-1.5 py-0 text-[9px]', formatRefTone(ref, currentBranch, baseBranch))}
                                      >
                                        {ref}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                              <div className="shrink-0 text-right font-mono text-[11px] text-zinc-600">
                                {node.commit.shortSha}
                              </div>
                            </div>

                            <div className="mt-4 grid grid-cols-[80px_minmax(0,1fr)] gap-x-4 gap-y-2.5">
                              <p className="pt-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                                {t('workspace.git.commitColumn', { defaultValue: 'Commit' })}
                              </p>
                              <p className="break-all font-mono text-[12.5px] leading-5 text-zinc-200">
                                {node.commit.sha}
                              </p>

                              <p className="pt-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                                {t('workspace.git.parentsLabel', { defaultValue: 'Parents' })}
                              </p>
                              <p className="break-all font-mono text-[12.5px] leading-5 text-zinc-300">
                                {node.commit.parents.length > 0 ? node.commit.parents.join(', ') : '--'}
                              </p>

                              <p className="pt-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                                {t('workspace.git.authorColumn', { defaultValue: 'Author' })}
                              </p>
                              <p className="text-[12.5px] leading-5 text-zinc-200">{node.commit.authorName || '--'}</p>

                              <p className="pt-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                                {t('workspace.git.dateColumn', { defaultValue: 'Date' })}
                              </p>
                              <p className="text-[12.5px] leading-5 text-zinc-200">{formatExpandedCommitDateTime(node.commit.authorDate)}</p>

                              <p className="pt-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                                {t('workspace.git.messageLabel', { defaultValue: 'Message' })}
                              </p>
                              <p className="whitespace-pre-wrap text-[12.5px] leading-5 text-zinc-200">
                                {node.commit.subject || '(no subject)'}
                              </p>
                            </div>
                          </div>

                          <div className="min-h-0 overflow-auto px-4 py-3.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-600">
                                  {t('workspace.git.changedFilesTitle', { defaultValue: 'Changed Files' })}
                                </p>
                                <p className="mt-1 text-xs text-zinc-600">
                                  {activeCommitDiffResult?.message || t('workspace.git.graphExpandHint', { defaultValue: '点击节点或行可展开提交详情' })}
                                </p>
                              </div>
                              {activeCommitDiffResult?.files.length ? (
                                <div className="shrink-0 font-mono text-[11px] text-zinc-600">
                                  <span>{t('workspace.git.changedFilesCount', { defaultValue: '{{count}} files', count: activeCommitDiffResult.files.length })}</span>
                                  <span className="px-2 text-zinc-700">|</span>
                                  <span className="text-emerald-400">+{changedFileSummary.additions}</span>
                                  <span className="px-1 text-zinc-700">|</span>
                                  <span className="text-rose-400">-{changedFileSummary.deletions}</span>
                                </div>
                              ) : null}
                            </div>

                            <div className="mt-3">
                              {commitDiffLoading && !activeCommitDiffResult ? (
                                <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-3 text-xs text-zinc-500">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  {t('workspace.git.commitDiffLoading', { defaultValue: '正在加载 commit diff…' })}
                                </div>
                              ) : changedFileTree.length > 0 ? (
                                <ChangedFilesTree nodes={changedFileTree} />
                              ) : (
                                <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-3 text-xs text-zinc-500">
                                  {activeCommitDiffResult?.message || t('workspace.git.commitDiffEmpty', { defaultValue: '当前提交没有可展示的 diff。' })}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </Fragment>
                )
              })}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
