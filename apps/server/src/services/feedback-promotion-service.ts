/**
 * [INPUT]: admin promote 请求（feedback id + scope）、env GitHub 凭据（WEMUX_FEEDBACK_PROMOTION_GITHUB_TOKEN）
 * [OUTPUT]: 受限维护队列/公开仓 Issue 创建 + githubRef 写回；buildIssuePayload 纯函数可测
 * [POS]: 治理闭环 D8 的落点动作；community 域强制 consentPublic 红线，未配置凭据时显式降级（503）
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { getEnv } from '@shared/env'
import type { FeedbackGithubRef, FeedbackItem, FeedbackRoutingTarget } from '@shared/types'
import {
  getFeedbackItem,
  setFeedbackGithubRef,
  updateFeedbackRouting,
} from '../storage/postgres/feedback-store'

export type FeedbackPromotionScope = Extract<FeedbackRoutingTarget, 'internal' | 'community'>

export const DEFAULT_COMMUNITY_PROMOTION_REPO = 'wemux-ai/wemux'

export class FeedbackPromotionError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 502 | 503,
    message: string,
  ) {
    super(message)
  }
}

const repoForScope = (scope: FeedbackPromotionScope): string => {
  const name = scope === 'internal' ? 'WEMUX_FEEDBACK_INTERNAL_REPO' : 'WEMUX_FEEDBACK_COMMUNITY_REPO'
  const repo = getEnv(name)?.trim() || (scope === 'community' ? DEFAULT_COMMUNITY_PROMOTION_REPO : '')
  if (!repo) {
    throw new FeedbackPromotionError(503, `未配置 ${name}，无法创建 ${scope} issue`)
  }
  return repo
}

/** 纯函数：由反馈条目构建 issue 标题/正文/labels。community 域未同意公开时拒绝。 */
export const buildIssuePayload = (
  item: FeedbackItem,
  scope: FeedbackPromotionScope,
): { title: string; body: string; labels: string[] } => {
  if (scope === 'community' && !item.consentPublic) {
    throw new FeedbackPromotionError(409, '该反馈未同意公开（consentPublic=false），不能发到社区仓')
  }

  const title = `[feedback] ${item.title}`.slice(0, 200)

  const sections: string[] = []
  const draft = item.normalized?.draft
  if (draft?.background) sections.push(`## 背景\n${draft.background}`)
  if (draft?.scenario) sections.push(`## 场景\n${draft.scenario}`)
  if (draft?.expectation) sections.push(`## 期望\n${draft.expectation}`)
  if (draft?.acceptance?.length) sections.push(`## 验收标准\n${draft.acceptance.map((line) => `- [ ] ${line}`).join('\n')}`)
  sections.push(`## 原始反馈\n> ${item.body.split('\n').join('\n> ')}`)

  const meta = [
    '---',
    `<!-- wemux-feedback:${item.id} -->`,
    `source: ${item.source ?? 'product'} · routing: ${scope} · consentPublic: ${item.consentPublic ? 'yes' : 'no'}`,
    `created: ${item.createdAt}`,
  ].join('\n')

  return { title, body: `${sections.join('\n\n')}\n\n${meta}`, labels: [] }
}

type CreatedIssue = { url: string; number: number }

const createIssueViaApi = async (
  repo: string,
  token: string,
  payload: { title: string; body: string; labels: string[] },
): Promise<CreatedIssue> => {
  const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    throw new FeedbackPromotionError(502, `GitHub 创建 issue 失败（${response.status}）：${detail}`)
  }
  const data = (await response.json()) as { html_url?: string; number?: number }
  if (!data.html_url || typeof data.number !== 'number') {
    throw new FeedbackPromotionError(502, 'GitHub 响应缺少 html_url/number 字段')
  }
  return { url: data.html_url, number: data.number }
}

/** 把一条反馈 promote 成 GitHub issue（internal=受限维护队列 / community=公开仓），并写回 routing + githubRef。 */
export const promoteFeedbackToIssue = async (id: string, scope: FeedbackPromotionScope): Promise<FeedbackItem> => {
  const item = await getFeedbackItem(id)
  if (!item) throw new FeedbackPromotionError(404, '反馈不存在')
  if (item.githubRef) throw new FeedbackPromotionError(409, '该反馈已 promote 过')
  if (item.routing && item.routing !== scope) {
    throw new FeedbackPromotionError(409, `分诊去向为 ${item.routing}，与目标 ${scope} 不一致；请先在管理页修正去向`)
  }

  const token = getEnv('WEMUX_FEEDBACK_PROMOTION_GITHUB_TOKEN')?.trim()
  if (!token) throw new FeedbackPromotionError(503, '未配置 WEMUX_FEEDBACK_PROMOTION_GITHUB_TOKEN，无法创建 issue')

  const payload = buildIssuePayload(item, scope)
  const created = await createIssueViaApi(repoForScope(scope), token, payload)

  if (item.routing !== scope) {
    await updateFeedbackRouting(id, scope)
  }
  const ref: FeedbackGithubRef = {
    kind: 'issue',
    scope,
    url: created.url,
    number: created.number,
    promotedAt: new Date().toISOString(),
  }
  const updated = await setFeedbackGithubRef(id, ref)
  if (!updated) throw new FeedbackPromotionError(404, '反馈不存在（写回 githubRef 时）')
  return updated
}
