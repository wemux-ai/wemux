import { Download, GitBranchPlus, RefreshCcw, ScanSearch, Sparkles } from 'lucide-react'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'

export type SkillsAction = 'create' | 'git' | 'download' | 'scan'

const tr = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

const actionTabs: Array<{
  id: SkillsAction
  icon: typeof Sparkles
}> = [
  { id: 'create', icon: Sparkles },
  { id: 'git', icon: GitBranchPlus },
  { id: 'download', icon: Download },
  { id: 'scan', icon: ScanSearch },
]

export function SkillActionPanel({
  activeAction,
  busy,
  createBusy,
  createDescription,
  createName,
  loading,
  downloadBusy,
  downloadUrl,
  gitBusy,
  gitRef,
  gitSubdirectory,
  gitUrl,
  scanBusy,
  onActionChange,
  onCreate,
  onCreateDescriptionChange,
  onCreateNameChange,
  onDownload,
  onDownloadUrlChange,
  onGit,
  onGitRefChange,
  onGitSubdirectoryChange,
  onGitUrlChange,
  onRefresh,
  onScan,
}: {
  activeAction: SkillsAction
  busy: boolean
  createBusy: boolean
  createDescription: string
  createName: string
  loading: boolean
  downloadBusy: boolean
  downloadUrl: string
  gitBusy: boolean
  gitRef: string
  gitSubdirectory: string
  gitUrl: string
  scanBusy: boolean
  onActionChange: (value: SkillsAction) => void
  onCreate: () => void
  onCreateDescriptionChange: (value: string) => void
  onCreateNameChange: (value: string) => void
  onDownload: () => void
  onDownloadUrlChange: (value: string) => void
  onGit: () => void
  onGitRefChange: (value: string) => void
  onGitSubdirectoryChange: (value: string) => void
  onGitUrlChange: (value: string) => void
  onRefresh: () => void
  onScan: () => void
}) {
  const { language } = useTranslation()

  const actionLabels: Record<SkillsAction, string> = {
    create: tr(language, '新建', 'Create'),
    git: 'Git',
    download: tr(language, '下载', 'Download'),
    scan: tr(language, '扫描', 'Scan'),
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{tr(language, '引入技能', 'Import Skills')}</p>
        <h3 className="mt-2 text-base font-semibold text-zinc-50">{tr(language, '把外部 skill 导入当前技能库', 'Import external skills into the current library')}</h3>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          {tr(language, '支持 Git、原始 SKILL.md 下载链接，以及项目或执行器全局目录扫描；导入后会立即进入左侧技能列表。', 'Supports Git, raw SKILL.md download links, and both project scans and executor global scans. Imported skills appear in the left library immediately.')}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 rounded-full border border-zinc-800 bg-[#09090b] p-1">
        {actionTabs.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onActionChange(id)}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm transition-colors sm:flex-none',
              activeAction === id ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
            )}
          >
            <Icon size={15} />
            {actionLabels[id]}
          </button>
        ))}
      </div>

      {activeAction === 'create' ? (
        <div className="space-y-3">
          <Input
            value={createName}
            onChange={(event) => onCreateNameChange(event.target.value)}
            placeholder={tr(language, 'skill 名称', 'Skill name')}
            className="border-zinc-800 bg-[#09090b] text-zinc-100 placeholder:text-zinc-500"
          />
          <Textarea
            value={createDescription}
            onChange={(event) => onCreateDescriptionChange(event.target.value)}
            rows={4}
            placeholder={tr(language, '一句话描述', 'One-line description')}
            className="border-zinc-800 bg-[#09090b] text-zinc-100 placeholder:text-zinc-500"
          />
          <Button
            onClick={onCreate}
            disabled={busy || createBusy}
            className="w-full rounded-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
          >
            {createBusy ? tr(language, '创建中...', 'Creating...') : tr(language, '创建 Skill', 'Create Skill')}
          </Button>
        </div>
      ) : null}

      {activeAction === 'git' ? (
        <div className="space-y-3">
          <Input
            value={gitUrl}
            onChange={(event) => onGitUrlChange(event.target.value)}
            placeholder="https://github.com/org/repo.git"
            className="border-zinc-800 bg-[#09090b] text-zinc-100 placeholder:text-zinc-500"
          />
          <Input
            value={gitRef}
            onChange={(event) => onGitRefChange(event.target.value)}
            placeholder={tr(language, 'branch / tag / commit（可选）', 'branch / tag / commit (optional)')}
            className="border-zinc-800 bg-[#09090b] text-zinc-100 placeholder:text-zinc-500"
          />
          <Input
            value={gitSubdirectory}
            onChange={(event) => onGitSubdirectoryChange(event.target.value)}
            placeholder={tr(language, 'skills/review（可选子目录）', 'skills/review (optional subdirectory)')}
            className="border-zinc-800 bg-[#09090b] text-zinc-100 placeholder:text-zinc-500"
          />
          <Button
            onClick={onGit}
            disabled={busy || gitBusy}
            className="w-full rounded-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
          >
            {gitBusy ? tr(language, '导入中...', 'Importing...') : tr(language, '从 Git 导入', 'Import from Git')}
          </Button>
        </div>
      ) : null}

      {activeAction === 'download' ? (
        <div className="space-y-3">
          <Textarea
            value={downloadUrl}
            onChange={(event) => onDownloadUrlChange(event.target.value)}
            rows={5}
            placeholder={tr(language, '填写 raw SKILL.md 或 Markdown 文本地址', 'Paste a raw SKILL.md or Markdown text URL')}
            className="border-zinc-800 bg-[#09090b] text-zinc-100 placeholder:text-zinc-500"
          />
          <Button
            onClick={onDownload}
            disabled={busy || downloadBusy}
            className="w-full rounded-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
          >
            {downloadBusy ? tr(language, '导入中...', 'Importing...') : tr(language, '下载并导入', 'Download and Import')}
          </Button>
        </div>
      ) : null}

      {activeAction === 'scan' ? (
        <div className="space-y-4">
          <p className="text-sm leading-7 text-zinc-500">
            {tr(language, '扫描支持项目目录和执行器 Home 下的全局 skill 目录，包含 `.claude/skills`、`.agents/skills`、`.codex/skills`、`.config/opencode/skills`、`.pi/skills`。', 'Scan both project directories and executor-home global skill directories, including `.claude/skills`, `.agents/skills`, `.codex/skills`, `.config/opencode/skills`, and `.pi/skills`.')}
          </p>
          <div className="flex flex-col gap-3">
            <Button
              onClick={onScan}
              disabled={busy || scanBusy}
              className="w-full rounded-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
            >
              {scanBusy ? tr(language, '扫描中...', 'Scanning...') : tr(language, '开始扫描 Skill', 'Start Skill Scan')}
            </Button>
            <Button
              variant="outline"
              onClick={onRefresh}
              disabled={loading}
              className="w-full rounded-full border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
            >
              <RefreshCcw size={16} />
              {tr(language, '刷新列表', 'Refresh')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
