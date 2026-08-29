import type { ProjectEnvironmentPort } from '@shared/types'

import { useTranslation } from '../lib/i18n/react'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { PreviewNetworkingEditor } from './workspaces/preview-networking-editor'

export type EnvironmentTemplateEditorValue = {
  installCommand: string
  startCommandTemplate: string
  stopCommandTemplate: string
  logsCommandTemplate: string
  appPort: string
  healthPath: string
  ports: ProjectEnvironmentPort[]
}

type EnvironmentTemplateEditorProps = {
  value: EnvironmentTemplateEditorValue
  onChange: (value: EnvironmentTemplateEditorValue) => void
}

type TextFieldKey = Exclude<keyof EnvironmentTemplateEditorValue, 'ports'>

const tr = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

const commandInputClassName = 'rounded-lg border-zinc-800 bg-zinc-950 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:border-zinc-700'

export function EnvironmentTemplateEditor({ value, onChange }: EnvironmentTemplateEditorProps) {
  const { language } = useTranslation()

  const updateField = (key: TextFieldKey, nextValue: string) => {
    onChange({
      ...value,
      [key]: nextValue,
    })
  }

  const renderCommandField = (key: TextFieldKey, label: string, placeholder: string) => (
    <label className="space-y-1.5">
      <span className="text-xs text-zinc-400">{label}</span>
      <Textarea
        value={value[key]}
        onChange={(event) => updateField(key, event.target.value)}
        placeholder={placeholder}
        className={`${commandInputClassName} min-h-[60px]`}
      />
    </label>
  )

  const renderTextField = (key: TextFieldKey, label: string, placeholder: string) => (
    <label className="space-y-1.5">
      <span className="text-xs text-zinc-400">{label}</span>
      <Input
        value={value[key]}
        onChange={(event) => updateField(key, event.target.value)}
        placeholder={placeholder}
        className={`${commandInputClassName} h-10`}
      />
    </label>
  )

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs leading-5 text-zinc-500">
        {tr(
          language,
          '可用变量：{{environment.slug}}、{{worktree.path}}、{{worktree.unique_id}}、{{worktree.name}}、{{project.slug}}。需要给外部工具命名时，优先使用 {{environment.slug}}。',
          'Variables: {{environment.slug}}, {{worktree.path}}, {{worktree.unique_id}}, {{worktree.name}}, {{project.slug}}. Prefer {{environment.slug}} when naming external tool resources.',
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {renderCommandField('installCommand', tr(language, '安装命令', 'Install'), 'pnpm install')}
        {renderCommandField('startCommandTemplate', tr(language, '启动命令', 'Start'), 'pnpm dev')}
        {renderCommandField('stopCommandTemplate', tr(language, '停止命令', 'Stop'), 'pnpm stop')}
        {renderTextField('logsCommandTemplate', tr(language, '日志命令', 'Logs'), 'pnpm logs')}
        {renderTextField('appPort', tr(language, '默认预览端口', 'Default Preview Port'), '{{ add worktree.unique_id 3000 }}')}
        {renderTextField('healthPath', tr(language, '健康检查路径', 'Health Path'), '/health')}
      </div>

      <PreviewNetworkingEditor
        bindings={value.ports}
        onChange={(ports) => onChange({ ...value, ports })}
        primaryPort={value.appPort}
      />
    </div>
  )
}
