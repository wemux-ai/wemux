// [INPUT]: /api/meeting-intelligence 查询
// [OUTPUT]: 会议记录页（列表 + 详情 + 价值片段）
// [POS]: 会议智能（feature）云端三通道的 web 查看层；端侧只上传文本，本页只读展示
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useState } from 'react'
import { CheckCircle2, Download, Loader2, Mic, Settings2, Square, Trash2 } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { authFetch } from '@/lib/api/client'
import {
  getMeetingBrainStatus,
  getMeetingListeningSnapshot,
  getMeetingRuntimeSettings,
  saveMeetingRuntimeSettings,
  startMeetingListening,
  stopMeetingListening,
  deleteMeetingModel,
  downloadMeetingModel,
  getMeetingModelManagerSnapshot,
  type MeetingRuntimeSettings,
  type MeetingBrainStatus,
  type MeetingListeningSnapshot,
  type MeetingModelManagerSnapshot,
} from '@/lib/meeting-listening-client'
import { formatModelSize, MEETING_MODEL_CATALOG } from '@/lib/meeting-models'
import { resolveApiUrl } from '@/lib/runtime-config'
import { useSidebar } from '@/components/ui/sidebar'
import { useExperimentalSettings } from '@/lib/use-experimental-settings'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type MeetingSummary = {
  id: string
  title: string
  roomId?: string | null
  deviceId: string
  startedAt: string
  endedAt?: string | null
  status: 'active' | 'closed'
  summary?: string | null
}

type MeetingSegmentView = {
  id: string
  startedAt: string
  endedAt: string
  durationSec: number
  transcript: string
  speakerId?: string | null
  valueLabel?: string | null
  confidence?: number | null
  isMeeting: boolean
  meetingTitle?: string | null
}

type MeetingDetail = {
  meeting: MeetingSummary | null
  segments: MeetingSegmentView[]
}

const formatTime = (iso: string) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const segmentLabel = (segment: MeetingSegmentView) => {
  const parts: string[] = []
  if (segment.speakerId) parts.push(segment.speakerId)
  if (segment.valueLabel) parts.push(segment.valueLabel)
  if (segment.confidence !== null && segment.confidence !== undefined) {
    parts.push(`${Math.round(segment.confidence * 100)}%`)
  }
  return parts.length > 0 ? parts.join(' · ') : ''
}

const modelInferenceLabel = (
  state: MeetingModelManagerSnapshot['models'][number] | undefined,
  platform: MeetingModelManagerSnapshot['platform'] | undefined,
) => {
  if (state?.inferenceReady) return '可离线推理'
  if (state?.inferenceStatus === 'not-loaded') return '下载后首次加载'
  if (state?.inferenceStatus === 'backend-unavailable') {
    return platform === 'desktop' ? '需启动本地 Runtime' : 'native 后端不可用'
  }
  return '未下载'
}

export function MeetingRecordsPage() {
  const navigate = useNavigate()
  const experimentalSettings = useExperimentalSettings()
  const meetingListeningEnabled = experimentalSettings.meetingListening
  const [meetings, setMeetings] = useState<MeetingSummary[]>([])
  const [selected, setSelected] = useState<MeetingDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { isMobile } = useSidebar()
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list')
  const [listening, setListening] = useState<MeetingListeningSnapshot | null>(null)
  const [listeningBusy, setListeningBusy] = useState(false)
  const [runtimeSettingsOpen, setRuntimeSettingsOpen] = useState(false)
  const [runtimeSettings, setRuntimeSettings] = useState<MeetingRuntimeSettings>(() => getMeetingRuntimeSettings())
  const [runtimeSettingsError, setRuntimeSettingsError] = useState('')
  const [modelManager, setModelManager] = useState<MeetingModelManagerSnapshot | null>(null)
  const [modelBusy, setModelBusy] = useState<string | null>(null)
  const [brainStatus, setBrainStatus] = useState<MeetingBrainStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    authFetch(resolveApiUrl('/api/meeting-intelligence/meetings'))
      .then(async (response) => {
        if (!response.ok) throw new Error(`加载失败（${response.status}）`)
        const body = (await response.json()) as { meetings: MeetingSummary[] }
        if (!cancelled) setMeetings(body.meetings ?? [])
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      void getMeetingBrainStatus().then((status) => {
        if (!cancelled) setBrainStatus(status)
      })
    }
    refresh()
    const timer = window.setInterval(refresh, 5_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      void getMeetingListeningSnapshot()
        .then((snapshot) => {
          if (!cancelled) setListening(snapshot)
        })
        .catch(() => {})
    }
    refresh()
    const timer = window.setInterval(refresh, 2_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const toggleListening = async () => {
    if (!meetingListeningEnabled && !listening?.running) return
    setListeningBusy(true)
    try {
      const snapshot = listening?.running
        ? await stopMeetingListening()
        : await startMeetingListening()
      setListening(snapshot)
    } catch (err: unknown) {
      setListening((current) => ({
        supported: current?.supported ?? false,
        running: false,
        source: current?.source ?? 'unavailable',
        startedAtMs: null,
        recordedSec: 0,
        pendingUploads: 0,
        lastError: err instanceof Error ? err.message : '无法启动背后听写',
        transcript: current?.transcript ?? '',
        transcriptUpdatedAtMs: current?.transcriptUpdatedAtMs ?? null,
      }))
    } finally {
      setListeningBusy(false)
    }
  }

  const saveRuntimeSettings = () => {
    try {
      saveMeetingRuntimeSettings(runtimeSettings)
      setRuntimeSettingsError('')
      setRuntimeSettingsOpen(false)
    } catch (err: unknown) {
      setRuntimeSettingsError(err instanceof Error ? err.message : '无法保存本地转写设置')
    }
  }

  const refreshModelManager = () => {
    void getMeetingModelManagerSnapshot().then(setModelManager).catch(() => setModelManager(null))
  }

  useEffect(() => {
    if (!runtimeSettingsOpen) return
    refreshModelManager()
    const timer = window.setInterval(refreshModelManager, 2_000)
    return () => window.clearInterval(timer)
  }, [runtimeSettingsOpen])

  const handleModelDownload = async (modelId: 'moss-transcribe' | 'minicpm5-value') => {
    if (!meetingListeningEnabled) return
    setModelBusy(modelId)
    try {
      const models = await downloadMeetingModel(modelId)
      setModelManager((current) => current ? { ...current, models } : current)
    } catch (err: unknown) {
      setRuntimeSettingsError(err instanceof Error ? err.message : '模型下载失败')
    } finally {
      setModelBusy(null)
      refreshModelManager()
    }
  }

  const handleModelDelete = async (modelId: 'moss-transcribe' | 'minicpm5-value') => {
    if (!meetingListeningEnabled) return
    setModelBusy(modelId)
    try {
      const models = await deleteMeetingModel(modelId)
      setModelManager((current) => current ? { ...current, models } : current)
    } catch (err: unknown) {
      setRuntimeSettingsError(err instanceof Error ? err.message : '模型删除失败')
    } finally {
      setModelBusy(null)
      refreshModelManager()
    }
  }

  const openMeeting = async (meetingId: string) => {
    setSelected(null)
    setDetailError('')
    setDetailLoading(true)
    if (isMobile) {
      setMobileView('detail')
    }
    try {
      const response = await authFetch(resolveApiUrl(`/api/meeting-intelligence/meetings/${meetingId}`))
      if (!response.ok) throw new Error(`加载失败（${response.status}）`)
      setSelected((await response.json()) as MeetingDetail)
    } catch (err: unknown) {
      setDetailError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setDetailLoading(false)
    }
  }

  const listView = (
    <ul className="min-h-0 space-y-1 overflow-y-auto">
      {meetings.map((meeting) => (
        <li key={meeting.id}>
          <button
            type="button"
            onClick={() => void openMeeting(meeting.id)}
            className="w-full rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{meeting.title}</span>
              <span className={meeting.status === 'active' ? 'text-xs text-emerald-600' : 'text-xs text-muted-foreground'}>
                {meeting.status === 'active' ? '进行中' : '已结束'}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{formatTime(meeting.startedAt)}</div>
          </button>
        </li>
      ))}
    </ul>
  )

  const detailView = (
    <section className="min-h-0 overflow-y-auto rounded-md border p-3">
      {detailLoading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : detailError ? (
        <p className="text-sm text-destructive">{detailError}</p>
      ) : selected ? (
        <>
          <h2 className="text-base font-semibold">{selected.meeting?.title ?? '会议详情'}</h2>
          {selected.meeting?.roomId ? (
            <p className="text-xs text-muted-foreground">会议室：{selected.meeting.roomId}</p>
          ) : null}
          {selected.segments.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">暂无价值片段。</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {selected.segments.map((segment) => (
                <li key={segment.id} className="rounded-md border p-2">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{formatTime(segment.startedAt)} · {segment.durationSec}s</span>
                    <span>{segmentLabel(segment)}</span>
                  </div>
                  <p className="mt-1 text-sm">{segment.transcript}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">选择左侧会议查看价值片段。</p>
      )}
    </section>
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">会议记录</h1>
          <p className="text-sm text-muted-foreground">端侧旁听上传的价值片段与会议实体</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setRuntimeSettings(getMeetingRuntimeSettings())
              setRuntimeSettingsError('')
              setRuntimeSettingsOpen(true)
            }}
            title="本地转写连接"
            className="grid h-9 w-9 place-items-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Settings2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={listeningBusy || listening?.supported === false || (!meetingListeningEnabled && !listening?.running)}
            onClick={() => void toggleListening()}
            title={listening?.running ? '停止背后听写' : '开始背后听写'}
            className={listening?.running
              ? 'flex shrink-0 items-center gap-1.5 rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-60'
              : 'flex shrink-0 items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60'}
          >
            {listening?.running ? <Square className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
            <span className="hidden sm:inline">{listening?.running ? '停止听写' : '开始听写'}</span>
          </button>
        </div>
      </header>

      {!meetingListeningEnabled ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">
          <span>背后听写是实验性功能，当前未开启。历史会议记录仍可查看。</span>
          <button
            type="button"
            onClick={() => void navigate({ to: '/settings', search: { section: 'experimental' } as never })}
            className="shrink-0 rounded-md border border-amber-500/40 px-2.5 py-1 text-xs font-medium hover:bg-amber-500/10"
          >
            在设置中开启
          </button>
        </div>
      ) : null}

      {meetingListeningEnabled ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
          {brainStatus?.workspaceId ? (
            brainStatus.enabled && brainStatus.brainAgentId ? (
              <span className="text-emerald-600">已连接 Agent Brain{brainStatus.contextItemCount > 0 ? ` · ${brainStatus.contextItemCount} 条上下文` : ''}</span>
            ) : brainStatus.enabled ? (
              <span>Agent Brain 已开启，但当前工作区还没有可用的 Brain Agent。</span>
            ) : (
              <span>当前工作区未启用 Agent Brain，价值片段不会进入 Brain。</span>
            )
          ) : (
            <span>未选择工作区，仅执行本地转录和价值判断。</span>
          )}
          {brainStatus?.error ? <span className="text-destructive">{brainStatus.error}</span> : null}
        </div>
      ) : null}

      {listening?.running ? (
        <p className="text-sm text-emerald-600">
          背后听写正在进行。有价值的文本会同步到 Agent 上下文。
        </p>
      ) : listening?.lastError ? (
        <p className="text-sm text-destructive">{listening.lastError}</p>
      ) : null}

      {listening?.transcript ? (
        <section className="rounded-md border bg-background p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">最新转录</h2>
            {listening.transcriptUpdatedAtMs ? (
              <time className="text-xs text-muted-foreground">
                {formatTime(new Date(listening.transcriptUpdatedAtMs).toISOString())}
              </time>
            ) : null}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/90">{listening.transcript}</p>
        </section>
      ) : listening?.running ? (
        <p className="text-sm text-muted-foreground">正在等待第一个转录片段…</p>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : meetings.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无会议记录。使用录音 App 旁听会议后，有价值片段会出现在这里。</p>
      ) : isMobile ? (
        mobileView === 'detail' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
            <button
              type="button"
              onClick={() => setMobileView('list')}
              className="flex h-11 w-fit items-center gap-1 rounded-md px-3 text-sm text-muted-foreground hover:text-foreground"
            >
              ← 返回列表
            </button>
            {detailView}
          </div>
        ) : (
          listView
        )
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr] gap-3 overflow-hidden">
          {listView}
          {detailView}
        </div>
      )}

      <Dialog open={runtimeSettingsOpen} onOpenChange={setRuntimeSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>本地转写连接</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="meeting-runtime-url">MOSS Runtime 地址</Label>
              <Input
                id="meeting-runtime-url"
                inputMode="url"
                placeholder="http://127.0.0.1:4768"
                value={runtimeSettings.url}
                onChange={(event) => setRuntimeSettings((current) => ({ ...current, url: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="meeting-runtime-token">配对令牌</Label>
              <Input
                id="meeting-runtime-token"
                type="password"
                autoComplete="off"
                value={runtimeSettings.token}
                onChange={(event) => setRuntimeSettings((current) => ({ ...current, token: event.target.value }))}
              />
            </div>
            {runtimeSettingsError ? <p className="text-sm text-destructive">{runtimeSettingsError}</p> : null}
            <div className="space-y-2 border-t pt-4">
              <div>
                <h3 className="text-sm font-medium">端侧模型</h3>
                <p className="mt-1 text-xs text-muted-foreground">模型下载到本机私有目录，原始音频不会上传。Android 与桌面端都在本机运行 GGUF。</p>
              </div>
              {!meetingListeningEnabled ? (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
                  请先在设置的“实验性功能”中开启背后听写，才能下载或删除端侧模型。
                </p>
              ) : null}
              {MEETING_MODEL_CATALOG.map((model) => {
                const state = modelManager?.models.find((item) => item.id === model.id)
                const busy = modelBusy === model.id || state?.status === 'downloading'
                const progress = state && state.totalBytes > 0 ? Math.min(100, Math.round(state.downloadedBytes / state.totalBytes * 100)) : 0
                return (
                  <div key={model.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{model.name}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{model.description}</p>
                      </div>
                      {state?.status === 'ready' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-label="已下载" /> : null}
                    </div>
                    {busy ? (
                      <div className="mt-3">
                        <div className="mb-1 flex justify-between text-[11px] text-muted-foreground"><span>下载中</span><span>{progress}%</span></div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} /></div>
                      </div>
                    ) : state?.status === 'error' ? (
                      <p className="mt-2 text-xs text-destructive">{state.error || '下载失败'}</p>
                    ) : null}
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">{formatModelSize(model.sizeBytes)} · GGUF · {modelInferenceLabel(state, modelManager?.platform)}</span>
                      {state?.status === 'ready' ? (
                        <button type="button" disabled={!meetingListeningEnabled || busy} title="删除模型" onClick={() => void handleModelDelete(model.id)} className="grid h-8 w-8 place-items-center rounded-md border text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
                      ) : (
                        <button type="button" disabled={!meetingListeningEnabled || busy || modelManager?.supported === false} onClick={() => void handleModelDownload(model.id)} className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60">
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
                          {busy ? '下载中' : '下载'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              {modelManager?.platform === 'browser' ? <p className="text-xs text-muted-foreground">请在桌面客户端或 Android App 中打开此设置。</p> : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <button type="button" onClick={() => setRuntimeSettingsOpen(false)} className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">取消</button>
            <button type="button" onClick={saveRuntimeSettings} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500">保存</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
