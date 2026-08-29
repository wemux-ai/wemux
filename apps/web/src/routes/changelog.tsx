// [INPUT]: changelog 请求
// [OUTPUT]: 变更日志页
// [POS]: Changelog 页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import changelogMarkdown from '../../../../CHANGELOG.md?raw'
import { ChangelogPage } from '../components/changelog/changelog-page'

export const Route = createFileRoute('/changelog')({
  component: ChangelogRoute,
})

function ChangelogRoute() {
  return <ChangelogPage changelogMarkdown={changelogMarkdown} />
}
