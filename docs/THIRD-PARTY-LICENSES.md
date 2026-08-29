# Third-Party Licenses

Wemux 以 Apache-2.0 开源。以下为直接/传递依赖的许可证分布（2026-08-20 扫描 pnpm 虚拟 store，共 6032 个包）。

## License 分布

| License | 包数 | 兼容性 |
|---|---|---|
| MIT | 3695 | ✅ 兼容 |
| Apache-2.0 | 652 | ✅ 兼容（同主协议） |
| ISC | 228 | ✅ 兼容 |
| 0BSD | 93 | ✅ 兼容 |
| BSD-3-Clause / BSD-2-Clause | 146 | ✅ 兼容 |
| BlueOak-1.0.0 | 27 | ✅ 兼容 |
| (MIT OR CC0-1.0) / CC0-1.0 / Unlicense | 19 | ✅ 兼容 |
| MIT OR Apache-2.0 | 5 | ✅ 兼容 |
| MPL-2.0 | 5 | ⚠️ 文件级 copyleft，静态分发需保留文件头（正常使用不受限） |
| LGPL-3.0-or-later | 6 | ⚠️ 动态链接/独立进程使用无传染；静态链接需提供可替换对象 |
| LGPL-2.1 | 2 | ⚠️ 同上 |
| OFL-1.1（字体） | 2 | ✅ 兼容 |
| Python-2.0 / CC-BY-* / WTFPL 等 | 12 | ✅ 兼容 |
| (MIT or GPL-2.0) | 2 | ✅ 取 MIT 分支 |
| UNKNOWN（无 license 字段） | 1124 | ⚠️ 需人工抽查 |

## 需要人工确认的项

1. **UNKNOWN 1124 个**：主要是无 `license` 字段的传递依赖 meta 包（`@types/*`、工具链内部包等）。建议在 CI 中接入 `license-checker` 或 `license-compliance` 对**直接依赖**做精确校验；传递依赖以本扫描为基线。
2. **LGPL 系（8 个）**：确认以动态链接/子进程方式使用（worker 侧的 CLI 工具调用即属此类），不静态链接进分发物。
3. **MPL-2.0（5 个）**：分发时保留对应文件的 MPL 头即可。
4. **字体 OFL（2 个）**：随 web 静态资源分发需保留 OFL 许可文本（`apps/web/public` 下字体）。

## 说明

- 扫描方式：遍历 `node_modules/.pnpm/*/node_modules/*/package.json` 的 `license`/`licenses` 字段
- 本文件随公开发行版带入仓库；新增依赖时需保持此文件更新
- 完整依赖清单以 `pnpm-lock.yaml` 为准
