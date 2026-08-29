import { Boxes, ChevronDown, ChevronRight, FileCode2, FileText, Folder, FolderOpen } from 'lucide-react'
import type { SkillFileInventoryEntry, SkillRecord } from '@shared/skill'
import type { CollaborationWorkspace, SkillScanResult } from '../../lib/api'
import type { PrimaryAgentDraft, SkillPolicy } from '../../lib/agent-config'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

type SkillTreeNode = {
  name: string
  path: string | null
  kind: 'dir' | 'file'
  fileKind?: SkillFileInventoryEntry['kind']
  children: SkillTreeNode[]
}

const TREE_BASE_INDENT = 16
const TREE_STEP_INDENT = 20
type Translate = ReturnType<typeof useTranslation>['t']

export function createSkillPolicy(skill: SkillRecord): SkillPolicy {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `skill-${skill.id}`,
    skillId: skill.id,
    slug: skill.slug,
    name: skill.name,
    description: skill.description ?? undefined,
    enabled: true,
    scope: 'agent',
    approvalMode: 'auto',
    tags: [],
  }
}

export function isSkillAttached(draft: PrimaryAgentDraft, skill: SkillRecord) {
  return draft.skills.some((item) => {
    return item.skillId === skill.id
      || item.slug === skill.slug
      || item.name.trim().toLowerCase() === skill.name.trim().toLowerCase()
  })
}

export function buildTree(entries: SkillFileInventoryEntry[]) {
  const root: SkillTreeNode = { name: '', path: null, kind: 'dir', children: [] }

  for (const entry of entries) {
    const segments = entry.path.split('/').filter(Boolean)
    let current = root
    let currentPath = ''

    for (const [index, segment] of segments.entries()) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      const isLeaf = index === segments.length - 1
      let next = current.children.find((child) => child.name === segment)

      if (!next) {
        next = {
          name: segment,
          path: isLeaf ? entry.path : currentPath,
          kind: isLeaf ? 'file' : 'dir',
          fileKind: isLeaf ? entry.kind : undefined,
          children: [],
        }
        current.children.push(next)
      }

      current = next
    }
  }

  const sortNode = (node: SkillTreeNode) => {
    node.children.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'dir' ? -1 : 1
      }
      if (left.name === 'SKILL.md') return -1
      if (right.name === 'SKILL.md') return 1
      return left.name.localeCompare(right.name)
    })
    node.children.forEach(sortNode)
  }

  sortNode(root)
  return root.children
}

export function ensureFileInventory(skill: SkillRecord) {
  if (skill.fileInventory.some((item) => item.path === 'SKILL.md')) {
    return skill.fileInventory
  }

  return [{ path: 'SKILL.md', kind: 'skill' as const }, ...skill.fileInventory]
}

export function findDefaultPath(skill: SkillRecord | null) {
  if (!skill) {
    return 'SKILL.md'
  }

  const inventory = ensureFileInventory(skill)
  return inventory.find((item) => item.path === 'SKILL.md')?.path ?? inventory[0]?.path ?? 'SKILL.md'
}

function fileKindIcon(kind: SkillFileInventoryEntry['kind']) {
  if (kind === 'reference' || kind === 'script') {
    return FileCode2
  }

  return FileText
}

export function formatUpdatedAt(value: string, language: 'zh' | 'en') {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function describeScanResult(result: SkillScanResult, t: Translate) {
  const parts = [
    result.scope === 'global'
      ? `Scanned ${result.scannedExecutors} executors`
      : t('agents.skillLibrary.scanSummary.scannedProjects', { count: result.scannedProjects }),
    t('agents.skillLibrary.scanSummary.discovered', { count: result.discovered }),
    t('agents.skillLibrary.scanSummary.imported', { count: result.imported.length }),
    t('agents.skillLibrary.scanSummary.updated', { count: result.updated.length }),
  ]

  if (result.skipped.length > 0) {
    parts.push(t('agents.skillLibrary.scanSummary.skipped', { count: result.skipped.length }))
  }

  return parts.join(' · ')
}

export function sourceBadgeMeta(skill: SkillRecord, t: Translate) {
  if (skill.sourceType === 'project') {
    return {
      label: t('agents.skillLibrary.badges.source.project'),
      className: 'border-sky-500/20 bg-sky-500/10 text-sky-200',
    }
  }

  return {
    label: t('agents.skillLibrary.badges.source.manual'),
    className: 'border-zinc-700 bg-zinc-900 text-zinc-300',
  }
}

export function trustBadgeMeta(skill: SkillRecord, t: Translate) {
  switch (skill.trustLevel) {
    case 'scripts_executables':
      return {
        label: t('agents.skillLibrary.badges.trust.scripts'),
        className: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
      }
    case 'assets':
      return {
        label: t('agents.skillLibrary.badges.trust.assets'),
        className: 'border-violet-500/20 bg-violet-500/10 text-violet-200',
      }
    default:
      return {
        label: t('agents.skillLibrary.badges.trust.markdown'),
        className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
      }
  }
}

export function compatibilityBadgeMeta(skill: SkillRecord, t: Translate) {
  switch (skill.compatibility) {
    case 'invalid':
      return {
        label: t('agents.skillLibrary.badges.compatibility.invalid'),
        className: 'border-rose-500/20 bg-rose-500/10 text-rose-200',
      }
    case 'unknown':
      return {
        label: t('agents.skillLibrary.badges.compatibility.unknown'),
        className: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
      }
    default:
      return {
        label: t('agents.skillLibrary.badges.compatibility.compatible'),
        className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
      }
  }
}

export function SkillTree({
  nodes,
  selectedPath,
  expandedDirs,
  onToggleDir,
  onSelectPath,
  depth = 0,
}: {
  nodes: SkillTreeNode[]
  selectedPath: string
  expandedDirs: Set<string>
  onToggleDir: (path: string) => void
  onSelectPath: (path: string) => void
  depth?: number
}) {
  return (
    <div>
      {nodes.map((node) => {
        if (node.kind === 'dir') {
          const expanded = node.path ? expandedDirs.has(node.path) : false

          return (
            <div key={node.path ?? node.name}>
              <button
                type="button"
                onClick={() => node.path && onToggleDir(node.path)}
                className="flex min-h-9 w-full items-center justify-between gap-2 pr-3 text-left text-sm text-zinc-500 transition-colors hover:bg-zinc-900/70 hover:text-zinc-100"
                style={{ paddingLeft: `${TREE_BASE_INDENT + depth * TREE_STEP_INDENT}px` }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {expanded ? <FolderOpen size={14} /> : <Folder size={14} />}
                  <span className="truncate">{node.name}</span>
                </span>
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {expanded ? (
                <SkillTree
                  nodes={node.children}
                  selectedPath={selectedPath}
                  expandedDirs={expandedDirs}
                  onToggleDir={onToggleDir}
                  onSelectPath={onSelectPath}
                  depth={depth + 1}
                />
              ) : null}
            </div>
          )
        }

        const Icon = fileKindIcon(node.fileKind ?? 'other')

        return (
          <button
            key={node.path ?? node.name}
            type="button"
            onClick={() => node.path && onSelectPath(node.path)}
            className={cn(
              'flex min-h-9 w-full items-center gap-2 pr-3 text-left text-sm transition-colors',
              node.path === selectedPath
                ? 'bg-zinc-900 text-zinc-100'
                : 'text-zinc-500 hover:bg-zinc-900/70 hover:text-zinc-100',
            )}
            style={{ paddingLeft: `${TREE_BASE_INDENT + depth * TREE_STEP_INDENT}px` }}
          >
            <Icon size={14} />
            <span className="truncate">{node.name}</span>
          </button>
        )
      })}
    </div>
  )
}

export function EmptyLibrary({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex min-h-[22rem] flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-zinc-800 bg-zinc-950/40 px-6 text-center">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">
        <Boxes size={22} />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-zinc-100">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">{description}</p>
    </div>
  )
}

export function CreateSkillInlinePanel({
  createName,
  createSlug,
  createDescription,
  metaSaving,
  onCreateNameChange,
  onCreateSlugChange,
  onCreateDescriptionChange,
  onCancel,
  onCreate,
}: {
  createName: string
  createSlug: string
  createDescription: string
  metaSaving: boolean
  onCreateNameChange: (value: string) => void
  onCreateSlugChange: (value: string) => void
  onCreateDescriptionChange: (value: string) => void
  onCancel: () => void
  onCreate: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="border-b border-zinc-800 bg-zinc-950/40 px-5 py-4">
      <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">{t('agents.skillLibrary.create.title')}</p>
      <div className="mt-3 space-y-3">
        <Input
          value={createName}
          onChange={(event) => onCreateNameChange(event.target.value)}
          placeholder={t('agents.skillLibrary.create.namePlaceholder')}
          className="border-zinc-800 bg-zinc-950/60 text-zinc-100 placeholder:text-zinc-500"
        />
        <Input
          value={createSlug}
          onChange={(event) => onCreateSlugChange(event.target.value)}
          placeholder="optional-shortname"
          className="border-zinc-800 bg-zinc-950/60 font-mono text-zinc-100 placeholder:text-zinc-500"
        />
        <Input
          value={createDescription}
          onChange={(event) => onCreateDescriptionChange(event.target.value)}
          placeholder={t('agents.skillLibrary.create.descriptionPlaceholder')}
          className="border-zinc-800 bg-zinc-950/60 text-zinc-100 placeholder:text-zinc-500"
        />
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-3 py-3 text-xs leading-5 text-zinc-500">
          {t('agents.skillLibrary.create.note')}
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            className="text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={onCreate}
            disabled={metaSaving}
            className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
          >
            {metaSaving ? t('agents.skillLibrary.create.creating') : t('agents.skillLibrary.create.createAction')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function ScanSourcePanel({ scanSummary }: { scanSummary: string }) {
  const { t } = useTranslation()
  return (
    <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">{t('agents.skillLibrary.scanSource.title')}</p>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        {t('agents.skillLibrary.scanSource.description')}
      </p>
      {scanSummary ? <p className="mt-2 text-xs text-zinc-500">{scanSummary}</p> : null}
    </div>
  )
}
