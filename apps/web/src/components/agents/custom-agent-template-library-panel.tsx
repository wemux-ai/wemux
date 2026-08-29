import { Library, PencilLine, Trash2 } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'
import { ScrollArea } from '../ui/scroll-area'
import {
  CUSTOM_AGENT_CATEGORY_OPTIONS,
  type CustomAgentProfile,
  type CustomAgentTemplateLibraryItem,
} from '../../lib/custom-agent'
import { useTranslation } from '../../lib/i18n/react'
import { cn, formatDate } from '../../lib/utils'
import { EmptyCard } from './custom-agent-detail-panel-shared'
import type { TemplateLibraryCategoryFilter } from './custom-agent-registry-sidebar'

export function CustomAgentTemplateLibraryPanel({
  templateLibrary,
  filteredTemplateLibrary,
  selectedTemplateLibraryId,
  templateQuery,
  templateCategoryFilter,
  onTemplateQueryChange,
  onTemplateCategoryFilterChange,
  onSelectTemplateLibraryItem,
  onApplyTemplateLibraryItem,
  onUpdateTemplateLibraryItem,
  onDeleteTemplateLibraryItem,
}: {
  templateLibrary: CustomAgentTemplateLibraryItem[]
  filteredTemplateLibrary: CustomAgentTemplateLibraryItem[]
  selectedTemplateLibraryId: string
  templateQuery: string
  templateCategoryFilter: TemplateLibraryCategoryFilter
  onTemplateQueryChange: (value: string) => void
  onTemplateCategoryFilterChange: (value: TemplateLibraryCategoryFilter) => void
  onSelectTemplateLibraryItem: (itemId: string) => void
  onApplyTemplateLibraryItem: (itemId: string) => void
  onUpdateTemplateLibraryItem: (itemId: string) => void
  onDeleteTemplateLibraryItem: (itemId: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const categoryLabels = Object.fromEntries(
    CUSTOM_AGENT_CATEGORY_OPTIONS.map((option) => [option.value, option.label]),
  ) as Record<CustomAgentProfile['category'], string>

  return (
    <Card className="overflow-hidden rounded-xl border-zinc-800 bg-zinc-950/75 text-zinc-100 shadow-none">
      <CardHeader className="space-y-3 border-b border-zinc-800">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Library size={16} />
            {t('agents.custom.registry.templateLibrary')}
          </CardTitle>
          <Badge variant="outline" className="border-zinc-800 bg-zinc-950 text-zinc-400">
            {filteredTemplateLibrary.length} / {templateLibrary.length}
          </Badge>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
          <Input
            value={templateQuery}
            onChange={(event) => onTemplateQueryChange(event.target.value)}
            placeholder={t('agents.custom.registry.searchTemplate')}
            className="border-zinc-800 bg-zinc-950/70 text-zinc-100 placeholder:text-zinc-500"
          />
          <NativeSelect value={templateCategoryFilter} onChange={(event) => onTemplateCategoryFilterChange(event.target.value as TemplateLibraryCategoryFilter)}>
            <option value="all">{t('agents.custom.registry.filters.allTemplateCategory')}</option>
            {CUSTOM_AGENT_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </NativeSelect>
        </div>
      </CardHeader>

      <CardContent className="p-3">
        {templateLibrary.length === 0 ? (
          <EmptyCard text={t('agents.custom.registry.empty.noTemplates')} />
        ) : filteredTemplateLibrary.length === 0 ? (
          <EmptyCard text={t('agents.custom.registry.empty.noMatchedTemplates')} />
        ) : (
          <ScrollArea className="max-h-[20rem] pr-2">
            <div className="grid gap-3 xl:grid-cols-2">
              {filteredTemplateLibrary.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    'rounded-xl border px-4 py-4',
                    selectedTemplateLibraryId === item.id
                      ? 'border-zinc-700 bg-zinc-900'
                      : 'border-zinc-800 bg-[#09090b]',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectTemplateLibraryItem(item.id)}
                    className="w-full text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-100">{item.package.template.name}</p>
                        <p className="mt-1 text-xs text-zinc-500">{item.package.template.summary || '未填写模板摘要'}</p>
                      </div>
                      <Badge variant="outline" className="border-zinc-800 bg-zinc-950 text-[10px] text-zinc-400">
                        v{item.version}
                      </Badge>
                    </div>
                  </button>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                    <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5">
                      {categoryLabels[item.package.template.category] || item.package.template.category}
                    </span>
                    <span>{formatDate(item.updatedAt)}</span>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => onApplyTemplateLibraryItem(item.id)}
                      className="rounded-full bg-zinc-100 px-4 text-zinc-950 hover:bg-zinc-200"
                    >
                      {t('agents.custom.wizard.applyTemplate')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onUpdateTemplateLibraryItem(item.id)}
                      className="rounded-full border-zinc-700 bg-transparent px-3 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                    >
                      <PencilLine size={14} />
                      {t('agents.custom.registry.updateTemplate')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onDeleteTemplateLibraryItem(item.id)}
                      className="rounded-full px-3 text-zinc-500 hover:bg-zinc-900 hover:text-rose-300"
                    >
                      <Trash2 size={14} />
                      {t('agents.custom.registry.deleteTemplate')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
