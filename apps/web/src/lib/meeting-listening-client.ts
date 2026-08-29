// [INPUT]: 本机麦克风音频与 MOSS + MiniCPM5 loopback runtime 的结构化结果。
// [OUTPUT]: 只将有价值的文本片段发送到 meeting-intelligence API，原始音频不离开设备。
// [POS]: 背后听写的桌面 WebRTC 采集适配层；移动端录音由原生 bridge 负责。
import type { MeetingSegmentUpload, MeetingValueChannel } from '@shared/meeting-intelligence'
import { authFetch, getAuthHeaders } from './api/client'
import { getStoredCollaborationWorkspaceId } from './collaboration-workspace'
import { invokeNativeShell, isDesktopNativeClient, isReactNativeMobileClient } from './native-client'
import { resolveAbsoluteApiUrl, resolveApiUrl } from './runtime-config'
import {
  emptyMeetingModelStates,
  getMeetingModelDefinition,
  MEETING_MODEL_CATALOG,
  type MeetingModelId,
  type MeetingModelState,
} from './meeting-models'

export type MeetingListeningSnapshot = {
  supported: boolean
  running: boolean
  source: 'browser' | 'mobile-native' | 'unavailable'
  startedAtMs: number | null
  recordedSec: number
  pendingUploads: number
  lastError: string | null
  transcript: string
  transcriptUpdatedAtMs: number | null
}

export type MeetingRuntimeSettings = {
  url: string
  token: string
}

export type MeetingModelManagerSnapshot = {
  supported: boolean
  platform: 'desktop' | 'android' | 'browser'
  models: MeetingModelState[]
}

export type MeetingBrainStatus = {
  workspaceId: string
  enabled: boolean
  brainAgentId?: string
  contextItemCount: number
  error: string | null
}

type LocalMeetingRuntimeResponse = {
  segments: LocalMeetingRuntimeSegment[]
}

type LocalMeetingRuntimeSegment = {
  startedAt: string
  endedAt: string
  transcript: string
  speakerId?: string
  valuable: boolean
  valueLabel?: string
  confidence?: number
  channels?: MeetingValueChannel[]
}

const CHUNK_MS = 30_000
const RUNTIME_SETTINGS_KEY = 'wemux.meeting-runtime'
const DEFAULT_DESKTOP_RUNTIME_URL = 'http://127.0.0.1:4768'

const normalizeRuntimeUrl = (value: string) => value.trim().replace(/\/$/, '')

export const getMeetingRuntimeSettings = (): MeetingRuntimeSettings => {
  const fallbackUrl = normalizeRuntimeUrl(import.meta.env?.VITE_MEETING_RUNTIME_URL ?? '')
  if (typeof window === 'undefined') return { url: fallbackUrl, token: '' }
  try {
    const stored = JSON.parse(window.localStorage.getItem(RUNTIME_SETTINGS_KEY) ?? '{}') as Partial<MeetingRuntimeSettings>
    return {
      url: normalizeRuntimeUrl(typeof stored.url === 'string' ? stored.url : fallbackUrl),
      token: typeof stored.token === 'string' ? stored.token : '',
    }
  } catch {
    return { url: fallbackUrl, token: '' }
  }
}

export const saveMeetingRuntimeSettings = (settings: MeetingRuntimeSettings) => {
  const url = normalizeRuntimeUrl(settings.url)
  if (url && !/^https?:\/\//i.test(url)) throw new Error('本地转写地址必须以 http:// 或 https:// 开头')
  window.localStorage.setItem(RUNTIME_SETTINGS_KEY, JSON.stringify({ url, token: settings.token.trim() }))
}

const normalizeMeetingModelStates = (value: unknown): MeetingModelState[] => {
  if (!Array.isArray(value)) return emptyMeetingModelStates()
  const byId = new Map(value.map((item) => {
    const state = item as Partial<MeetingModelState>
    return [state.id, state] as const
  }))
  return MEETING_MODEL_CATALOG.map((model) => {
    const state = byId.get(model.id)
    return {
      id: model.id,
      status: state?.status === 'downloading' || state?.status === 'ready' || state?.status === 'error'
        ? state.status
        : 'not-downloaded',
      downloadedBytes: typeof state?.downloadedBytes === 'number' ? state.downloadedBytes : 0,
      totalBytes: model.sizeBytes,
      error: typeof state?.error === 'string' ? state.error : null,
      path: typeof state?.path === 'string' ? state.path : null,
      inferenceReady: state?.inferenceReady === true,
      inferenceBackendAvailable: state?.inferenceBackendAvailable === true,
      inferenceStatus: state?.inferenceStatus === 'ready' || state?.inferenceStatus === 'not-loaded'
        || state?.inferenceStatus === 'backend-unavailable' || state?.inferenceStatus === 'model-not-downloaded'
        ? state.inferenceStatus
        : undefined,
    }
  })
}

export const getMeetingModelManagerSnapshot = async (): Promise<MeetingModelManagerSnapshot> => {
  const platform = isReactNativeMobileClient() ? 'android' : isDesktopNativeClient() ? 'desktop' : 'browser'
  if (platform === 'browser') {
    return { supported: false, platform, models: emptyMeetingModelStates() }
  }
  const result = await invokeNativeShell<{ models?: unknown }>('meeting_models_status')
  return {
    supported: Boolean(result),
    platform,
    models: normalizeMeetingModelStates(result?.models),
  }
}

export const downloadMeetingModel = async (id: MeetingModelId) => {
  if (!getMeetingModelDefinition(id)) throw new Error('未知会议模型')
  const result = await invokeNativeShell<{ models?: unknown }>('meeting_model_download', { modelId: id })
  if (!result) throw new Error('当前客户端不支持端侧模型下载')
  return normalizeMeetingModelStates(result.models)
}

export const deleteMeetingModel = async (id: MeetingModelId) => {
  if (!getMeetingModelDefinition(id)) throw new Error('未知会议模型')
  const result = await invokeNativeShell<{ models?: unknown }>('meeting_model_delete', { modelId: id })
  if (!result) throw new Error('当前客户端不支持端侧模型管理')
  return normalizeMeetingModelStates(result.models)
}

const runtimeSettingsFor = (mobile: boolean): MeetingRuntimeSettings => {
  const settings = getMeetingRuntimeSettings()
  if (settings.url) return settings
  return mobile ? settings : { ...settings, url: DEFAULT_DESKTOP_RUNTIME_URL }
}

let browserRecorder: MediaRecorder | null = null
let browserStream: MediaStream | null = null
let browserStartedAtMs: number | null = null
let browserChunkStartedAtMs: number | null = null
let pendingUploads = 0
let lastError: string | null = null
let browserTranscript = ''
let browserTranscriptUpdatedAtMs: number | null = null
let meetingId = ''
let deviceId = ''
let processingQueue = Promise.resolve()

const createId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

const getDeviceId = () => {
  if (deviceId) return deviceId
  const stored = window.localStorage.getItem('meeting-listening-device-id')
  deviceId = stored || createId('desktop')
  window.localStorage.setItem('meeting-listening-device-id', deviceId)
  return deviceId
}

const channelsFor = (channels?: MeetingValueChannel[]): MeetingValueChannel[] => {
  const allowed = channels?.filter((channel): channel is MeetingValueChannel => (
    channel === 'cloud_db' || channel === 'cloud_agent' || channel === 'memory_doc'
  )) ?? []
  return allowed.includes('cloud_db') ? allowed : ['cloud_db', ...allowed]
}

const getMeetingBrainContext = async (workspaceId = getStoredCollaborationWorkspaceId()): Promise<string> => {
  if (!workspaceId) return ''
  try {
    const response = await authFetch(resolveApiUrl(`/api/collab/workspaces/${workspaceId}/brain/overview`))
    if (!response.ok) return ''
    const payload = await response.json() as {
      enabled?: boolean
      config?: { enabled?: boolean; brainInstructions?: string }
      context?: { summaryLines?: string[] }
    }
    if (!payload.enabled && !payload.config?.enabled) return ''
    const lines = [
      payload.config?.brainInstructions?.trim(),
      ...(payload.context?.summaryLines ?? []).map((line) => line.trim()).filter(Boolean),
    ].filter(Boolean)
    return lines.join('\n').slice(0, 8_000)
  } catch {
    return ''
  }
}

export const getMeetingBrainStatus = async (): Promise<MeetingBrainStatus> => {
  const workspaceId = getStoredCollaborationWorkspaceId()
  if (!workspaceId) return { workspaceId: '', enabled: false, contextItemCount: 0, error: null }
  try {
    const response = await authFetch(resolveApiUrl(`/api/collab/workspaces/${workspaceId}/brain/overview`))
    if (!response.ok) throw new Error(`Brain 状态不可用（${response.status}）`)
    const payload = await response.json() as {
      enabled?: boolean
      brainAgentId?: string
      config?: { enabled?: boolean; brainAgentId?: string }
      context?: { recentItems?: unknown[]; summaryLines?: unknown[] }
    }
    const enabled = payload.config?.enabled ?? payload.enabled ?? false
    return {
      workspaceId,
      enabled: Boolean(enabled),
      brainAgentId: payload.config?.brainAgentId || payload.brainAgentId || undefined,
      contextItemCount: (payload.context?.recentItems?.length ?? 0) + (payload.context?.summaryLines?.length ?? 0),
      error: null,
    }
  } catch (error) {
    return {
      workspaceId,
      enabled: false,
      contextItemCount: 0,
      error: error instanceof Error ? error.message : 'Brain 状态不可用',
    }
  }
}

export const buildMeetingSegmentUploads = (params: {
  segments: LocalMeetingRuntimeSegment[]
  deviceId: string
  meetingId: string
  meetingTitle: string
}): MeetingSegmentUpload[] => params.segments
  .filter((segment) => segment.valuable && segment.transcript.trim())
  .map((segment) => ({
    segmentId: createId('segment'),
    meetingId: params.meetingId,
    deviceId: params.deviceId,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
    durationSec: Math.max(1, Math.round((Date.parse(segment.endedAt) - Date.parse(segment.startedAt)) / 1000)),
    transcript: segment.transcript.trim(),
    speakerId: segment.speakerId,
    valueLabel: segment.valueLabel,
    confidence: segment.confidence,
    channels: channelsFor(segment.channels),
    isMeeting: true,
    meetingTitle: params.meetingTitle,
  }))

const uploadSegments = async (segments: MeetingSegmentUpload[], workspaceId: string) => {
  for (const upload of segments) {
    pendingUploads += 1
    try {
      const response = await authFetch(resolveApiUrl('/api/meeting-intelligence/segments'), {
        method: 'POST',
        body: JSON.stringify({ upload, ...(workspaceId ? { workspaceId } : {}) }),
      })
      if (!response.ok) throw new Error(`片段上传失败（${response.status}）`)
    } finally {
      pendingUploads -= 1
    }
  }
}

const transcribeChunk = async (blob: Blob, startedAtMs: number, endedAtMs: number, brainContext: string) => {
  if (isDesktopNativeClient()) {
    const audioBase64 = await blobToWavBase64(blob)
    const result = await invokeNativeShell<LocalMeetingRuntimeResponse>('meeting_runtime_transcribe', {
      audioBase64,
      startedAtMs,
      endedAtMs,
      brainContext,
    })
    if (!result) throw new Error('桌面端本地 GGUF Runtime 不可用，请先下载两个端侧模型')
    return result
  }
  const runtime = runtimeSettingsFor(false)
  const form = new FormData()
  form.append('audio', blob, 'meeting.webm')
  form.append('startedAt', new Date(startedAtMs).toISOString())
  form.append('endedAt', new Date(endedAtMs).toISOString())
  if (brainContext) form.append('brainContext', brainContext)
  const response = await fetch(`${runtime.url}/v1/meeting/transcribe`, {
    method: 'POST',
    headers: runtime.token ? { 'X-Wemux-Meeting-Key': runtime.token } : undefined,
    body: form,
  })
  if (!response.ok) throw new Error(`本地 MOSS 运行时不可用（${response.status}）`)
  return await response.json() as LocalMeetingRuntimeResponse
}

const blobToWavBase64 = async (blob: Blob): Promise<string> => {
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) throw new Error('当前桌面环境不支持音频解码')
  const decodeContext = new AudioContextCtor()
  try {
    const decoded = await decodeContext.decodeAudioData(await blob.arrayBuffer())
    const sampleRate = 16_000
    const frameCount = Math.max(1, Math.ceil(decoded.duration * sampleRate))
    const offline = new OfflineAudioContext(1, frameCount, sampleRate)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()
    const samples = rendered.getChannelData(0)
    const bytes = new ArrayBuffer(44 + samples.length * 2)
    const view = new DataView(bytes)
    const writeAscii = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
    }
    writeAscii(0, 'RIFF')
    view.setUint32(4, 36 + samples.length * 2, true)
    writeAscii(8, 'WAVE')
    writeAscii(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeAscii(36, 'data')
    view.setUint32(40, samples.length * 2, true)
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index] ?? 0))
      view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    }
    const bytesView = new Uint8Array(bytes)
    let binary = ''
    const blockSize = 0x8000
    for (let offset = 0; offset < bytesView.length; offset += blockSize) {
      binary += String.fromCharCode(...bytesView.subarray(offset, offset + blockSize))
    }
    return btoa(binary)
  } finally {
    await decodeContext.close()
  }
}

const recordChunk = async (
  event: BlobEvent,
  startedAtMs: number,
  endedAtMs: number,
  sessionMeetingId: string,
  sessionDeviceId: string,
  workspaceId: string,
  brainContext: string,
) => {
  if (!event.data.size) return
  try {
    const currentBrainContext = (await getMeetingBrainContext(workspaceId)) || brainContext
    const result = await transcribeChunk(event.data, startedAtMs, endedAtMs, currentBrainContext)
    browserTranscript = result.segments
      .map((segment) => `${segment.speakerId ? `${segment.speakerId}: ` : ''}${segment.transcript.trim()}`)
      .filter(Boolean)
      .join('\n')
    browserTranscriptUpdatedAtMs = browserTranscript ? endedAtMs : browserTranscriptUpdatedAtMs
    if (browserTranscript) lastError = null
    await uploadSegments(buildMeetingSegmentUploads({
      segments: result.segments,
      deviceId: sessionDeviceId,
      meetingId: sessionMeetingId,
      meetingTitle: '背后听写',
    }), workspaceId)
  } catch (error) {
    // Chromium can emit an undecodable trailing MediaRecorder blob on stop
    // after an earlier chunk has already produced valid transcript text.
    // Keep the successful result visible instead of replacing it with a
    // misleading terminal error; initial/only-chunk failures remain visible.
    const message = error instanceof Error ? error.message : String(error)
    if (!/unable to decode audio data/i.test(message) && !browserTranscript) lastError = message
  }
}

const browserSnapshot = (): MeetingListeningSnapshot => ({
  supported: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined',
  running: Boolean(browserRecorder && browserRecorder.state !== 'inactive'),
  source: browserRecorder ? 'browser' : 'unavailable',
  startedAtMs: browserStartedAtMs,
  recordedSec: browserStartedAtMs ? Math.floor((Date.now() - browserStartedAtMs) / 1000) : 0,
  pendingUploads,
  lastError,
  transcript: browserTranscript,
  transcriptUpdatedAtMs: browserTranscriptUpdatedAtMs,
})

const mobileSnapshot = async (): Promise<MeetingListeningSnapshot> => {
  const native = (window as Window & { __WEMUX_MOBILE__?: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__WEMUX_MOBILE__
  if (!native) return browserSnapshot()
  const status = await native.invoke('recording_status') as Partial<MeetingListeningSnapshot>
  return {
    supported: status.supported ?? true,
    running: status.running ?? false,
    source: 'mobile-native',
    startedAtMs: status.startedAtMs ?? null,
    recordedSec: status.recordedSec ?? 0,
    pendingUploads: status.pendingUploads ?? 0,
    lastError: status.lastError ?? null,
    transcript: typeof status.transcript === 'string' ? status.transcript : '',
    transcriptUpdatedAtMs: typeof status.transcriptUpdatedAtMs === 'number' ? status.transcriptUpdatedAtMs : null,
  }
}

export const getMeetingListeningSnapshot = async (): Promise<MeetingListeningSnapshot> => (
  isReactNativeMobileClient() ? mobileSnapshot() : browserSnapshot()
)

export const startMeetingListening = async (): Promise<MeetingListeningSnapshot> => {
  if (isReactNativeMobileClient()) {
    const native = (window as Window & { __WEMUX_MOBILE__?: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__WEMUX_MOBILE__
    if (!native) throw new Error('移动端录音 bridge 不可用')
    const accessToken = getAuthHeaders().Authorization?.replace(/^Bearer\s+/i, '') ?? ''
    const runtime = runtimeSettingsFor(true)
    const workspaceId = getStoredCollaborationWorkspaceId()
    const brainContext = await getMeetingBrainContext()
    await native.invoke('recording_start', {
      runtimeUrl: runtime.url,
      runtimeToken: runtime.token,
      apiUrl: resolveAbsoluteApiUrl(''),
      accessToken,
      brainContext,
      workspaceId,
    })
    return mobileSnapshot()
  }
  if (browserRecorder?.state === 'recording') return browserSnapshot()
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('此设备不支持本地麦克风采集')
  }
  lastError = null
  browserTranscript = ''
  browserTranscriptUpdatedAtMs = null
  browserStream = await navigator.mediaDevices.getUserMedia({ audio: true })
  browserRecorder = new MediaRecorder(browserStream)
  browserStartedAtMs = Date.now()
  browserChunkStartedAtMs = browserStartedAtMs
  meetingId = createId('meeting')
  const sessionMeetingId = meetingId
  const sessionDeviceId = getDeviceId()
  const workspaceId = getStoredCollaborationWorkspaceId()
  const brainContext = await getMeetingBrainContext()
  browserRecorder.addEventListener('dataavailable', (event) => {
    const endedAtMs = Date.now()
    const startedAtMs = browserChunkStartedAtMs ?? browserStartedAtMs ?? endedAtMs
    browserChunkStartedAtMs = endedAtMs
    // MOSS may take longer than the capture interval; preserve chunk order and avoid overlapping model runs.
    processingQueue = processingQueue.then(() => recordChunk(
      event,
      startedAtMs,
      endedAtMs,
      sessionMeetingId,
      sessionDeviceId,
      workspaceId,
      brainContext,
    ))
  })
  browserRecorder.addEventListener('error', () => { lastError = '本地录音器异常停止' })
  browserRecorder.start(CHUNK_MS)
  return browserSnapshot()
}

export const stopMeetingListening = async (): Promise<MeetingListeningSnapshot> => {
  if (isReactNativeMobileClient()) {
    const native = (window as Window & { __WEMUX_MOBILE__?: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__WEMUX_MOBILE__
    if (!native) throw new Error('移动端录音 bridge 不可用')
    await native.invoke('recording_stop')
    return mobileSnapshot()
  }
  const recorder = browserRecorder
  if (recorder && recorder.state !== 'inactive') {
    await new Promise<void>((resolve) => {
      recorder.addEventListener('dataavailable', () => resolve(), { once: true })
      recorder.stop()
    })
  }
  browserStream?.getTracks().forEach((track) => track.stop())
  browserStream = null
  browserRecorder = null
  browserStartedAtMs = null
  browserChunkStartedAtMs = null
  meetingId = ''
  return browserSnapshot()
}
