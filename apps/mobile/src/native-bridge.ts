import Constants from 'expo-constants'
import { requireOptionalNativeModule } from 'expo-modules-core'
import * as Notifications from 'expo-notifications'
import * as Updates from 'expo-updates'
import { PermissionsAndroid, Platform } from 'react-native'
import type * as ExpoAv from 'expo-av'

type MeetingModelId = 'moss-transcribe' | 'minicpm5-value'

export type MobileBridgeRequest = {
  type: 'invoke'
  id: string
  command: string
  args?: Record<string, unknown>
}

export type MobileBridgeResponse = {
  id: string
  result?: unknown
  error?: string
}

export type RecordingSnapshot = {
  supported: boolean
  running: boolean
  startedAtMs: number | null
  mode: 'idle' | 'recording'
  recordedSec: number
  pendingUploads: number
  lastError: string | null
  transcript: string
  transcriptUpdatedAtMs: number | null
  uri?: string | null
}

type MeetingRuntimeSegment = {
  startedAt: string
  endedAt: string
  transcript: string
  speakerId?: string
  valuable: boolean
  valueLabel?: string
  confidence?: number
  channels?: Array<'cloud_db' | 'cloud_agent' | 'memory_doc'>
}

type MeetingRuntimeConfig = {
  runtimeUrl: string
  runtimeToken: string
  apiUrl: string
  accessToken: string
  brainContext: string
  workspaceId: string
}

const appVersion = Constants.expoConfig?.version ?? '0.0.0'
type AudioModule = typeof ExpoAv.Audio
type AudioRecording = ExpoAv.Audio.Recording
const audio: AudioModule | null = Platform.OS === 'android' ? null : require('expo-av').Audio
let recording: AudioRecording | null = null
let recordingStartedAtMs: number | null = null
let recordedSec = 0
let pendingUploads = 0
let recordingSplitTimer: ReturnType<typeof setTimeout> | null = null
let meetingRuntime: MeetingRuntimeConfig | null = null
let recordingQueue = Promise.resolve()
let recordingControlQueue = Promise.resolve()
let lastRecordingError: string | null = null
let mobileMeetingId = ''
let recordingShouldContinue = false
const mobileDeviceId = `mobile-${Constants.sessionId ?? Math.random().toString(36).slice(2)}`
let pendingUpdate: { currentVersion: string; version: string } | null = null

const RECORDING_CHUNK_MS = 30_000

const requestMicrophonePermission = async () => {
  if (Platform.OS !== 'android') return audio!.requestPermissionsAsync()
  const status = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
  return { granted: status === PermissionsAndroid.RESULTS.GRANTED }
}

type AndroidMeetingListeningModule = {
  start: (config: MeetingRuntimeConfig & { meetingId: string }) => Promise<void>
  stop: () => Promise<void>
  status: () => Promise<RecordingSnapshot>
  meetingModelsStatus: () => Promise<unknown>
  meetingModelDownload: (modelId: MeetingModelId) => Promise<unknown>
  meetingModelDelete: (modelId: MeetingModelId) => Promise<unknown>
}

const androidMeetingListening = Platform.OS === 'android'
  ? requireOptionalNativeModule<AndroidMeetingListeningModule>('WemuxMeetingListening')
  : undefined

const requireAndroidMeetingListening = () => {
  if (!androidMeetingListening) {
    throw new Error('Android meeting listening native module is unavailable')
  }
  return androidMeetingListening
}

const getRecordingSnapshot = async (): Promise<RecordingSnapshot> => {
  if (Platform.OS === 'android') return requireAndroidMeetingListening().status()
  if (!recording) {
    return {
      supported: true,
      running: false,
      startedAtMs: null,
      mode: 'idle',
      recordedSec,
      pendingUploads,
      lastError: lastRecordingError,
      transcript: '',
      transcriptUpdatedAtMs: null,
    }
  }

  const status = await recording.getStatusAsync()
  return {
    supported: true,
    running: status.isRecording,
    startedAtMs: recordingStartedAtMs,
    mode: status.isRecording ? 'recording' : 'idle',
    recordedSec: recordedSec + Math.floor((status.durationMillis ?? 0) / 1000),
    pendingUploads,
    lastError: lastRecordingError,
    transcript: '',
    transcriptUpdatedAtMs: null,
    uri: recording.getURI(),
  }
}

const clearRecordingSplitTimer = () => {
  if (recordingSplitTimer) clearTimeout(recordingSplitTimer)
  recordingSplitTimer = null
}

const scheduleRecordingSplit = () => {
  clearRecordingSplitTimer()
  recordingSplitTimer = setTimeout(() => {
    void finishRecordingSegment(true).catch((error) => {
      lastRecordingError = error instanceof Error ? error.message : String(error)
    })
  }, RECORDING_CHUNK_MS)
}

const startRecordingSegment = async () => {
  const nextRecording = new audio!.Recording()
  await nextRecording.prepareToRecordAsync(audio!.RecordingOptionsPresets.HIGH_QUALITY)
  await nextRecording.startAsync()
  recording = nextRecording
  recordingStartedAtMs = Date.now()
  scheduleRecordingSplit()
}

const asMeetingRuntimeConfig = (args: Record<string, unknown>): MeetingRuntimeConfig => {
  const runtimeUrl = typeof args.runtimeUrl === 'string' ? args.runtimeUrl.trim().replace(/\/$/, '') : ''
  const runtimeToken = typeof args.runtimeToken === 'string' ? args.runtimeToken.trim() : ''
  const apiUrl = typeof args.apiUrl === 'string' ? args.apiUrl.trim().replace(/\/$/, '') : ''
  const accessToken = typeof args.accessToken === 'string' ? args.accessToken.trim() : ''
  const brainContext = typeof args.brainContext === 'string' ? args.brainContext.slice(0, 8_000) : ''
  const workspaceId = typeof args.workspaceId === 'string' ? args.workspaceId.trim() : ''
  if ((!runtimeUrl && Platform.OS !== 'android') || !apiUrl || !accessToken) {
    throw new Error(Platform.OS === 'android'
      ? '移动端背后听写需要 Wemux API 地址和登录凭据，并先下载两个端侧模型'
      : '移动端背后听写需要 MOSS Runtime、Wemux API 地址和登录凭据')
  }
  return { runtimeUrl, runtimeToken, apiUrl, accessToken, brainContext, workspaceId }
}

const refreshBrainContext = async (runtime: MeetingRuntimeConfig): Promise<string> => {
  if (!runtime.workspaceId) return runtime.brainContext
  try {
    const response = await fetch(`${runtime.apiUrl}/api/collab/workspaces/${runtime.workspaceId}/brain/overview`, {
      headers: { Authorization: `Bearer ${runtime.accessToken}` },
    })
    if (!response.ok) return runtime.brainContext
    const payload = await response.json() as {
      config?: { brainInstructions?: string }
      context?: { summaryLines?: string[] }
    }
    const context = [
      payload.config?.brainInstructions?.trim(),
      ...(payload.context?.summaryLines ?? []).map((line) => line.trim()).filter(Boolean),
    ].filter(Boolean).join('\n').slice(0, 8_000)
    return context || runtime.brainContext
  } catch {
    return runtime.brainContext
  }
}

const uploadValuableSegments = async (
  runtime: MeetingRuntimeConfig,
  currentMeetingId: string,
  segments: MeetingRuntimeSegment[],
) => {
  for (const segment of segments) {
    if (!segment.valuable || !segment.transcript.trim()) continue
    const response = await fetch(`${runtime.apiUrl}/api/meeting-intelligence/segments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtime.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        upload: {
          segmentId: `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          meetingId: currentMeetingId,
          deviceId: mobileDeviceId,
          startedAt: segment.startedAt,
          endedAt: segment.endedAt,
          durationSec: Math.max(1, Math.round((Date.parse(segment.endedAt) - Date.parse(segment.startedAt)) / 1000)),
          transcript: segment.transcript.trim(),
          speakerId: segment.speakerId,
          valueLabel: segment.valueLabel,
          confidence: segment.confidence,
          channels: segment.channels?.includes('cloud_db')
            ? segment.channels
            : ['cloud_db', ...(segment.channels ?? [])],
          isMeeting: true,
          meetingTitle: '背后听写',
        },
        ...(runtime.workspaceId ? { workspaceId: runtime.workspaceId } : {}),
      }),
    })
    if (!response.ok) throw new Error(`会议片段上传失败（${response.status}）`)
  }
}

const processRecordingUri = async (
  runtime: MeetingRuntimeConfig,
  currentMeetingId: string,
  uri: string,
  startedAtMs: number,
  endedAtMs: number,
) => {
  pendingUploads += 1
  try {
    const body = new FormData()
    body.append('audio', {
      uri,
      type: 'audio/m4a',
      name: `wemux-meeting-${startedAtMs}.m4a`,
    } as unknown as Blob)
    body.append('startedAt', new Date(startedAtMs).toISOString())
    body.append('endedAt', new Date(endedAtMs).toISOString())
    const brainContext = await refreshBrainContext(runtime)
    if (brainContext) body.append('brainContext', brainContext)
    const response = await fetch(`${runtime.runtimeUrl}/v1/meeting/transcribe`, {
      method: 'POST',
      headers: runtime.runtimeToken ? { 'X-Wemux-Meeting-Key': runtime.runtimeToken } : undefined,
      body,
    })
    if (!response.ok) throw new Error(`MOSS Runtime 不可用（${response.status}）`)
    const result = await response.json() as { segments?: MeetingRuntimeSegment[] }
    await uploadValuableSegments(runtime, currentMeetingId, result.segments ?? [])
  } finally {
    pendingUploads -= 1
  }
}

const finishRecordingSegment = (continueRecording: boolean) => {
  const finish = async () => {
    const current = recording
    const startedAtMs = recordingStartedAtMs
    const runtime = meetingRuntime
    const currentMeetingId = mobileMeetingId
    if (!current || !startedAtMs || !runtime || !currentMeetingId) return
    clearRecordingSplitTimer()
    const status = await current.getStatusAsync()
    const uri = current.getURI()
    await current.stopAndUnloadAsync()
    recordedSec += Math.floor((status.durationMillis ?? 0) / 1000)
    recording = null
    recordingStartedAtMs = null
    const endedAtMs = Date.now()
    if (continueRecording && recordingShouldContinue) await startRecordingSegment()
    if (!uri) return
    recordingQueue = recordingQueue
      .then(() => processRecordingUri(runtime, currentMeetingId, uri, startedAtMs, endedAtMs))
      .catch((error) => {
        lastRecordingError = error instanceof Error ? error.message : String(error)
      })
  }
  recordingControlQueue = recordingControlQueue.then(finish, finish)
  return recordingControlQueue
}

const startRecording = async (args: Record<string, unknown>) => {
  await recordingControlQueue.catch(() => {})
  if (Platform.OS === 'android') {
    const nativeModule = requireAndroidMeetingListening()
    const runtime = asMeetingRuntimeConfig(args)
    const permission = await requestMicrophonePermission()
    if (!permission.granted) throw new Error('microphone permission was denied')
    lastRecordingError = null
    recordedSec = 0
    mobileMeetingId = `mobile-meeting-${Date.now()}-${Math.random().toString(36).slice(2)}`
    await nativeModule.start({ ...runtime, meetingId: mobileMeetingId })
    return getRecordingSnapshot()
  }
  if (recording) return getRecordingSnapshot()
  meetingRuntime = asMeetingRuntimeConfig(args)
  const permission = await requestMicrophonePermission()
  if (!permission.granted) throw new Error('microphone permission was denied')

  await audio!.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    shouldDuckAndroid: true,
  })
  lastRecordingError = null
  recordedSec = 0
  recordingShouldContinue = true
  mobileMeetingId = `mobile-meeting-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await startRecordingSegment()
  return getRecordingSnapshot()
}

const stopRecording = async () => {
  if (Platform.OS === 'android') {
    const nativeModule = requireAndroidMeetingListening()
    await nativeModule.stop()
    return getRecordingSnapshot()
  }
  if (!recording) return getRecordingSnapshot()
  recordingShouldContinue = false
  clearRecordingSplitTimer()
  await finishRecordingSegment(false)
  await audio!.setAudioModeAsync({ allowsRecordingIOS: false })
  return getRecordingSnapshot()
}

const showNotification = async (args: Record<string, unknown>) => {
  let permission = await Notifications.getPermissionsAsync()
  if (!permission.granted) permission = await Notifications.requestPermissionsAsync()
  if (!permission.granted) throw new Error('notification permission was denied')
  await Notifications.scheduleNotificationAsync({
    content: {
      title: typeof args.title === 'string' ? args.title.slice(0, 160) : 'Wemux',
      body: typeof args.body === 'string' ? args.body.slice(0, 2000) : '',
    },
    trigger: null,
  })
  return true
}

const checkForUpdate = async () => {
  if (__DEV__ || !Updates.isEnabled) return null
  const result = await Updates.checkForUpdateAsync()
  if (!result.isAvailable) return null
  pendingUpdate = { currentVersion: appVersion, version: 'available' }
  return pendingUpdate
}

export const handleMobileBridgeRequest = async (
  request: MobileBridgeRequest,
  takePendingDeepLinks: () => string[],
): Promise<MobileBridgeResponse> => {
  try {
    let result: unknown
    switch (request.command) {
      case 'app_version':
        result = appVersion
        break
      case 'worker_daemon_status':
        result = { running: false, host: '127.0.0.1', port: 48121, checkedAtMs: Date.now() }
        break
      case 'show_notification':
        result = await showNotification(request.args ?? {})
        break
      case 'autostart_is_enabled':
      case 'autostart_set_enabled':
        result = false
        break
      case 'take_pending_deep_links':
        result = takePendingDeepLinks()
        break
      case 'recording_start':
        result = await startRecording(request.args ?? {})
        break
      case 'recording_stop':
        result = await stopRecording()
        break
      case 'recording_status':
        result = await getRecordingSnapshot()
        break
      case 'meeting_models_status':
        result = Platform.OS === 'android'
          ? await requireAndroidMeetingListening().meetingModelsStatus()
          : { supported: false, platform: 'browser', models: [] }
        break
      case 'meeting_model_download': {
        if (Platform.OS !== 'android') throw new Error('mobile model downloads require Android native support')
        const modelId = request.args?.modelId
        if (modelId !== 'moss-transcribe' && modelId !== 'minicpm5-value') throw new Error('unknown meeting model')
        result = await requireAndroidMeetingListening().meetingModelDownload(modelId)
        break
      }
      case 'meeting_model_delete': {
        if (Platform.OS !== 'android') throw new Error('mobile model management requires Android native support')
        const modelId = request.args?.modelId
        if (modelId !== 'moss-transcribe' && modelId !== 'minicpm5-value') throw new Error('unknown meeting model')
        result = await requireAndroidMeetingListening().meetingModelDelete(modelId)
        break
      }
      case 'check_for_update':
        result = await checkForUpdate()
        break
      case 'pending_update':
        result = pendingUpdate
        break
      case 'install_update':
        if (!Updates.isEnabled) throw new Error('OTA updates are unavailable in development')
        await Updates.fetchUpdateAsync()
        result = null
        break
      case 'restart_app':
        if (!Updates.isEnabled) throw new Error('OTA updates are unavailable in development')
        await Updates.reloadAsync()
        result = null
        break
      default:
        throw new Error(`unsupported mobile command: ${request.command}`)
    }
    return { id: request.id, result }
  } catch (error) {
    return { id: request.id, error: error instanceof Error ? error.message : String(error) }
  }
}
