// [INPUT]: iLink (智联) Bot API 网关地址、登录凭证与消息读写请求。
// [OUTPUT]: 微信个人号 Bot 的登录二维码、消息长轮询、消息发送、媒体上传等 HTTP 操作。
// [POS]: 微信 iLink 渠道的传输层；登录状态机与消息编排由上层服务负责。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/** 腾讯官方微信 iLink（智联）Bot API 网关。
 * 协议来源：Tencent/openclaw-weixin（腾讯微信团队维护的开源插件，MIT 协议），
 * 端点：/ilink/bot/get_bot_qrcode、/ilink/bot/get_qrcode_status、/ilink/bot/getupdates、
 * /ilink/bot/sendmessage、/ilink/bot/getuploadurl、/ilink/bot/getconfig、/ilink/bot/sendtyping。
 */
export const ILINK_DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'
export const ILINK_BOT_TYPE = '3'

/** 微信 CDN 上传/下载基地址（协议默认，账号 baseUrl 内可带 CDN 配置）。 */
export const ILINK_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'

/** openclaw-weixin package.json 的 ilink_appid 与版本（用于 iLink-App-Id / ClientVersion 头）。 */
const ILINK_APP_ID = 'bot'
const ILINK_APP_CLIENT_VERSION = 0x020406

export type WeixinApiOptions = {
  baseUrl: string
  token?: string
  timeoutMs?: number
}

export type WeixinQrCodeResponse = {
  qrcode: string
  qrcode_img_content: string
}

export type WeixinQrStatus =
  | 'wait'
  | 'scaned'
  | 'confirmed'
  | 'expired'
  | 'scaned_but_redirect'
  | 'need_verifycode'
  | 'verify_code_blocked'
  | 'binded_redirect'

export type WeixinQrStatusResponse = {
  status: WeixinQrStatus
  bot_token?: string
  ilink_bot_id?: string
  baseurl?: string
  /** 扫码用户的微信 user id */
  ilink_user_id?: string
  /** scaned_but_redirect 时下发的 IDC 重定向主机 */
  redirect_host?: string
  errcode?: number
  errmsg?: string
}

export type WeixinCdnMedia = {
  encrypt_query_param?: string
  /** base64 编码的 AES-128 密钥 */
  aes_key?: string
  encrypt_type?: number
  /** 完整下载 URL（服务端直接返回，无需客户端拼接） */
  full_url?: string
}

export type WeixinMessageItem = {
  type: 1 | 2 | 3 | 4 | 5
  text_item?: { text: string }
  image_item?: {
    media?: WeixinCdnMedia
    /** 入站解密优先使用的 AES key（hex，16 字节） */
    aeskey?: string
    mid_size?: number
    hd_size?: number
    url?: string
  }
  voice_item?: {
    media?: WeixinCdnMedia
    /** 服务端转写文本（语音转文字） */
    text?: string
    encode_type?: number
    playtime?: number
  }
  file_item?: {
    media?: WeixinCdnMedia
    file_name?: string
    md5?: string
    len?: string
  }
  video_item?: {
    media?: WeixinCdnMedia
    video_size?: number
    play_length?: number
  }
  ref_msg?: unknown
}

export type WeixinMessage = {
  seq?: number
  message_id?: number
  from_user_id?: string
  to_user_id?: string
  create_time_ms?: number
  session_id?: string
  /** 1=USER, 2=BOT */
  message_type?: number
  /** 0=NEW, 1=GENERATING, 2=FINISH */
  message_state?: number
  item_list?: WeixinMessageItem[]
  /** 回复时必须原样回传的会话上下文 token */
  context_token?: string
}

export type WeixinGetUpdatesResponse = {
  ret: number
  errcode?: number
  errmsg?: string
  msgs?: WeixinMessage[]
  /** 下次长轮询必须携带的同步游标 */
  get_updates_buf?: string
  longpolling_timeout_ms?: number
}

export type WeixinSendMessageResponse = {
  ret: number
  errcode?: number
  errmsg?: string
  message_id?: number
}

export type WeixinGetConfigResponse = {
  ret: number
  errcode?: number
  errmsg?: string
  typing_ticket?: string
}

export type WeixinGetUploadUrlResponse = {
  ret: number
  errcode?: number
  errmsg?: string
  /** 原图上传加密参数（服务端未返回 upload_full_url 时用于拼接 CDN URL） */
  upload_param?: string
  /** 完整上传 URL（服务端直接返回，优先使用） */
  upload_full_url?: string
}

export type WeixinUploadedMedia = {
  /** 下载用加密查询参数（CDN 上传响应头 x-encrypted-param） */
  downloadEncryptedQueryParam: string
  /** AES-128 原始密钥（16 字节） */
  aesKey: Buffer
  /** 明文大小 */
  fileSize: number
  /** AES-128-ECB(PKCS7) 密文大小 */
  fileSizeCiphertext: number
}

/** proto: UploadMediaType */
export const WEIXIN_MEDIA_TYPE = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const

export type WeixinMediaType = typeof WEIXIN_MEDIA_TYPE[keyof typeof WEIXIN_MEDIA_TYPE]

export type WeixinSendTypingResponse = {
  ret: number
  errcode?: number
  errmsg?: string
}

/** 每个请求携带的基础信息（channel_version / bot_agent，参照官方插件 base_info）。 */
const buildBaseInfo = () => ({
  channel_version: 'vibemux-0.1.0',
  bot_agent: 'Wemux/0.3.116 (wechat-ilink channel)',
})

/** X-WECHAT-UIN：随机 uint32 → 十进制字符串 → base64。 */
const randomWechatUin = () => {
  const uint32 = randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(uint32), 'utf-8').toString('base64')
}

const buildHeaders = (token?: string) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
  }
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`
  return headers
}

const ensureTrailingSlash = (url: string) => (url.endsWith('/') ? url : `${url}/`)

const request = async <T>(params: {
  baseUrl: string
  endpoint: string
  method?: 'GET' | 'POST'
  token?: string
  body?: unknown
  timeoutMs?: number
  label: string
}): Promise<T> => {
  const url = new URL(params.endpoint, ensureTrailingSlash(params.baseUrl))
  const controller = params.timeoutMs ? new AbortController() : undefined
  const timer = controller ? setTimeout(() => controller.abort(), params.timeoutMs) : undefined
  try {
    const response = await fetch(url.toString(), {
      method: params.method ?? 'POST',
      headers: buildHeaders(params.token),
      body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
      signal: controller?.signal,
    })
    const raw = await response.text()
    if (!response.ok) {
      throw new Error(`${params.label} HTTP ${response.status}: ${raw.slice(0, 200)}`)
    }
    return JSON.parse(raw) as T
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 获取登录二维码。localTokenList 用于让服务端识别已绑定账号（可传空数组）。 */
export const fetchWeixinQrCode = (params: {
  baseUrl?: string
  botType?: string
  localTokenList?: string[]
}): Promise<WeixinQrCodeResponse> => {
  const baseUrl = params.baseUrl?.trim() || ILINK_DEFAULT_BASE_URL
  const botType = params.botType?.trim() || ILINK_BOT_TYPE
  return request<WeixinQrCodeResponse>({
    baseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    body: { local_token_list: params.localTokenList ?? [] },
    timeoutMs: 15_000,
    label: 'get_bot_qrcode',
  })
}

/** 长轮询扫码状态（服务端最长约 35s，超时视为 wait 继续轮询）。 */
export const pollWeixinQrStatus = async (params: {
  baseUrl?: string
  qrcode: string
  verifyCode?: string
}): Promise<WeixinQrStatusResponse> => {
  const baseUrl = params.baseUrl?.trim() || ILINK_DEFAULT_BASE_URL
  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(params.qrcode)}`
  if (params.verifyCode?.trim()) endpoint += `&verify_code=${encodeURIComponent(params.verifyCode.trim())}`
  try {
    return await request<WeixinQrStatusResponse>({
      baseUrl,
      endpoint,
      method: 'GET',
      timeoutMs: 35_000,
      label: 'get_qrcode_status',
    })
  } catch (error) {
    // 网关超时/网络抖动视为 wait，继续轮询（参照官方插件 pollQRStatus 语义）。
    if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('fetch failed'))) {
      return { status: 'wait' }
    }
    throw error
  }
}

/** 长轮询拉取新消息。返回空游标表示首次拉取；errcode -14 = 会话超时，需重置游标重新长轮询。 */
export const getWeixinUpdates = (params: {
  baseUrl: string
  token: string
  cursor: string
  timeoutMs?: number
}): Promise<WeixinGetUpdatesResponse> => {
  return request<WeixinGetUpdatesResponse>({
    baseUrl: params.baseUrl,
    endpoint: 'ilink/bot/getupdates',
    token: params.token,
    body: { get_updates_buf: params.cursor, ...buildBaseInfo() },
    timeoutMs: params.timeoutMs ?? 40_000,
    label: 'getupdates',
  })
}

/** 发送消息（文本/图片/视频/文件）。context_token 必须原样回传。 */
export const sendWeixinMessage = (params: {
  baseUrl: string
  token: string
  toUserId: string
  contextToken?: string
  itemList: WeixinMessageItem[]
  timeoutMs?: number
}): Promise<WeixinSendMessageResponse> => {
  return request<WeixinSendMessageResponse>({
    baseUrl: params.baseUrl,
    endpoint: 'ilink/bot/sendmessage',
    token: params.token,
    body: {
      msg: {
        to_user_id: params.toUserId,
        context_token: params.contextToken,
        item_list: params.itemList,
      },
      ...buildBaseInfo(),
    },
    timeoutMs: params.timeoutMs ?? 15_000,
    label: 'sendmessage',
  })
}

/** 发送/取消「正在输入」状态。 */
export const sendWeixinTyping = (params: {
  baseUrl: string
  token: string
  userId: string
  typingTicket: string
  status: 1 | 2
}): Promise<WeixinSendTypingResponse> => {
  return request<WeixinSendTypingResponse>({
    baseUrl: params.baseUrl,
    endpoint: 'ilink/bot/sendtyping',
    token: params.token,
    body: {
      ilink_user_id: params.userId,
      typing_ticket: params.typingTicket,
      status: params.status,
      ...buildBaseInfo(),
    },
    timeoutMs: 10_000,
    label: 'sendtyping',
  })
}

/** 获取账号配置（typing ticket 等）。 */
export const getWeixinConfig = (params: {
  baseUrl: string
  token: string
  userId: string
  contextToken?: string
}): Promise<WeixinGetConfigResponse> => {
  return request<WeixinGetConfigResponse>({
    baseUrl: params.baseUrl,
    endpoint: 'ilink/bot/getconfig',
    token: params.token,
    body: {
      ilink_user_id: params.userId,
      context_token: params.contextToken,
      ...buildBaseInfo(),
    },
    timeoutMs: 10_000,
    label: 'getconfig',
  })
}

/** AES-128-ECB 加密（PKCS7 填充）。 */
export const encryptAesEcb = (plaintext: Buffer, key: Buffer): Buffer => {
  const cipher = createCipheriv('aes-128-ecb', key, null)
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

/** AES-128-ECB 解密（PKCS7 填充）。 */
export const decryptAesEcb = (ciphertext: Buffer, key: Buffer): Buffer => {
  const decipher = createDecipheriv('aes-128-ecb', key, null)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/** AES-128-ECB(PKCS7) 密文大小（对齐 16 字节）。 */
export const aesEcbPaddedSize = (plaintextSize: number): number => {
  return Math.ceil((plaintextSize + 1) / 16) * 16
}

/** 获取 CDN 上传预签名参数。 */
export const getWeixinUploadUrl = (params: {
  baseUrl: string
  token: string
  filekey: string
  mediaType: 1 | 2 | 3
  toUserId: string
  rawsize: number
  rawfilemd5: string
  filesize: number
  aeskey: string
  timeoutMs?: number
}): Promise<WeixinGetUploadUrlResponse> => {
  return request<WeixinGetUploadUrlResponse>({
    baseUrl: params.baseUrl,
    endpoint: 'ilink/bot/getuploadurl',
    token: params.token,
    body: {
      filekey: params.filekey,
      media_type: params.mediaType,
      to_user_id: params.toUserId,
      rawsize: params.rawsize,
      rawfilemd5: params.rawfilemd5,
      filesize: params.filesize,
      no_need_thumb: true,
      aeskey: params.aeskey,
      ...buildBaseInfo(),
    },
    timeoutMs: params.timeoutMs ?? 15_000,
    label: 'getuploadurl',
  })
}

/**
 * 上传媒体到微信 CDN（AES-128-ECB 加密 + POST）。
 * 返回 CDN 下发的下载加密参数（x-encrypted-param），用于构造发送消息的 media 引用。
 */
export const uploadWeixinMediaToCdn = async (params: {
  buf: Buffer
  baseUrl: string
  token: string
  toUserId: string
  mediaType: 1 | 2 | 3
  cdnBaseUrl?: string
}): Promise<WeixinUploadedMedia> => {
  const rawsize = params.buf.length
  const rawfilemd5 = createHash('md5').update(params.buf).digest('hex')
  const fileSizeCiphertext = aesEcbPaddedSize(rawsize)
  const aesKey = randomBytes(16)
  const filekey = randomBytes(16).toString('hex')

  const uploadUrl = await getWeixinUploadUrl({
    baseUrl: params.baseUrl,
    token: params.token,
    filekey,
    mediaType: params.mediaType,
    toUserId: params.toUserId,
    rawsize,
    rawfilemd5,
    filesize: fileSizeCiphertext,
    aeskey: aesKey.toString('hex'),
  })
  if (uploadUrl.ret !== 0) {
    throw new Error(`getuploadurl failed: ${uploadUrl.errmsg || uploadUrl.errcode || uploadUrl.ret}`)
  }

  const uploadFullUrl = uploadUrl.upload_full_url?.trim()
  const uploadParam = uploadUrl.upload_param?.trim()
  if (!uploadFullUrl && !uploadParam) {
    throw new Error('getuploadurl returned no upload URL')
  }
  const cdnUrl = uploadFullUrl || (uploadParam
    ? `${params.cdnBaseUrl?.trim() || ILINK_CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`
    : '')
  const ciphertext = encryptAesEcb(params.buf, aesKey)

  let downloadEncryptedQueryParam = ''
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(cdnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(ciphertext),
      })
      if (!response.ok) {
        throw new Error(`CDN upload HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
      }
      downloadEncryptedQueryParam = response.headers.get('x-encrypted-param')?.trim() || ''
      if (!downloadEncryptedQueryParam) {
        throw new Error('CDN upload response missing x-encrypted-param header')
      }
      break
    } catch (error) {
      if (attempt >= 3) throw error
    }
  }

  return {
    downloadEncryptedQueryParam,
    aesKey,
    fileSize: rawsize,
    fileSizeCiphertext,
  }
}

/** 发送图片消息（先上传 CDN 再发送 image_item）。 */
export const sendWeixinImageMessage = (params: {
  baseUrl: string
  token: string
  toUserId: string
  contextToken?: string
  buf: Buffer
  cdnBaseUrl?: string
  timeoutMs?: number
}): Promise<WeixinSendMessageResponse> => {
  return sendWeixinMediaMessage({
    ...params,
    mediaType: WEIXIN_MEDIA_TYPE.IMAGE,
    buildItem: (uploaded) => ({
      type: 2,
      image_item: {
        media: {
          encrypt_query_param: uploaded.downloadEncryptedQueryParam,
          aes_key: uploaded.aesKey.toString('base64'),
          encrypt_type: 1,
        },
        mid_size: uploaded.fileSizeCiphertext,
      },
    }),
  })
}

/** 发送视频消息（media_type=VIDEO，video_item 带 video_size）。 */
export const sendWeixinVideoMessage = (params: {
  baseUrl: string
  token: string
  toUserId: string
  contextToken?: string
  buf: Buffer
  cdnBaseUrl?: string
  timeoutMs?: number
}): Promise<WeixinSendMessageResponse> => {
  return sendWeixinMediaMessage({
    ...params,
    mediaType: WEIXIN_MEDIA_TYPE.VIDEO,
    buildItem: (uploaded) => ({
      type: 5,
      video_item: {
        media: {
          encrypt_query_param: uploaded.downloadEncryptedQueryParam,
          aes_key: uploaded.aesKey.toString('base64'),
          encrypt_type: 1,
        },
        video_size: uploaded.fileSizeCiphertext,
      },
    }),
  })
}

/** 发送文件消息（media_type=FILE，file_item 带文件名与长度）。 */
export const sendWeixinFileMessage = (params: {
  baseUrl: string
  token: string
  toUserId: string
  contextToken?: string
  buf: Buffer
  fileName: string
  cdnBaseUrl?: string
  timeoutMs?: number
}): Promise<WeixinSendMessageResponse> => {
  return sendWeixinMediaMessage({
    ...params,
    mediaType: WEIXIN_MEDIA_TYPE.FILE,
    buildItem: (uploaded) => ({
      type: 4,
      file_item: {
        media: {
          encrypt_query_param: uploaded.downloadEncryptedQueryParam,
          aes_key: uploaded.aesKey.toString('base64'),
          encrypt_type: 1,
        },
        file_name: params.fileName,
        len: String(uploaded.fileSize),
      },
    }),
  })
}

/** 通用媒体发送：上传 CDN 后按 buildItem 构造对应 item 发送。 */
export const sendWeixinMediaMessage = async (params: {
  baseUrl: string
  token: string
  toUserId: string
  contextToken?: string
  buf: Buffer
  mediaType: 1 | 2 | 3
  cdnBaseUrl?: string
  timeoutMs?: number
  buildItem: (uploaded: WeixinUploadedMedia) => WeixinMessageItem
}): Promise<WeixinSendMessageResponse> => {
  const uploaded = await uploadWeixinMediaToCdn({
    buf: params.buf,
    baseUrl: params.baseUrl,
    token: params.token,
    toUserId: params.toUserId,
    mediaType: params.mediaType,
    cdnBaseUrl: params.cdnBaseUrl,
  })
  return sendWeixinMessage({
    baseUrl: params.baseUrl,
    token: params.token,
    toUserId: params.toUserId,
    contextToken: params.contextToken,
    itemList: [params.buildItem(uploaded)],
    timeoutMs: params.timeoutMs,
  })
}

/** 提取文本消息内容（首个 TEXT item）。 */
export const extractWeixinText = (message: WeixinMessage): string => {
  const text = message.item_list
    ?.filter((item): item is WeixinMessageItem & { text_item: { text: string } } => item.type === 1 && Boolean(item.text_item?.text))
    .map((item) => item.text_item.text.trim())
    .find((value) => Boolean(value))
  return text ?? ''
}

/** 语音消息是否包含可消费的转写文本。 */
export const hasWeixinVoiceTranscription = (message: WeixinMessage): boolean => Boolean(extractWeixinVoiceText(message))

/** 提取语音消息的服务端转写文本（voice_item.text，iLink 上游已转写）。 */
export const extractWeixinVoiceText = (message: WeixinMessage): string => {
  const text = message.item_list
    ?.filter((item): item is WeixinMessageItem & { voice_item: { text: string } } => item.type === 3 && Boolean(item.voice_item?.text))
    .map((item) => item.voice_item.text.trim())
    .find((value) => Boolean(value))
  return text ?? ''
}

/** 非文本消息的简短中文提示（入站媒体无法本地解码时先以文本提示交给 Agent）。 */
export const summarizeWeixinMedia = (message: WeixinMessage): string => {
  const labels: Record<number, string> = {
    2: '图片',
    3: '语音',
    4: '文件',
    5: '视频',
  }
  const parts: string[] = []
  for (const item of message.item_list ?? []) {
    if (item.type === 1) continue
    const label = labels[item.type]
    if (label) parts.push(label)
  }
  if (parts.length === 0) return ''
  return `[收到${parts.length === 1 ? parts[0] : parts.join('、')}消息]`
}

/** 提取首个媒体 item（图片/语音/文件/视频）并给出中文类型与扩展名。 */
export const pickWeixinMediaItem = (message: WeixinMessage): { item: WeixinMessageItem; kind: 'image' | 'voice' | 'file' | 'video'; ext: string } | null => {
  for (const item of message.item_list ?? []) {
    if (item.type === 2 && item.image_item) return { item, kind: 'image', ext: 'png' }
    if (item.type === 3 && item.voice_item) return { item, kind: 'voice', ext: 'silk' }
    if (item.type === 4 && item.file_item) return { item, kind: 'file', ext: 'bin' }
    if (item.type === 5 && item.video_item) return { item, kind: 'video', ext: 'mp4' }
  }
  return null
}

/**
 * 从入站媒体 item 下载并 AES-128-ECB 解密（微信 CDN 加密传输）。
 * 优先使用 item 内 media.full_url；否则按 CDN 基地址拼接 download 端点。
 */
export const downloadWeixinMedia = async (params: {
  item: WeixinMessageItem
  cdnBaseUrl?: string
}): Promise<Buffer | null> => {
  const media = params.item.image_item?.media
    ?? params.item.video_item?.media
    ?? params.item.file_item?.media
    ?? params.item.voice_item?.media
  if (!media) return null

  const downloadUrl = media.full_url?.trim()
    || (media.encrypt_query_param
      ? `${params.cdnBaseUrl?.trim() || ILINK_CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param)}`
      : '')
  if (!downloadUrl) return null

  const aesKeySource = params.item.image_item?.aeskey?.trim() || media.aes_key?.trim()
  if (!aesKeySource) return null

  const response = await fetch(downloadUrl)
  if (!response.ok) {
    throw new Error(`微信媒体下载失败：HTTP ${response.status}`)
  }
  const ciphertext = Buffer.from(await response.arrayBuffer())

  // aes_key：base64 编码的 16 字节；image_item.aeskey 为 hex 编码的 16 字节（优先）
  const key = params.item.image_item?.aeskey?.trim()
    ? Buffer.from(params.item.image_item.aeskey.trim(), 'hex')
    : Buffer.from(media.aes_key?.trim() || '', 'base64')
  if (key.length !== 16) {
    throw new Error('微信媒体 AES 密钥长度非法')
  }
  return decryptAesEcb(ciphertext, key)
}
