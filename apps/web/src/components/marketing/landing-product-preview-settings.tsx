import { RotateCcw } from 'lucide-react'
import { Button } from '../ui/button'

// 直接从真实产品代码复制的 GlassRangeSetting 组件
function GlassRangeSetting({
  id,
  label,
  hint,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  id: string
  label: string
  hint: string
  value: number
  min: number
  max: number
  unit: string
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <label htmlFor={id} className="text-sm font-medium text-zinc-200">{label}</label>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{hint}</p>
        </div>
        <output htmlFor={id} className="shrink-0 rounded-md border border-zinc-800/80 bg-zinc-900/60 px-2 py-1 text-xs tabular-nums text-zinc-300">
          {value}{unit}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer accent-emerald-400"
      />
      <div className="flex justify-between text-[10px] tabular-nums text-zinc-600" aria-hidden="true">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  )
}

// 外观设置预览（从真实产品代码直接搬过来）
export function SettingsAppearancePreview({ language }: { language: 'zh' | 'en' }) {
  const glass = { opacity: 20, blur: 28, saturation: 109, borderOpacity: 14 }

  return (
    <div className="space-y-6 p-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">{language === 'zh' ? '外观' : 'Appearance'}</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {language === 'zh' ? '选择应用的颜色主题。设置会同步到你的账户。' : 'Choose the application color theme. Your choice is synced to your account.'}
        </p>
      </div>

      {/* 主题选择按钮 */}
      <div className="grid gap-2 sm:grid-cols-3">
        <Button type="button" variant="outline" className="h-11 justify-start">
          {language === 'zh' ? '浅色' : 'Light'}
        </Button>
        <Button type="button" variant="default" className="h-11 justify-start">
          {language === 'zh' ? '深色' : 'Dark'}
        </Button>
        <Button type="button" variant="outline" className="h-11 justify-start">
          {language === 'zh' ? '跟随系统' : 'System'}
        </Button>
      </div>

      {/* 毛玻璃效果设置区块 */}
      <div className="rounded-[1.15rem] border border-zinc-800/80 bg-zinc-950/45 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-zinc-100">{language === 'zh' ? '毛玻璃效果' : 'Glass effect'}</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              {language === 'zh' ? '调整桌面端半透明壳层的暗度、模糊和边缘高光，改动会实时预览。' : 'Tune the desktop shell tint, blur, saturation, and edge highlight with a live preview.'}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" className="shrink-0 text-zinc-400 hover:text-zinc-100">
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            {language === 'zh' ? '恢复默认' : 'Reset'}
          </Button>
        </div>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <GlassRangeSetting
            id="glass-opacity"
            label={language === 'zh' ? '黑色浓度' : 'Dark tint'}
            hint={language === 'zh' ? '越高越接近不透明的黑色。' : 'Higher values make the shell darker and less transparent.'}
            value={glass.opacity}
            min={20}
            max={90}
            unit="%"
            onChange={() => {}}
          />
          <GlassRangeSetting
            id="glass-blur"
            label={language === 'zh' ? '模糊强度' : 'Blur strength'}
            hint={language === 'zh' ? '控制背景透过玻璃时的柔化程度。' : 'Controls how softly the background shows through.'}
            value={glass.blur}
            min={0}
            max={64}
            unit="px"
            onChange={() => {}}
          />
          <GlassRangeSetting
            id="glass-saturation"
            label={language === 'zh' ? '色彩饱和度' : 'Color saturation'}
            hint={language === 'zh' ? '控制背景颜色的鲜明程度。' : 'Controls the color intensity behind the glass.'}
            value={glass.saturation}
            min={80}
            max={160}
            unit="%"
            onChange={() => {}}
          />
          <GlassRangeSetting
            id="glass-border-opacity"
            label={language === 'zh' ? '边缘高光' : 'Edge highlight'}
            hint={language === 'zh' ? '控制细边框和顶边高光的亮度。' : 'Controls the brightness of hairline borders and highlights.'}
            value={glass.borderOpacity}
            min={0}
            max={20}
            unit="%"
            onChange={() => {}}
          />
        </div>
      </div>
    </div>
  )
}
