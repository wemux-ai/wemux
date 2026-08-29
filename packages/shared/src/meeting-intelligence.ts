// 会议智能（feature）端侧 → 云端 上传契约 V1
//
// [INPUT]: 端侧录音链路（VAD 切段 → 转写 → 说话人 ID → 价值判断）产出的片段与决策
// [OUTPUT]: 云端三通道（cloud_db / cloud_agent / memory_doc）+ 会议实体契约
// [POS]: 纯类型与纯函数，无浏览器/Node 副作用；与 feature v4 规格对齐（音频不出设备，仅文本上行）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。本文件为 feature/feature 联合冻结的 V1 契约锚点。

/**
 * 端侧价值片段的「三通道」路由目标（feature v4 决策②）
 * - cloud_db：结构化写入云端数据库（片段/标签/说话人/时间 → 查询/统计/看板）
 * - cloud_agent：触发云端 Agent 归纳报告（agent-event-inbox → custom-agent）
 * - memory_doc：文本追加到云端记忆文档（与 feature 协同）
 */
export type MeetingValueChannel = 'cloud_db' | 'cloud_agent' | 'memory_doc'

/** 会议状态：端侧判定后创建/更新；closed 由用户或云端关闭 */
export type MeetingStatus = 'active' | 'closed'

/** 端侧录音模式（feature v4 功耗三级模式） */
export type RecordingMode = 'idle' | 'listening' | 'recording'

/** 端侧功耗档位（feature §4：温度 >45°C 降档） */
export type PowerLevel = 'full' | 'listen_only' | 'transcribe' | 'agent' | 'off'

/** VAD 切段参数（feature v3 已确认：静音 1.5–3s 切段、padding 0.3–0.5s、<3s 丢弃、5–10min 强制封段） */
export interface VadConfig {
  sampleRate: number
  /** 静音达到该毫秒数则切段 */
  silenceMs: number
  /** 强制封段最大毫秒数（5–10min） */
  maxSegmentMs: number
  /** 低于该毫秒数的片段丢弃（默认 3s） */
  dropShorterThanMs: number
  /** 段头尾 padding 毫秒（默认 300–500ms） */
  paddingMs: number
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  sampleRate: 16000,
  silenceMs: 2000,
  maxSegmentMs: 10 * 60 * 1000,
  dropShorterThanMs: 3000,
  paddingMs: 400,
}

/** 本地生命周期策略（feature §4：音频默认 7 天、转写文本 30–90 天、容量告警 + 降级） */
export interface LocalLifecyclePolicy {
  /** 原始音频（Opus 有效段）本地保留天数 */
  audioRetentionDays: number
  /** 转录文本本地保留天数 */
  transcriptRetentionDays: number
  /** 触发容量告警的占用比例（0-1） */
  capacityAlertRatio: number
  /** 低于该空闲比例时进入「只监听不落盘」降级模式（0-1） */
  degradedListenOnlyRatio: number
}

export const DEFAULT_LIFECYCLE_POLICY: LocalLifecyclePolicy = {
  audioRetentionDays: 7,
  transcriptRetentionDays: 60,
  capacityAlertRatio: 0.8,
  degradedListenOnlyRatio: 0.05,
}

/** 说话人 ID：端侧无监督聚类产物（spk0/spk1…），云端负责「认人」推断 */
export type SpeakerId = string

/**
 * 价值片段上传载荷（端侧 → 云端，仅文本；音频不出设备红线）
 * 由端侧小 Agent 决策后生成，见 feature v4 §6。
 */
export interface MeetingSegmentUpload {
  /** 本地片段唯一 ID（UUID） */
  segmentId: string
  /** 归属会议 ID（端侧判定已构成会议时携带） */
  meetingId?: string
  /** 设备 ID（wemux 安装实例） */
  deviceId: string
  /** 会议室标识（可选；如无则为设备名） */
  roomId?: string
  /** 片段开始时间（ISO 8601） */
  startedAt: string
  /** 片段结束时间（ISO 8601） */
  endedAt: string
  /** 有效语音时长（秒） */
  durationSec: number
  /** 转写文本（本地保留全量，上传仅此文本） */
  transcript: string
  /** 说话人 ID（spk0/spk1…，可选） */
  speakerId?: SpeakerId
  /** 价值标签（端侧小 Agent 输出，如 task/decision/competitor/…） */
  valueLabel?: string
  /** 价值判断置信度（0-1，可选） */
  confidence?: number
  /** 三通道路由（同一片段可多通道，feature 决策④） */
  channels: MeetingValueChannel[]
  /** 是否判定为一次会议片段 */
  isMeeting: boolean
  /** 会议标题（isMeeting 时可选） */
  meetingTitle?: string
}

/** 会议实体（端侧判定 → 云端创建/更新，feature §8.3） */
export interface MeetingEntity {
  id: string
  title: string
  roomId?: string
  deviceId: string
  startedAt: string
  endedAt?: string
  speakerIds: SpeakerId[]
  segmentIds: string[]
  status: MeetingStatus
  /** 云端 Agent 增量归纳的摘要（可选，云端写入） */
  summary?: string
}

/** 端侧录音会话状态快照（供 UI 与诊断，不上云） */
export interface RecordingSessionState {
  mode: RecordingMode
  powerLevel: PowerLevel
  startedAt?: string
  activeSegmentId?: string
  /** 今日已录有效秒数 */
  recordedSecToday: number
  /** 本地音频占用字节 */
  audioBytesUsed: number
  /** 待上传片段数（离线缓存） */
  pendingUploadCount: number
  lastError?: string
}

const SEGMENT_REQUIRED_FIELDS: readonly (keyof MeetingSegmentUpload)[] = [
  'segmentId',
  'deviceId',
  'startedAt',
  'endedAt',
  'transcript',
  'channels',
]

/** 校验上传载荷是否满足 V1 契约最小要求（纯函数，供端侧/云端共用） */
export const validateMeetingSegmentUpload = (upload: MeetingSegmentUpload | null | undefined): string[] => {
  const errors: string[] = []
  if (!upload || typeof upload !== 'object') {
    return ['invalid:upload']
  }
  for (const field of SEGMENT_REQUIRED_FIELDS) {
    if (upload[field] === undefined || upload[field] === null || upload[field] === '') {
      errors.push(`missing:${String(field)}`)
    }
  }
  if (upload.durationSec !== undefined && !(upload.durationSec > 0)) {
    errors.push('invalid:durationSec')
  }
  if (upload.channels.length === 0) {
    errors.push('empty:channels')
  }
  if (upload.startedAt && upload.endedAt && upload.endedAt < upload.startedAt) {
    errors.push('invalid:timeRange')
  }
  return errors
}

/** 三通道去重（保持顺序） */
export const normalizeMeetingValueChannels = (
  channels: MeetingValueChannel[],
): MeetingValueChannel[] => {
  const seen = new Set<MeetingValueChannel>()
  const result: MeetingValueChannel[] = []
  for (const channel of channels) {
    if (!seen.has(channel)) {
      seen.add(channel)
      result.push(channel)
    }
  }
  return result
}

/** 本地片段保留策略计算：按创建时间与生命周期策略判断是否过期（纯函数） */
export const isLocalSegmentExpired = (
  segmentCreatedAtMs: number,
  policy: LocalLifecyclePolicy,
  nowMs: number,
): boolean => {
  if (!(segmentCreatedAtMs > 0) || !(nowMs >= segmentCreatedAtMs)) {
    return false
  }
  const retentionMs = policy.audioRetentionDays * 24 * 60 * 60 * 1000
  // 严格超过保留期才算过期（恰好等于保留期仍在期限内）
  return nowMs - segmentCreatedAtMs > retentionMs
}

/** 生成 speaker ID 展示名（spk0 → 说话人 0） */
export const formatSpeakerLabel = (speakerId: SpeakerId): string =>
  /^spk\d+$/i.test(speakerId) ? `说话人 ${speakerId.slice(3)}` : speakerId

/**
 * 端侧小 Agent 价值判断输出（feature v4 §6.1 结构化决策）。
 * 由端侧 Agent（当前为规则预筛默认实现，后续接 Qwen2.5 级 LLM）对候选片段产出；
 * 云端三通道（MeetingSegmentUpload.channels）据此路由。
 */
export interface ValueJudgment {
  /** 是否对组织有价值 */
  valuable: boolean
  /** 价值标签（task/decision/risk/action_item/money/competitor…） */
  valueLabel?: string
  /** 置信度（0-1） */
  confidence: number
  /** 是否构成会议片段 */
  isMeeting: boolean
  /** 会议标题（isMeeting 时） */
  meetingTitle?: string
  /** 建议路由通道（端侧 Agent 决定；用户可配置偏好覆盖） */
  channels: MeetingValueChannel[]
  /** 一句话摘要（供云端 Agent 报告） */
  summary?: string
  /** 规则预筛命中的依据说明（诊断/误判反馈用） */
  reasons?: string[]
}

/** 规则预筛命中类别（feature §6.4：决策词/任务词/金额/风险词等先捞候选段） */
export type ValueSignalType =
  | 'decision'
  | 'task'
  | 'action_item'
  | 'money'
  | 'risk'
  | 'date_commitment'
  | 'name'

export interface ValueSignal {
  type: ValueSignalType
  /** 命中的原文片段 */
  matchText: string
}

/** 端侧转写接口产物（本地转写，音频不出设备） */
export interface TranscriptionResult {
  segmentId: string
  text: string
  /** 说话人 ID（端侧聚类产物） */
  speakerId?: SpeakerId
  /** 转写延迟/耗时（诊断） */
  durationMs?: number
}
