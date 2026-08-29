import * as React from "react"
import * as Icons from "lucide-react"

/**
 * Registry 演示用的图标占位组件（shadcn registry 生成的标准组件依赖它渲染图标）。
 * 这里用 lucide-react 动态解析图标名，保持标准组件零改动可编译。
 */
export function IconPlaceholder({
  lucide,
  className,
}: {
  lucide?: string
  tabler?: string
  hugeicons?: string
  phosphor?: string
  remixicon?: string
  className?: string
}) {
  const Icon = lucide
    ? (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[lucide]
    : null
  if (!Icon) return null
  return <Icon className={className} />
}
