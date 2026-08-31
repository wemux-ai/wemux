// [INPUT]: AppBrand 解析语义验证
// [OUTPUT]: 默认 open-source 品牌 + registerAppBrand 覆盖语义的回归防线
// [POS]: 品牌单测——商业部署漏注册会被渲染成社区版（登录页/侧边栏 Community 文案），在此拦截。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import assert from 'node:assert/strict'
import test from 'node:test'
import { registerAppBrand, resolveAppBrand } from './brand'

test('default brand is the open-source edition', () => {
  const brand = resolveAppBrand()
  assert.equal(brand.name, 'wemux')
  assert.equal(brand.edition, 'open-source')
  assert.equal(brand.site, 'https://wemux.ai')
})

test('registerAppBrand overrides the edition for commercial deployments', () => {
  try {
    registerAppBrand({ name: 'wemux', site: 'https://wemux.ai', edition: 'cloud' })
    assert.equal(resolveAppBrand().edition, 'cloud')
  } finally {
    registerAppBrand({ name: 'wemux', site: 'https://wemux.ai', edition: 'open-source' })
  }
  assert.equal(resolveAppBrand().edition, 'open-source')
})
