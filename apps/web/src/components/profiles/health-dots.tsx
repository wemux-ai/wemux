// [INPUT]: 完成率评分（0-1，可为 null）+ 可选自定义提示
// [OUTPUT]: 5 格圆点（用于画像卡片/概览卡片）；null 显示灰色「暂无数据」态，不再伪装成中性评分
// [POS]: 画像展示辅助组件；纯展示，无数据获取
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { cn } from '../../lib/utils'

/** 完成率圆点：0-1 → 5 格实心圆点（0 低 → 5 高）；null = 无数据（灰点） */
export function HealthDots({ score, title }: { score: number | null; title?: string }) {
  if (score == null) {
    return (
      <span className="inline-flex items-center gap-0.5 opacity-60" title={title ?? '暂无数据'}>
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
        ))}
      </span>
    )
  }
  const filled = Math.round(score * 5)
  return (
    <span className="inline-flex items-center gap-0.5" title={title ?? `完成率 ${(score * 100).toFixed(0)}%`}>
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          className={cn('h-1.5 w-1.5 rounded-full', index < filled ? 'bg-emerald-400' : 'bg-zinc-800')}
        />
      ))}
    </span>
  )
}
