# Linear-Style UI Guide

> Wemux UI 开发规范。所有新页面、重构页面必须遵循本指南。

## 设计原则

1. **扁平优先** — 不用 Card 嵌套，用 border + bg 分区
2. **信息密度** — 紧凑间距，小字号，少留白
3. **色彩克制** — 单色为主，语义色仅用于状态指示
4. **键盘友好** — 所有交互元素可聚焦，ghost 按钮统一

---

## 色板

### 背景层级（由深到浅）

| Token | 用途 |
|---|---|
| `bg-[#050505]` | 页面根背景 |
| `bg-[#060607]` | 侧边栏、Tab 栏背景 |
| `bg-[#070708]` | 面板 Header 背景 |
| `bg-[#09090b]` | 主内容区、Dialog 背景 |
| `bg-zinc-950` | Input、Badge、卡片背景 |
| `bg-zinc-950/70` | Empty state 背景 |
| `bg-zinc-900/80` | 选中态列表项 |
| `bg-zinc-900/40` | Hover 态列表项 |

### 边框

| Token | 用途 |
|---|---|
| `border-zinc-900` | 主分隔线（panel divider、header border-b） |
| `border-zinc-800` | Input 边框、卡片边框、按钮边框 |
| `border-zinc-700` | Focus 态边框 |

### 文字

| Token | 用途 |
|---|---|
| `text-zinc-100` | 主标题 |
| `text-zinc-200` | 正文、Input 值 |
| `text-zinc-300` | 次要正文 |
| `text-zinc-400` | Ghost 按钮文字、idle 列表项 |
| `text-zinc-500` | Muted 文字、placeholder |
| `text-zinc-600` | 极淡辅助文字 |

### 语义色（仅用于状态）

| 状态 | Dot | Badge |
|---|---|---|
| active / completed | `bg-emerald-400` | `border-emerald-500/30 bg-emerald-500/10 text-emerald-300` |
| paused / coalesced | `bg-amber-400` | `border-amber-500/30 bg-amber-500/10 text-amber-300` |
| failed / archived | `bg-rose-400` | `border-rose-500/30 bg-rose-500/10 text-rose-300` |
| running / received | `bg-sky-400` | `border-sky-500/30 bg-sky-500/10 text-sky-300` |
| idle / default | `bg-zinc-500` | `border-zinc-700 bg-zinc-900 text-zinc-300` |

---

## 布局模式

### 模式 A：Resizable 双栏（首选）

用于列表 + 详情页（自动化、工作区等）。

```tsx
import { Group, Panel, Separator } from 'react-resizable-panels'

<Group orientation="horizontal" className="min-h-0 flex-1">
  <Panel defaultSize="22%" minSize="18%" maxSize="30%">
    {/* 左侧列表 */}
  </Panel>
  <Separator className="w-px bg-zinc-900" />
  <Panel defaultSize="78%" minSize="50%">
    {/* 右侧详情 */}
  </Panel>
</Group>
```

- `Separator` 用 `w-px bg-zinc-900`，可加 `group-hover:bg-zinc-700`
- 左侧面板 `bg-[#060607]`，右侧面板无额外背景

### 模式 B：Header Bar + Content

用于详情面板内部。

```tsx
<div className="flex h-full min-h-0 flex-col">
  {/* Header bar */}
  <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-900 px-4 py-2.5">
    <h2 className="text-sm font-semibold text-zinc-100 truncate">标题</h2>
    <div className="flex items-center gap-1.5">{/* 操作按钮 */}</div>
  </div>
  {/* Content */}
  <div className="flex-1 min-h-0 overflow-auto">...</div>
</div>
```

- Header 高度由内容撑开（`py-2.5`），不用固定 `h-11`
- 标题 `text-sm font-semibold text-zinc-100`
- 副标题 `text-[11px] text-zinc-600`

### 模式 C：Main + Settings Sidebar

用于表单页（详情区右侧放设置）。

```tsx
<div className="flex min-h-0 flex-1 overflow-hidden">
  {/* 主表单区 */}
  <div className="flex min-h-0 flex-1 flex-col overflow-auto">
    <div className="mx-auto w-full max-w-3xl space-y-5 px-6 py-5">
      {/* 表单字段 */}
    </div>
  </div>
  <div className="w-px shrink-0 bg-zinc-900" />
  {/* 设置边栏 */}
  <div className="w-[260px] shrink-0 overflow-auto border-l border-zinc-900 bg-[#060607]">
    <div className="space-y-4 px-4 py-4">{/* 字段 */}</div>
  </div>
</div>
```

---

## 组件规范

### 侧边栏列表项

```tsx
<button
  className={cn(
    'group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
    selected
      ? 'bg-zinc-900/80 text-zinc-100'
      : 'text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200',
  )}
>
  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
  <span className="min-w-0 truncate text-sm font-medium">{title}</span>
</button>
```

- 圆点和文字必须在同一个 `flex items-center` 容器内，保证水平对齐
- 圆点 `h-1.5 w-1.5 rounded-full`
- 选中态用背景色，不用边框

### 侧边栏搜索框

```tsx
<div className="relative">
  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
  <input
    className="h-7 w-full rounded-md border border-zinc-800 bg-zinc-950 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
  />
</div>
```

- 高度 `h-7`，圆角 `rounded-md`
- 搜索图标 `h-3.5 w-3.5`，绝对定位

### 表单控件（Input / SearchableSelect）

**常规 Input：**
```
h-9 rounded-lg border-zinc-800 bg-zinc-950 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700
```

**紧凑 Input（时间、数字）：**
```
h-7 w-14 rounded-lg border-zinc-800 bg-zinc-950 text-center text-xs text-zinc-200 focus:border-zinc-700
```

**SearchableSelect triggerClassName：**
```
h-8 rounded-lg px-2.5 text-xs
```

**规则：**
- 高度：常规 `h-9`，紧凑 `h-8` 或 `h-7`
- 圆角：统一 `rounded-lg`（8px），不用 `rounded-xl`
- 边框：`border-zinc-800`，focus `border-zinc-700`
- 背景：`bg-zinc-950`

### Section Label

```tsx
<label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
  {label}
</label>
```

变体：
- 紧凑：`text-[10px] uppercase tracking-[0.22em] text-zinc-500`
- 标准：`text-[11px] font-medium uppercase tracking-wide text-zinc-500`
- 带间距：`text-[11px] uppercase tracking-[0.18em] text-zinc-500`

### 按钮

**Primary（保存、确认）：**
```
h-7 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200
```

**Ghost Icon（侧边栏操作）：**
```
h-7 w-7 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200
```

**Ghost Icon with Border（Header 操作）：**
```
h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100
```

**Ghost Small（Header 内文字按钮）：**
```
h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100
```

**Dialog Cancel：**
```
h-8 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100
```

**Danger（归档、删除）— 在 DropdownMenuItem 上：**
```
text-rose-300 focus:bg-rose-500/10 focus:text-rose-100
```

**Chip 选中态：**
```
rounded-md px-2 py-1 text-[11px] font-medium bg-zinc-100 text-zinc-950
```

**Chip 未选中：**
```
rounded-md px-2 py-1 text-[11px] font-medium bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200
```

### Status Badge

```tsx
<Badge variant="outline" className={cn('text-[10px]', statusBadgeClassName(status))}>
  {status}
</Badge>
```

Badge 颜色见上方语义色表。

### Status Dot

```tsx
<span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotColor)} />
```

- 必须和相邻文字在同一个 `flex items-center` 容器内
- 不要用 `mt-*` 手动偏移

### Empty State

```tsx
<div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-5 text-center text-xs text-zinc-500">
  {message}
</div>
```

变体：
- 紧凑：`px-3 py-5 text-xs`
- 标准：`px-4 py-10 text-xs`
- 全屏占位：`flex h-full min-h-[24rem] items-center justify-center border border-dashed border-zinc-800 bg-[#09090b]`

### Dialog

```tsx
<DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-md">
```

- 背景 `bg-[#09090b]`
- 边框 `border-zinc-800`
- 阴影 `shadow-2xl shadow-black/40`
- 宽度：`sm:max-w-md`（窄）、`sm:max-w-[520px]`（中）、`sm:max-w-[640px]`（宽）

### DropdownMenu

```tsx
<DropdownMenuContent align="end" className="w-44">
  <DropdownMenuItem onSelect={action}>
    <Icon className="h-4 w-4" />
    {label}
  </DropdownMenuItem>
</DropdownMenuContent>
```

- 宽度：`w-44`（紧凑）、`w-52`（标准）、`w-56`（宽）
- Danger item：`className="text-rose-300 focus:bg-rose-500/10 focus:text-rose-100"`

### Tab Bar

```tsx
<div className="flex min-h-0 shrink-0 items-end gap-1 overflow-x-auto border-b border-zinc-900 bg-[#060607] px-2 pt-2">
  <div className={cn(
    'group flex max-w-[220px] shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-2.5 py-1.5 text-left text-xs transition-colors',
    selected
      ? 'border-zinc-800 bg-[#09090b] text-zinc-100'
      : 'border-zinc-900 bg-zinc-950/70 text-zinc-500 hover:border-zinc-800 hover:text-zinc-200',
  )}>
    ...
  </div>
</div>
```

---

## 页面骨架模板

```tsx
export function MyPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Group orientation="horizontal" className="min-h-0 flex-1">
        {/* 左侧列表 */}
        <Panel defaultSize="22%" minSize="18%" maxSize="30%">
          <div className="flex h-full min-h-0 flex-col border-r border-zinc-900 bg-[#060607]">
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-900 px-3 py-2.5">
              <span className="text-sm font-semibold text-zinc-200">Title</span>
              <div className="flex items-center gap-1">{/* Ghost icon buttons */}</div>
            </div>
            {/* Search */}
            <div className="shrink-0 border-b border-zinc-900 px-3 py-2">
              <input className="h-7 w-full rounded-md border border-zinc-800 bg-zinc-950 pl-8 pr-2 text-xs ..." />
            </div>
            {/* List */}
            <div className="flex-1 min-h-0 overflow-auto">
              <div className="px-1.5 py-1.5">{/* List items */}</div>
            </div>
          </div>
        </Panel>

        <Separator className="w-px bg-zinc-900" />

        {/* 右侧详情 */}
        <Panel defaultSize="78%" minSize="50%">
          <div className="flex h-full min-h-0 flex-col">
            {/* Header bar */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-900 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-zinc-100 truncate">Detail Title</h2>
              <div className="flex items-center gap-1.5">{/* Action buttons */}</div>
            </div>
            {/* Content */}
            <div className="flex-1 min-h-0 overflow-auto p-6">...</div>
          </div>
        </Panel>
      </Group>
    </div>
  )
}
```

---

## Checklist

新页面或重构页面提交前：

- [ ] 使用 `react-resizable-panels` 而非 CSS grid 做双栏
- [ ] 侧边栏 `bg-[#060607]`，主内容无额外背景
- [ ] 分隔线用 `border-zinc-900`，不用 `border-zinc-800`
- [ ] 列表项选中态用背景色（`bg-zinc-900/80`），不用边框高亮
- [ ] Status dot 和文字在同一个 `flex items-center` 容器
- [ ] Input 圆角 `rounded-lg`，不用默认的 `rounded-xl`
- [ ] SearchableSelect 传 `triggerClassName="h-8 rounded-lg px-2.5 text-xs"`
- [ ] Section label 用 `text-[11px] uppercase tracking-wide text-zinc-500`
- [ ] Primary 按钮 `bg-zinc-100 text-zinc-950`，不用蓝色
- [ ] 无 Card 嵌套，用 border + bg 分区
- [ ] Empty state 用 `border-dashed border-zinc-800`
