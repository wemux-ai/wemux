# Wemux Landing Page Design System

## 设计理念

Wemux 落地页采用极简、高级、专业的黑白灰设计语言，灵感来源于 Vetta 等现代 SaaS 产品。整体风格强调：
- 纯粹的黑白灰无彩色系统
- 大量留白和呼吸感
- 圆角卡片和现代化组件
- 微妙的渐变和阴影
- 清晰的视觉层级

---

## 颜色系统

### 主色调
```css
/* 背景色 */
--bg-primary: #0a0a0a;        /* 主背景 */
--bg-black: #000000;           /* 纯黑 */
--bg-card: #0a0a0a;            /* 卡片背景 */

/* 前景色 */
--fg-primary: #ffffff;         /* 主文字 */
--fg-secondary: rgb(244, 244, 245); /* zinc-100 */
```

### 灰度色阶
```css
--zinc-300: rgb(212, 212, 216);  /* 次要文字 */
--zinc-400: rgb(161, 161, 170);  /* 辅助文字、标签 */
--zinc-500: rgb(113, 113, 122);  /* 描述文字、禁用状态 */
--zinc-600: rgb(82, 82, 91);     /* 占位符、分隔线 */
--zinc-700: rgb(63, 63, 70);     /* 深色背景 */
--zinc-800: rgb(39, 39, 42);     /* 更深背景 */
--zinc-900: rgb(24, 24, 27);     /* 最深背景 */
```

### 强调色
```css
--emerald-400: rgb(52, 211, 153); /* 在线状态、成功状态 */
--emerald-500: rgb(16, 185, 129); /* 成功文字 */
--amber-300: rgb(252, 211, 77);   /* 警告状态 */
--sky-300: rgb(125, 211, 252);    /* 信息提示（少用）*/
--rose-300: rgb(253, 164, 175);   /* 错误状态 */
```

### 颜色使用规则

1. **背景层级**
   - 主背景：`#0a0a0a`
   - 卡片背景：`#0a0a0a` 或 `black/90`
   - 悬停状态：`#0d0b12` 或 `#101014`

2. **文字层级**
   - 标题：`text-white`
   - 正文：`text-zinc-300`
   - 辅助文字：`text-zinc-400` 或 `text-zinc-500`
   - 标签：`text-zinc-500` 或 `text-zinc-600`

3. **边框**
   - 主要边框：`border-white/[0.08]` 或 `border-white/[0.14]`
   - 悬停边框：`border-white/20` 或 `border-white/40`
   - 分隔线：`border-white/[0.06]` 或 `border-white/[0.07]`

---

## 圆角系统

```css
/* 圆角尺寸 */
rounded-lg:    0.5rem  (8px)   /* 小按钮 */
rounded-xl:    0.75rem (12px)  /* 中等卡片、节点 */
rounded-2xl:   1rem    (16px)  /* 大卡片、Panel */
rounded-[2rem]: 2rem   (32px)  /* 特大容器 */
rounded-full:  9999px          /* 完全圆形（按钮、头像、状态点）*/
```

### 圆角使用规则

- **按钮**：`rounded-lg` 或 `rounded-full`（药丸按钮）
- **卡片**：`rounded-2xl`
- **容器**：`rounded-xl` 到 `rounded-2xl`
- **状态指示器**：`rounded-full`
- **输入框**：`rounded-lg`

---

## 按钮系统

### 主按钮（Primary Button）
```tsx
<button className="rounded-lg bg-white px-7 py-3 text-xs font-bold text-black transition hover:bg-zinc-200">
  按钮文字
</button>
```
- 白色背景
- 黑色文字
- 圆角 `rounded-lg`
- 悬停变浅灰

### 次按钮（Secondary Button）
```tsx
<button className="rounded-lg bg-zinc-900/50 px-5 py-3 text-xs font-bold text-zinc-400 transition hover:bg-zinc-800/50 hover:text-zinc-200">
  按钮文字
</button>
```
- 深灰半透明背景
- 灰色文字
- 悬停变亮

### 文字按钮（Text Button）
```tsx
<a className="inline-flex items-center gap-2 text-sm font-medium text-zinc-300 transition hover:text-white">
  链接文字
</a>
```
- 无背景
- 灰色文字
- 悬停变白

### 药丸按钮（Pill Button）
```tsx
<button className="rounded-full px-5 py-2.5 bg-white text-black">
  标签
</button>
```
- 完全圆角
- 用于标签选择器

---

## 卡片系统

### 标准卡片（Panel）
```tsx
<div className="rounded-2xl border border-white/[0.08] bg-[#0a0a0a] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] p-6">
  内容
</div>
```

### 悬停卡片
```tsx
<div className="rounded-2xl border border-white/[0.08] bg-[#0a0a0a] transition hover:border-white/40 hover:bg-[#0d0b12]">
  内容
</div>
```

### 玻璃态卡片
```tsx
<div className="rounded-xl border border-white/[0.14] bg-black/90 backdrop-blur">
  内容
</div>
```

---

## 排版系统

### 字体家族
```css
font-family: "Inter Variable", system-ui, -apple-system, "Segoe UI", sans-serif;
```

### 标题层级

```tsx
// H1 - 超大标题
<h1 className="text-5xl sm:text-7xl lg:text-[7rem] font-medium leading-[0.96] tracking-[-0.07em] text-white">

// H2 - 区域标题
<h2 className="text-4xl sm:text-5xl font-medium tracking-[-0.06em] text-white">

// H3 - 卡片标题
<h3 className="text-xl font-medium tracking-[-0.04em] text-white">

// 小标签 (Eyebrow)
<p className="font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-500">
```

### 正文层级

```tsx
// 大正文
<p className="text-lg leading-8 text-zinc-300">

// 标准正文
<p className="text-sm leading-7 text-zinc-400">

// 小文字
<p className="text-xs leading-6 text-zinc-500">

// 代码/标签
<span className="font-mono text-[11px] font-bold uppercase tracking-[0.08em]">
```

---

## 间距系统

### 区域间距
```css
py-24:    6rem   (96px)  /* 标准区域上下间距 */
py-32:    8rem   (128px) /* 大区域间距 */
gap-4:    1rem   (16px)  /* 卡片网格间距 */
gap-6:    1.5rem (24px)  /* 更大间距 */
```

### 组件内间距
```css
p-6:      1.5rem (24px)  /* 卡片内边距 */
p-8:      2rem   (32px)  /* 大卡片内边距 */
px-7 py-3: 按钮内边距
```

### 元素间距
```css
mt-4:     1rem   (16px)  /* 段落间距 */
mt-6:     1.5rem (24px)  /* 区块间距 */
mt-8:     2rem   (32px)  /* 大区块间距 */
```

---

## 阴影系统

### 卡片阴影
```css
/* 标准卡片阴影 */
shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]

/* 深度阴影 */
shadow-[0_18px_60px_rgba(0,0,0,0.45)]

/* 组合阴影 */
shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_32px_96px_rgba(0,0,0,0.45)]
```

### 发光效果
```css
/* 状态点发光 */
shadow-[0_0_18px_rgba(52,211,153,0.7)]

/* 按钮发光（已废弃，不再使用）*/
```

---

## 渐变系统

### 径向渐变（用于微妙的背景效果）
```css
/* 顶部微光 */
bg-[radial-gradient(circle_at_70%_20%,rgba(255,255,255,0.04),transparent_34%)]

/* 底部微光 */
bg-[radial-gradient(circle_at_50%_100%,rgba(255,255,255,0.03),transparent_32%)]

/* 中心发光 */
bg-[radial-gradient(circle_at_50%_32%,rgba(255,255,255,0.06),transparent_58%)]
```

**注意**：避免使用紫色渐变，所有渐变应使用白色半透明。

---

## 动画与过渡

### 标准过渡
```css
transition               /* 默认过渡 */
transition-colors        /* 仅颜色过渡 */
transition-all           /* 所有属性过渡 */
duration-300            /* 300ms */
```

### 悬停效果
```tsx
// 卡片悬停
hover:border-white/40 hover:bg-[#0d0b12]

// 按钮悬停
hover:bg-zinc-200

// 文字悬停
hover:text-white

// 缩放悬停
hover:scale-105

// 位移悬停
hover:-translate-y-1
```

### 动画
```css
animate-pulse          /* 脉动动画（状态点）*/
```

---

## 图标系统

### 图标尺寸
```css
h-3.5 w-3.5   /* 14px - 按钮图标 */
h-4 w-4       /* 16px - 小图标 */
h-5 w-5       /* 20px - 标准图标 */
h-6 w-6       /* 24px - 大图标 */
```

### 图标颜色
- 跟随文字颜色：`currentColor`
- 状态图标：使用对应的强调色

---

## 响应式设计

### 断点系统
```css
sm:   640px   /* 小屏幕 */
md:   768px   /* 中等屏幕 */
lg:   1024px  /* 大屏幕 */
xl:   1280px  /* 超大屏幕 */
```

### 响应式模式

```tsx
// 移动优先
<div className="text-base sm:text-lg lg:text-xl">

// 响应式布局
<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">

// 隐藏/显示
<span className="hidden sm:block">
```

---

## 组件规范

### Hero Section
- 居中布局
- 超大标题（7rem）
- 白色主按钮 + 文字链接
- 特性标签（4个图标+文字）
- 产品预览标签（药丸按钮）

### 卡片区域
- 使用 `rounded-2xl` 圆角
- 边框 `border-white/[0.08]`
- 悬停效果：边框变亮，背景变浅

### 状态指示器
- 在线：`bg-emerald-400` + `shadow-[0_0_18px_rgba(52,211,153,0.7)]` + `animate-pulse`
- 繁忙：`bg-amber-300`
- 警告：`bg-rose-300`
- 暂停：`bg-zinc-500`

### 进度条
```tsx
<div className="h-1 rounded-full bg-white/[0.08]">
  <div className="h-full rounded-full bg-white" style={{ width: '78%' }} />
</div>
```

### 标签组
```tsx
// 药丸标签（可选择）
<button className={`rounded-full px-5 py-2.5 ${
  active
    ? 'bg-white text-black'
    : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700/50'
}`}>
```

---

## 禁止使用的元素

### ❌ 不要使用紫色
```css
/* 以下颜色已全面移除 */
violet-*
purple-*
```

### ❌ 不要使用密集网格背景
```css
/* 已移除的网格背景 */
[background-image:linear-gradient(...)]
```

### ❌ 不要使用紫色发光/阴影
```css
/* 已移除 */
shadow-[0_0_34px_rgba(124,58,237,0.18)]
```

---

## 最佳实践

### 1. 保持一致性
- 所有卡片使用相同的圆角尺寸
- 所有按钮使用相同的样式系统
- 所有间距遵循 4px 基准网格

### 2. 控制对比度
- 背景与文字对比度至少 4.5:1
- 悬停状态要明显但不刺眼
- 使用半透明颜色创建层次

### 3. 微妙的细节
- 使用 `inset` 阴影增加深度
- 边框使用低透明度（0.08-0.14）
- 渐变要非常微妙（0.03-0.06 透明度）

### 4. 性能优化
- 使用 `backdrop-blur` 时配合半透明背景
- 避免过度使用阴影
- 动画使用 `transform` 和 `opacity`

---

## 文件结构

```
apps/web/src/components/marketing/
├── landing-page.tsx              # 主落地页组件
├── landing-global-status.tsx     # 全域状态区域
├── landing-page-effects.tsx      # 特效组件
├── landing-product-preview.tsx   # 产品预览
└── marketing-page-layout.tsx     # 布局组件
```

---

## 维护指南

### 添加新组件时
1. 遵循现有的圆角系统（`rounded-2xl`）
2. 使用灰度色阶，避免彩色
3. 添加悬停状态
4. 确保响应式

### 修改颜色时
1. 检查对比度
2. 更新所有相关组件
3. 测试深色模式（已经是深色）

### 性能检查
1. 避免过多的 `backdrop-blur`
2. 优化渐变和阴影
3. 使用 CSS 变量共享值

---

## 设计资源

- **字体**: Inter Variable (Google Fonts)
- **图标**: Lucide Icons / Heroicons
- **灵感来源**: Vetta, Linear, Vercel
- **配色工具**: Tailwind CSS Zinc 色阶

---

## 更新日志

### v1.0 (2025-01)
- 从紫色系迁移到黑白灰系统
- 统一所有圆角为 `rounded-2xl`
- 移除所有网格背景
- 优化按钮和卡片样式
- 更新所有渐变和阴影
