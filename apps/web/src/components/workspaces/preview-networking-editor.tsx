import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { ProjectEnvironmentPort } from '@shared/types'
import { normalizeEnvironmentPortDrafts } from '../../lib/preview-domain-bindings'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

type PreviewNetworkingEditorProps = {
  bindings: ProjectEnvironmentPort[]
  primaryPort?: string
  onChange: (bindings: ProjectEnvironmentPort[]) => void
}

const darkOutlineButtonClassName = 'border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-zinc-600 hover:bg-zinc-800 hover:text-white'

const createPortDraft = (): ProjectEnvironmentPort => ({
  id: crypto.randomUUID(),
  port: '',
  note: '',
  type: 'generated',
})

export function PreviewNetworkingEditor({
  bindings,
  primaryPort,
  onChange,
}: PreviewNetworkingEditorProps) {
  const [draft, setDraft] = useState<ProjectEnvironmentPort>(createPortDraft)
  const normalizedBindings = normalizeEnvironmentPortDrafts(bindings)
  const normalizedPrimaryPort = primaryPort?.trim() || ''

  const updateBinding = (id: string, patch: Partial<ProjectEnvironmentPort>) => {
    onChange(normalizedBindings.map((binding) => (
      binding.id === id ? { ...binding, ...patch } : binding
    )))
  }

  const removeBinding = (id: string) => {
    onChange(normalizedBindings.filter((binding) => binding.id !== id))
  }

  const handleAddPort = () => {
    const [next] = normalizeEnvironmentPortDrafts([draft])
    if (!next?.port?.trim()) {
      return
    }
    onChange([...normalizedBindings, next])
    setDraft(createPortDraft())
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-zinc-100">多端口预览</p>
        <p className="text-xs leading-5 text-zinc-400">
          默认预览端口由上面的字段控制。这里可以继续补充额外预览端口，Preview 面板会提供即时切换入口。
        </p>
      </div>

      {normalizedPrimaryPort ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Primary</p>
          <div className="mt-2 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-100">默认预览入口</p>
              <p className="mt-1 text-xs text-zinc-500">Port {normalizedPrimaryPort}</p>
            </div>
            <span className="rounded-full border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300">默认</span>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {normalizedBindings.length === 0 ? (
          <div className="border border-dashed border-zinc-800 bg-zinc-950/60 px-4 py-5 text-sm text-zinc-400">
            还没有额外预览端口。
          </div>
        ) : null}

        {normalizedBindings.map((binding, index) => (
          <div key={binding.id} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-100">
                  {binding.note?.trim() || `额外端口 ${index + 1}`}
                </p>
                <p className="mt-1 text-xs text-zinc-500">Port {binding.port}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-md text-zinc-500 hover:text-rose-300"
                onClick={() => removeBinding(binding.id)}
                aria-label="删除额外预览端口"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
              <label className="space-y-1.5">
                <span className="text-xs text-zinc-500">端口</span>
                <Input
                  value={binding.port}
                  onChange={(event) => updateBinding(binding.id, { port: event.target.value })}
                  placeholder="{{ add worktree.unique_id 4000 }}"
                  className="h-9 rounded-md border-zinc-800 bg-zinc-950 text-sm"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs text-zinc-500">备注</span>
                <Input
                  value={binding.note ?? ''}
                  onChange={(event) => updateBinding(binding.id, { note: event.target.value })}
                  placeholder={index === 0 ? 'Admin / API / Docs' : '备注这个端口的用途'}
                  className="h-9 rounded-md border-zinc-800 bg-zinc-950 text-sm"
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        <p className="text-sm font-medium text-zinc-100">新增额外预览端口</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]">
          <Input
            value={draft.port}
            onChange={(event) => setDraft((current) => ({ ...current, port: event.target.value }))}
            placeholder="{{ add worktree.unique_id 4000 }}"
            className="h-10 rounded-md border-zinc-800 bg-zinc-950 text-sm"
          />
          <Input
            value={draft.note ?? ''}
            onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
            placeholder="例如：Admin / API / Docs"
            className="h-10 rounded-md border-zinc-800 bg-zinc-950 text-sm"
          />
          <Button type="button" variant="outline" className={darkOutlineButtonClassName} onClick={handleAddPort}>
            <Plus className="h-4 w-4" />
            添加端口
          </Button>
        </div>
      </div>
    </div>
  )
}
