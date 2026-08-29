import { generateRandomProjectColor, getProjectColor, normalizeHexColor } from '@shared/project-color'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from '../lib/i18n/react'
import { Button } from './ui/button'

const PROJECT_COLOR_PRESETS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#22c55e',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
]

interface ProjectColorFieldProps {
  color?: string
  projectName: string
  onChange: (color: string) => void
}

export function ProjectColorField({ color, projectName, onChange }: ProjectColorFieldProps) {
  const { language } = useTranslation()
  const normalizedColor = normalizeHexColor(color) ?? ''
  const previewColor = getProjectColor({ name: projectName || 'project', color })

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-100">{language === 'zh' ? '项目颜色' : 'Project Color'}</p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="h-5 w-5 rounded-md border border-white/10"
            style={{ backgroundColor: previewColor }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            onClick={() => onChange(generateRandomProjectColor())}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {language === 'zh' ? '自动' : 'Auto'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {PROJECT_COLOR_PRESETS.map((preset) => {
          const active = preset === normalizedColor

          return (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(preset)}
              className={`h-7 w-7 rounded-md border transition-transform hover:scale-105 ${
                active ? 'border-zinc-100' : 'border-white/10'
              }`}
              style={{ backgroundColor: preset }}
              aria-label={language === 'zh' ? `选择颜色 ${preset}` : `Pick color ${preset}`}
              title={preset}
            />
          )
        })}
      </div>

      <div className="flex items-center gap-3">
        <input
          type="color"
          value={normalizedColor || previewColor}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-14 cursor-pointer rounded-md border border-zinc-800 bg-zinc-950 p-1"
        />
        <div className="min-w-0">
          <p className="text-xs text-zinc-400">{normalizedColor || (language === 'zh' ? '自动生成' : 'Auto-generated')}</p>
        </div>
      </div>
    </div>
  )
}
