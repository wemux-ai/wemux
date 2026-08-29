// [INPUT]: 邮件发送请求（验证邮件 / 重置密码邮件）
// [OUTPUT]: 邮件发送结果
// [POS]: 邮件服务抽象；provider 由 env 决定（console 默认 / cloudflare Email Sending REST API）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type EmailProvider = 'console' | 'cloudflare'

export type SendEmailInput = {
  to: string
  subject: string
  text: string
  html?: string
}

/** console 模式最近发送的邮件（内存缓冲，便于本地/preview 联调查看验证链接）。 */
const recentConsoleEmails: Array<{ to: string; subject: string; text: string; sentAt: string }> = []

export const listRecentConsoleEmails = (limit = 20) => recentConsoleEmails.slice(0, limit)

/** 邮件发送状态（供前端提示：console 模式不会真实发送）。 */
export const getEmailSendingStatus = (): { provider: EmailProvider; configured: boolean; from: string } => {
  const provider = resolveEmailProvider()
  return {
    provider,
    configured: isEmailSendingConfigured(),
    from: resolveSenderAddress(),
  }
}

const resolveSenderAddress = (): string => {
  const sender = resolveSender()
  return typeof sender === 'string' ? sender : sender.address
}

export const resolveEmailProvider = (): EmailProvider => {
  const configured = process.env.EMAIL_PROVIDER?.trim().toLowerCase()
  if (configured === 'cloudflare') {
    return 'cloudflare'
  }
  return 'console'
}

/** 解析 EMAIL_FROM（支持 "name <address>" 或纯地址），返回 Cloudflare REST API 的 from 对象。 */
const resolveSender = (): string | { address: string; name?: string } => {
  const raw = process.env.EMAIL_FROM?.trim() || 'noreply@wemux.ai'
  const match = /^(.+?)\s*<([^>]+)>$/.exec(raw)
  if (match) {
    return { address: match[2].trim(), name: match[1].trim() }
  }
  return raw
}

export const isEmailSendingConfigured = (): boolean => {
  const provider = resolveEmailProvider()
  // console 模式仅打印日志（本地开发），不视为已配置真实邮件发送：
  // 社区版未配置邮件时，注册直接成功、不要求邮箱验证。
  if (provider === 'console') {
    return false
  }
  if (provider === 'cloudflare') {
    return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID?.trim() && process.env.CLOUDFLARE_API_TOKEN?.trim())
  }
  return false
}

/** 发送邮件。console 模式仅打印日志（本地开发）；cloudflare 走 Cloudflare Email Sending REST API。 */
export const sendEmail = async (input: SendEmailInput): Promise<{ ok: boolean; message?: string }> => {
  const provider = resolveEmailProvider()

  if (provider === 'console') {
    console.info(`[email:console] to=${input.to} subject=${input.subject}\n${input.text}`)
    recentConsoleEmails.unshift({ to: input.to, subject: input.subject, text: input.text, sentAt: new Date().toISOString() })
    if (recentConsoleEmails.length > 50) {
      recentConsoleEmails.length = 50
    }
    return { ok: true }
  }

  if (provider === 'cloudflare') {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
    const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim()
    if (!accountId || !apiToken) {
      return { ok: false, message: 'CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN 未配置。' }
    }
    try {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: input.to,
          from: resolveSender(),
          subject: input.subject,
          text: input.text,
          html: input.html,
        }),
      })
      const payload = await response.json().catch(() => null) as { success?: boolean; errors?: Array<{ code?: number; message?: string }> } | null
      if (!response.ok) {
        const detail = payload?.errors?.map((error) => `${error.code ?? ''} ${error.message ?? ''}`.trim()).filter(Boolean).join('; ')
        return { ok: false, message: `Cloudflare Email 发送失败（${response.status}）${detail ? `：${detail}` : ''}` }
      }
      if (payload?.success === false) {
        const detail = payload?.errors?.map((error) => `${error.code ?? ''} ${error.message ?? ''}`.trim()).filter(Boolean).join('; ')
        return { ok: false, message: `Cloudflare Email 发送失败${detail ? `：${detail}` : ''}` }
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Cloudflare Email 发送异常' }
    }
  }

  return { ok: false, message: '未知邮件 provider。' }
}

export const sendVerificationEmail = async (input: { email: string; name: string; url: string }): Promise<{ ok: boolean; message?: string }> => {
  const subject = '验证您的 wemux 邮箱'
  const text = [
    `你好 ${input.name}，`,
    '',
    '感谢注册 wemux。请点击以下链接验证您的邮箱（1 小时内有效）：',
    '',
    input.url,
    '',
    '如果这不是您的操作，请忽略此邮件。',
  ].join('\n')
  const html = [
    '<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">',
    `<h2>验证您的 wemux 邮箱</h2>`,
    `<p>你好 ${escapeHtml(input.name)}，感谢注册 wemux。</p>`,
    '<p>请点击下面的按钮验证邮箱（1 小时内有效）：</p>',
    `<p><a href="${escapeHtml(input.url)}" style="display:inline-block;padding:10px 20px;background:#10b981;color:#fff;border-radius:6px;text-decoration:none;">验证邮箱</a></p>`,
    '<p style="color:#888;">如果这不是您的操作，请忽略此邮件。</p>',
    '</div>',
  ].join('\n')
  return sendEmail({ to: input.email, subject, text, html })
}

export const sendResetPasswordEmail = async (input: { email: string; name: string; url: string }): Promise<{ ok: boolean; message?: string }> => {
  const subject = '重置您的 wemux 密码'
  const text = [
    `你好 ${input.name}，`,
    '',
    '我们收到了重置密码的请求。请点击以下链接设置新密码（1 小时内有效）：',
    '',
    input.url,
    '',
    '如果这不是您的操作，请忽略此邮件。',
  ].join('\n')
  return sendEmail({ to: input.email, subject, text })
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
