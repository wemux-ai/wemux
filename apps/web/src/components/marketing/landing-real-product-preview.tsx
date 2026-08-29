/**
 * 落地页产品预览 - 真实产品界面映射
 *
 * 这个文件将真实产品的组件映射到落地页预览中
 * 使用静态数据模拟真实的产品界面
 */

import { useState } from 'react'
import type { Language } from '../../lib/i18n'

// 导入真实产品的设置组件
import { GlassRangeSetting } from '../settings/settings-page-content'
import { MenuPanel } from '../settings/settings-page-shared'
import { Button } from '../ui/button'
import { RotateCcw } from 'lucide-react'

// 模拟的主题状态
const mockTheme = 'dark' as const
const mockGlass = {
  opacity: 20,
  blur: 28,
  saturation: 109,
  borderOpacity: 14,
}

/**
 * 设置页面预览 - 外观设置
 * 直接使用真实产品的组件和样式
 */
export function RealSettingsAppearancePreview({
  language
}: {
  language: Language
}) {
  const [glass, setGlass] = useState(mockGlass)

  const updateGlass = (updates: Partial<typeof mockGlass>) => {
    setGlass((prev) => ({ ...prev, ...updates }))
  }

  const resetGlass = () => {
    setGlass(mockGlass)
  }

  return (
    <MenuPanel
      title={language === 'zh' ? '外观' : 'Appearance'}
      mobile={false}
    >
      <p className="text-sm text-zinc-400">
        {language === 'zh' ? '选择应用的颜色主题。设置会同步到你的账户。' : 'Choose the application color theme. Your choice is synced to your account.'}
      </p>

      <div className="grid gap-2 sm:grid-cols-3">
        {(['dark', 'light', 'system'] as const).map((option) => (
          <Button
            key={option}
            type="button"
            variant={mockTheme === option ? 'default' : 'outline'}
            className="h-11 justify-start"
          >
            {option === 'dark'
              ? (language === 'zh' ? '深色' : 'Dark')
              : option === 'light'
              ? (language === 'zh' ? '浅色' : 'Light')
              : (language === 'zh' ? '跟随系统' : 'System')}
          </Button>
        ))}
      </div>

      <div className="rounded-[1.15rem] border border-zinc-800/80 bg-zinc-950/45 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-zinc-100">
              {language === 'zh' ? '毛玻璃效果' : 'Glass effect'}
            </h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              {language === 'zh'
                ? '调整桌面端半透明壳层的暗度、模糊和边缘高光，改动会实时预览。'
                : 'Tune the desktop shell tint, blur, saturation, and edge highlight with a live preview.'}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetGlass}
            className="shrink-0 text-zinc-400 hover:text-zinc-100"
          >
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
            onChange={(value) => updateGlass({ opacity: value })}
          />
          <GlassRangeSetting
            id="glass-blur"
            label={language === 'zh' ? '模糊强度' : 'Blur strength'}
            hint={language === 'zh' ? '控制背景透过玻璃时的柔化程度。' : 'Controls how softly the background shows through.'}
            value={glass.blur}
            min={0}
            max={64}
            unit="px"
            onChange={(value) => updateGlass({ blur: value })}
          />
          <GlassRangeSetting
            id="glass-saturation"
            label={language === 'zh' ? '色彩饱和度' : 'Color saturation'}
            hint={language === 'zh' ? '控制背景颜色的鲜明程度。' : 'Controls the color intensity behind the glass.'}
            value={glass.saturation}
            min={80}
            max={160}
            unit="%"
            onChange={(value) => updateGlass({ saturation: value })}
          />
          <GlassRangeSetting
            id="glass-border-opacity"
            label={language === 'zh' ? '边缘高光' : 'Edge highlight'}
            hint={language === 'zh' ? '控制细边框和顶边高光的亮度。' : 'Controls the brightness of hairline borders and highlights.'}
            value={glass.borderOpacity}
            min={0}
            max={20}
            unit="%"
            onChange={(value) => updateGlass({ borderOpacity: value })}
          />
        </div>
      </div>
    </MenuPanel>
  )
}
