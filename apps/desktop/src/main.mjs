import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net as electronNet,
  Notification,
  protocol,
  screen,
  session,
  shell,
  Tray,
} from 'electron'
import updater from 'electron-updater'

const { autoUpdater } = updater
const DESKTOP_SCHEME = 'wemux-app'
const DEEP_LINK_SCHEME = 'wemux'
const WORKER_HOST = '127.0.0.1'
const WORKER_PORT = 48121
const DEFAULT_BOUNDS = { width: 1440, height: 960 }
const DEV_LOAD_RETRY_DELAY_MS = 750
const DEV_LOAD_MAX_ATTEMPTS = 4
const MEETING_MODELS = {
  'moss-transcribe': {
    fileName: 'moss-transcribe-q4_k.gguf',
    sizeBytes: 535272448,
    sha256: 'ac22065a8f9ad10416262a950e9e87e4e6b51ef90e07a42a1a62cb718a12623b',
    url: 'https://huggingface.co/mudler/moss-transcribe.cpp-gguf/resolve/main/moss-transcribe-q4_k.gguf?download=true',
  },
  'minicpm5-value': {
    fileName: 'MiniCPM5-1B-Q4_K_M.gguf',
    sizeBytes: 688065920,
    sha256: '81b64d05a23b17b34c475f42b3e72fbde62d4b92cc34541f7a8031d0752deafa',
    url: 'https://huggingface.co/openbmb/MiniCPM5-1B-GGUF/resolve/main/MiniCPM5-1B-Q4_K_M.gguf?download=true',
  },
}
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(moduleDirectory, '..')
const isMac = process.platform === 'darwin'

const resolveAppIconPath = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.resolve(desktopRoot, 'assets/icons/icon.png')

process.on('uncaughtException', (error) => console.error('[desktop] uncaught main-process error', error))
process.on('unhandledRejection', (error) => console.error('[desktop] unhandled main-process rejection', error))
console.log(`[desktop] Electron ${process.versions.electron ?? 'unavailable'} process type: ${process.type ?? 'browser'}`)

protocol.registerSchemesAsPrivileged([
  {
    scheme: DESKTOP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

let mainWindow = null
let tray = null
let isQuitting = false
let pendingUpdate = null
let updateDownloaded = false
let pendingDeepLinks = []
let workerRunning = false
let stateSaveTimer = null
const meetingModelJobs = new Map()
let meetingRuntime = null
let meetingRuntimeStarting = null

const meetingRuntimeBinaryPath = () => {
  const binaryName = process.platform === 'win32' ? 'wemux-meeting-runtime.exe' : 'wemux-meeting-runtime'
  if (app.isPackaged) return path.join(process.resourcesPath, 'meeting-runtime', binaryName)
  const buildRoot = path.resolve(desktopRoot, '../meeting-runtime/native/build')
  const releaseRoot = process.platform === 'win32' ? path.join(buildRoot, 'Release') : buildRoot
  return path.join(releaseRoot, binaryName)
}

const meetingRuntimeBinaryAvailable = () => existsSync(meetingRuntimeBinaryPath())

const meetingModelsDirectory = () => {
  const directory = path.join(app.getPath('userData'), 'meeting-models')
  mkdirSync(directory, { recursive: true })
  return directory
}

const meetingModelState = (id, overrides = {}) => {
  const model = MEETING_MODELS[id]
  const target = path.join(meetingModelsDirectory(), model.fileName)
  const metadataPath = `${target}.json`
  let downloadedBytes = 0
  let ready = false
  try {
    downloadedBytes = statSync(target).size
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
    ready = downloadedBytes === model.sizeBytes && metadata.sha256 === model.sha256
  } catch {}
  return {
    id,
    status: overrides.status || (ready ? 'ready' : 'not-downloaded'),
    downloadedBytes: overrides.downloadedBytes ?? (ready ? model.sizeBytes : downloadedBytes),
    totalBytes: model.sizeBytes,
    error: overrides.error ?? null,
    path: ready ? target : null,
    inferenceReady: ready && meetingRuntime?.ready === true,
    inferenceBackendAvailable: meetingRuntimeBinaryAvailable(),
    inferenceStatus: !ready
      ? 'model-not-downloaded'
      : !meetingRuntimeBinaryAvailable()
        ? 'backend-unavailable'
        : meetingRuntime?.ready === true ? 'ready' : 'not-loaded',
  }
}

const meetingModelsStatus = () => ({
  supported: true,
  platform: 'desktop',
  models: Object.keys(MEETING_MODELS).map((id) => meetingModelState(id, meetingModelJobs.get(id))),
})

const hashFile = (filePath, hash) => new Promise((resolve, reject) => {
  const input = createReadStream(filePath)
  input.on('data', (chunk) => hash.update(chunk))
  input.once('error', reject)
  input.once('end', resolve)
})

const writeMeetingModel = async (id, onProgress) => {
  const model = MEETING_MODELS[id]
  const directory = meetingModelsDirectory()
  const target = path.join(directory, model.fileName)
  const temporary = `${target}.download`
  let offset = 0
  try {
    offset = statSync(temporary).size
  } catch {}
  if (offset > model.sizeBytes) {
    unlinkSync(temporary)
    offset = 0
  }
  if (offset === model.sizeBytes) {
    const completeHash = createHash('sha256')
    await hashFile(temporary, completeHash)
    const actualHash = completeHash.digest('hex')
    if (actualHash === model.sha256) {
      renameSync(temporary, target)
      writeFileSync(`${target}.json`, JSON.stringify({ sha256: actualHash, sizeBytes: model.sizeBytes }))
      onProgress(model.sizeBytes)
      return meetingModelState(id)
    }
    unlinkSync(temporary)
    offset = 0
  }

  let response = await fetch(model.url, {
    redirect: 'follow',
    headers: offset > 0 ? { Range: `bytes=${offset}-`, 'Accept-Encoding': 'identity' } : { 'Accept-Encoding': 'identity' },
  })
  if (!response.ok && offset > 0 && response.status === 416) {
    await response.body?.cancel().catch(() => {})
    unlinkSync(temporary)
    offset = 0
    response = await fetch(model.url, { redirect: 'follow', headers: { 'Accept-Encoding': 'identity' } })
  }
  if (!response.ok || !response.body) throw new Error(`model download failed (${response.status})`)

  let append = offset > 0 && response.status === 206
  if (append) {
    const rangeStart = Number(/^bytes\s+(\d+)-/i.exec(response.headers.get('content-range') || '')?.[1])
    if (!Number.isFinite(rangeStart) || rangeStart !== offset) append = false
  }
  if (!append && offset > 0) {
    // Some mirrors ignore Range. Restart cleanly instead of corrupting the artifact.
    await response.body.cancel().catch(() => {})
    unlinkSync(temporary)
    offset = 0
    response = await fetch(model.url, { redirect: 'follow', headers: { 'Accept-Encoding': 'identity' } })
    if (!response.ok || !response.body) throw new Error(`model download failed (${response.status})`)
  }

  const hash = createHash('sha256')
  let received = append ? offset : 0
  if (append) await hashFile(temporary, hash)
  onProgress(received)
  const output = createWriteStream(temporary, { flags: append ? 'a' : 'w' })
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      hash.update(chunk)
      received += chunk.length
      if (!output.write(chunk)) await new Promise((resolve, reject) => {
        output.once('drain', resolve)
        output.once('error', reject)
      })
      onProgress(received)
    }
    await new Promise((resolve, reject) => {
      output.once('error', reject)
      output.end(resolve)
    })
    const actualHash = hash.digest('hex')
    if (received !== model.sizeBytes) throw new Error(`model size mismatch (${received} bytes)`)
    if (actualHash !== model.sha256) throw new Error('model SHA-256 verification failed')
    renameSync(temporary, target)
    writeFileSync(`${target}.json`, JSON.stringify({ sha256: actualHash, sizeBytes: received }))
  } catch (error) {
    output.destroy()
    // Preserve the partial file so the next download request can resume it.
    throw error
  }
  return meetingModelState(id)
}

const decodeRuntimePayload = (value) => Buffer.from(value, 'base64').toString('utf8')

const parseRuntimeResponse = (line) => {
  const fields = line.split('\t')
  if (fields.length < 3 || (fields[0] !== 'OK' && fields[0] !== 'ERROR')) return null
  return { status: fields[0], requestId: fields[1], payload: decodeRuntimePayload(fields[2]) }
}

const rejectRuntimeRequests = (error) => {
  if (!meetingRuntime) return
  for (const request of meetingRuntime.pending.values()) {
    clearTimeout(request.timer)
    request.reject(error)
  }
  meetingRuntime.pending.clear()
}

const stopMeetingRuntime = () => {
  if (!meetingRuntime) return
  const current = meetingRuntime
  const error = new Error('本地端侧 Runtime 已停止')
  for (const request of current.pending.values()) {
    clearTimeout(request.timer)
    request.reject(error)
  }
  current.pending.clear()
  meetingRuntime = null
  current.readline.close()
  current.child.kill()
}

const ensureMeetingRuntime = async () => {
  if (meetingRuntime?.ready) return meetingRuntime
  if (meetingRuntimeStarting) return meetingRuntimeStarting
  if (!meetingRuntimeBinaryAvailable()) throw new Error('桌面端本地 GGUF Runtime 未安装')
  for (const id of Object.keys(MEETING_MODELS)) {
    if (meetingModelState(id).status !== 'ready') throw new Error('请先下载并校验两个端侧模型')
  }

  meetingRuntimeStarting = new Promise((resolve, reject) => {
    const models = Object.fromEntries(Object.entries(MEETING_MODELS).map(([id, model]) => {
      const target = path.join(meetingModelsDirectory(), model.fileName)
      return [id, target]
    }))
    const child = spawn(meetingRuntimeBinaryPath(), [models['moss-transcribe'], models['minicpm5-value']], {
      cwd: path.dirname(meetingRuntimeBinaryPath()),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const readline = createInterface({ input: child.stdout })
    const pending = new Map()
    const state = { child, readline, pending, ready: false, nextRequestId: 1 }
    meetingRuntime = state
    const fail = (error) => {
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.reject(error)
      }
      pending.clear()
      if (meetingRuntime === state) meetingRuntime = null
      if (!state.ready) reject(error)
    }
    child.stderr.on('data', (chunk) => console.warn(`[meeting-runtime] ${String(chunk).trimEnd()}`))
    child.once('error', fail)
    child.once('exit', (code, signal) => {
      const error = new Error(`本地端侧 Runtime 已退出（${code ?? signal ?? 'unknown'}）`)
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.reject(error)
      }
      pending.clear()
      if (meetingRuntime === state) meetingRuntime = null
      if (!state.ready) reject(error)
    })
    readline.on('line', (line) => {
      if (line === 'READY') {
        state.ready = true
        resolve(state)
        return
      }
      const response = parseRuntimeResponse(line)
      if (!response) return
      const request = pending.get(response.requestId)
      if (!request) return
      pending.delete(response.requestId)
      clearTimeout(request.timer)
      if (response.status === 'OK') request.resolve(response.payload)
      else request.reject(new Error(response.payload || '本地端侧 Runtime 请求失败'))
    })
  }).finally(() => {
    meetingRuntimeStarting = null
  })
  return meetingRuntimeStarting
}

const sendMeetingRuntimeCommand = async (command, fields, timeoutMs = 180_000) => {
  const state = await ensureMeetingRuntime()
  const requestId = String(state.nextRequestId++)
  const encodedFields = fields.map((field) => Buffer.from(String(field), 'utf8').toString('base64'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(requestId)
      reject(new Error('本地端侧 Runtime 响应超时'))
    }, timeoutMs)
    state.pending.set(requestId, { resolve, reject, timer })
    state.child.stdin.write(`${command}\t${requestId}\t${encodedFields.join('\t')}\n`)
  })
}

const parseMossTranscript = (raw, startedAtMs, endedAtMs) => {
  const segments = []
  const pattern = /\[(\d+(?:\.\d+)?)\]\[(S\d+)\]([\s\S]*?)(?=\[\d+(?:\.\d+)?\]|$)/g
  let match
  while ((match = pattern.exec(raw)) !== null) {
    const transcript = match[3].trim()
    if (!transcript) continue
    const nextMarker = /\[(\d+(?:\.\d+)?)\]/.exec(raw.slice(pattern.lastIndex))
    const startOffset = Number(match[1])
    const endOffset = nextMarker ? Number(nextMarker[1]) : Math.max(startOffset + 1, (endedAtMs - startedAtMs) / 1000)
    segments.push({
      startedAt: new Date(startedAtMs + startOffset * 1000).toISOString(),
      endedAt: new Date(startedAtMs + endOffset * 1000).toISOString(),
      transcript,
      speakerId: match[2],
    })
  }
  if (segments.length > 0) return segments
  const fallback = raw.replace(/\[(?:\d+(?:\.\d+)?|S\d+)\]/g, ' ').replace(/\s+/g, ' ').trim()
  return fallback ? [{
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    transcript: fallback,
  }] : []
}

const transcribeMeetingAudio = async ({ audioBase64, startedAtMs, endedAtMs, brainContext }) => {
  if (typeof audioBase64 !== 'string' || audioBase64.length > 16_000_000) throw new Error('本地音频片段过大')
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) throw new Error('本地音频时间戳无效')
  const temporary = path.join(app.getPath('temp'), `wemux-meeting-${process.pid}-${Date.now()}.wav`)
  try {
    writeFileSync(temporary, Buffer.from(audioBase64, 'base64'), { mode: 0o600 })
    const raw = await sendMeetingRuntimeCommand('TRANSCRIBE', [temporary])
    const segments = []
    for (const segment of parseMossTranscript(raw, startedAtMs, endedAtMs)) {
      const verdictRaw = await sendMeetingRuntimeCommand('JUDGE', [segment.transcript, String(brainContext || '').slice(0, 8_000)])
      let verdict = { valuable: false, valueLabel: null, confidence: 0, channels: [] }
      try {
        const parsed = JSON.parse(verdictRaw)
        verdict = {
          valuable: parsed.valuable === true,
          valueLabel: typeof parsed.valueLabel === 'string' ? parsed.valueLabel : null,
          confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
          channels: Array.isArray(parsed.channels) ? parsed.channels : [],
        }
      } catch {}
      segments.push({ ...segment, ...verdict })
    }
    return { segments }
  } finally {
    try { unlinkSync(temporary) } catch {}
  }
}

const windowStatePath = () => path.join(app.getPath('userData'), 'window-state.json')

const readWindowState = () => {
  try {
    const value = JSON.parse(readFileSync(windowStatePath(), 'utf8'))
    if (!Number.isFinite(value.width) || !Number.isFinite(value.height)) return DEFAULT_BOUNDS
    return value
  } catch {
    return DEFAULT_BOUNDS
  }
}

const isVisibleOnAnyDisplay = (bounds) => screen.getAllDisplays().some((display) => {
  const area = display.workArea
  return bounds.x < area.x + area.width
    && bounds.x + bounds.width > area.x
    && bounds.y < area.y + area.height
    && bounds.y + bounds.height > area.y
})

const resolveWindowState = () => {
  const saved = readWindowState()
  if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y) || !isVisibleOnAnyDisplay(saved)) {
    return { ...DEFAULT_BOUNDS, maximized: Boolean(saved.maximized) }
  }
  return saved
}

const persistWindowState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const bounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds()
  try {
    writeFileSync(windowStatePath(), JSON.stringify({ ...bounds, maximized: mainWindow.isMaximized() }))
  } catch (error) {
    console.warn('[desktop] failed to persist window state', error)
  }
}

const scheduleWindowStateSave = () => {
  clearTimeout(stateSaveTimer)
  stateSaveTimer = setTimeout(persistWindowState, 250)
}

const showMainWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

const toggleMainWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide()
  else showMainWindow()
}

const sendRendererEvent = (channel, payload) => {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) return false
  mainWindow.webContents.send(channel, payload)
  return true
}

const dispatchDeepLinks = (urls) => {
  const normalized = urls.filter((url) => typeof url === 'string' && url.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}://`))
  if (normalized.length === 0) return
  showMainWindow()
  if (!sendRendererEvent('wemux:deep-link', normalized)) pendingDeepLinks.push(...normalized)
}

const takeDeepLinksFromArgv = (argv) => argv.filter((value) => value.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}://`))

const probeWorker = () => new Promise((resolve) => {
  const socket = net.createConnection({ host: WORKER_HOST, port: WORKER_PORT })
  const finish = (running) => {
    socket.destroy()
    resolve(running)
  }
  socket.setTimeout(800)
  socket.once('connect', () => finish(true))
  socket.once('timeout', () => finish(false))
  socket.once('error', () => finish(false))
})

const workerStatus = async () => ({
  running: await probeWorker(),
  host: WORKER_HOST,
  port: WORKER_PORT,
  checkedAtMs: Date.now(),
})

const createTrayMenu = () => Menu.buildFromTemplate([
  { label: '打开 Wemux', click: showMainWindow },
  { label: `本地 Worker: ${workerRunning ? '在线' : '离线'}`, enabled: false },
  { type: 'separator' },
  {
    label: '退出',
    click: () => {
      isQuitting = true
      app.quit()
    },
  },
])

const refreshTrayWorkerStatus = async () => {
  workerRunning = await probeWorker()
  if (!tray || tray.isDestroyed()) return
  tray.setToolTip(`Wemux - Worker ${workerRunning ? '在线' : '离线'}`)
  tray.setContextMenu(createTrayMenu())
}

const createTray = () => {
  let icon = nativeImage.createFromPath(resolveAppIconPath())
  if (isMac) icon = icon.resize({ width: 18, height: 18 })
  tray = new Tray(icon)
  tray.on('click', showMainWindow)
  tray.setContextMenu(createTrayMenu())
  void refreshTrayWorkerStatus()
  setInterval(() => void refreshTrayWorkerStatus(), 15_000).unref()
}

const emitUpdate = (payload) => sendRendererEvent('wemux:update', payload)

const configureUpdater = () => {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', (info) => {
    pendingUpdate = {
      currentVersion: app.getVersion(),
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    }
    emitUpdate({ type: 'available', ...pendingUpdate })
  })
  autoUpdater.on('update-not-available', () => emitUpdate({ type: 'none' }))
  autoUpdater.on('download-progress', (progress) => {
    emitUpdate({ type: 'downloading', received: progress.transferred, total: progress.total })
  })
  autoUpdater.on('update-downloaded', () => {
    updateDownloaded = true
    emitUpdate({ type: 'installed' })
  })
  autoUpdater.on('error', (error) => emitUpdate({ type: 'error', message: error.message }))
}

const checkForDesktopUpdate = async () => {
  if (!app.isPackaged) {
    emitUpdate({ type: 'none' })
    return null
  }
  await autoUpdater.checkForUpdates()
  return pendingUpdate
}

const installDesktopUpdate = async () => {
  if (!app.isPackaged) throw new Error('开发模式不支持自动更新')
  if (!pendingUpdate) await checkForDesktopUpdate()
  if (!pendingUpdate) return
  await autoUpdater.downloadUpdate()
}

const registerIpc = () => {
  ipcMain.handle('wemux:invoke', async (event, command, args = {}) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('unauthorized renderer')
    switch (command) {
      case 'app_version':
        return app.getVersion()
      case 'worker_daemon_status':
        return workerStatus()
      case 'meeting_models_status':
        return meetingModelsStatus()
      case 'meeting_model_download': {
        const id = typeof args.modelId === 'string' ? args.modelId : ''
        const model = MEETING_MODELS[id]
        if (!model) throw new Error('unknown meeting model')
        if (meetingModelJobs.get(id)?.status === 'downloading') return meetingModelsStatus()
        meetingModelJobs.set(id, { status: 'downloading', downloadedBytes: 0 })
        emitUpdate({ type: 'meeting-model-download-started', modelId: id })
        void writeMeetingModel(id, (received) => {
          meetingModelJobs.set(id, { status: 'downloading', downloadedBytes: received })
          emitUpdate({ type: 'meeting-model-download-progress', modelId: id, received, total: model.sizeBytes })
        }).then(() => {
          meetingModelJobs.delete(id)
          emitUpdate({ type: 'meeting-model-download-finished', modelId: id })
        }).catch((error) => {
          meetingModelJobs.set(id, { status: 'error', error: error instanceof Error ? error.message : String(error) })
          emitUpdate({ type: 'meeting-model-download-failed', modelId: id })
        })
        return meetingModelsStatus()
      }
      case 'meeting_model_delete': {
        const id = typeof args.modelId === 'string' ? args.modelId : ''
        const model = MEETING_MODELS[id]
        if (!model) throw new Error('unknown meeting model')
        const target = path.join(meetingModelsDirectory(), model.fileName)
        for (const file of [target, `${target}.json`, `${target}.download`]) {
          try { unlinkSync(file) } catch {}
        }
        meetingModelJobs.delete(id)
        if (meetingRuntime) stopMeetingRuntime()
        return meetingModelsStatus()
      }
      case 'meeting_runtime_transcribe': {
        return transcribeMeetingAudio({
          audioBase64: args.audioBase64,
          startedAtMs: Number(args.startedAtMs),
          endedAtMs: Number(args.endedAtMs),
          brainContext: typeof args.brainContext === 'string' ? args.brainContext : '',
        })
      }
      case 'show_notification': {
        const title = typeof args.title === 'string' ? args.title.slice(0, 160) : 'Wemux'
        const body = typeof args.body === 'string' ? args.body.slice(0, 2000) : ''
        if (!Notification.isSupported()) throw new Error('system notifications are unavailable')
        new Notification({ title, body }).show()
        return true
      }
      case 'autostart_is_enabled':
        return app.getLoginItemSettings().openAtLogin
      case 'autostart_set_enabled': {
        const enabled = Boolean(args.enabled)
        app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: enabled })
        return app.getLoginItemSettings().openAtLogin
      }
      case 'take_pending_deep_links': {
        const urls = pendingDeepLinks
        pendingDeepLinks = []
        return urls
      }
      case 'check_for_update':
        return checkForDesktopUpdate()
      case 'pending_update':
        return pendingUpdate
      case 'install_update':
        return installDesktopUpdate()
      case 'restart_app':
        if (updateDownloaded) autoUpdater.quitAndInstall(false, true)
        else {
          isQuitting = true
          app.relaunch()
          app.exit(0)
        }
        return null
      default:
        throw new Error(`unsupported desktop command: ${String(command)}`)
    }
  })
}

const registerAppProtocol = () => {
  const webRoot = path.join(process.resourcesPath, 'web')
  protocol.handle(DESKTOP_SCHEME, (request) => {
    const requestUrl = new URL(request.url)
    let pathname
    try {
      pathname = decodeURIComponent(requestUrl.pathname)
    } catch {
      return new Response('Bad Request', { status: 400 })
    }
    const requestedPath = path.resolve(webRoot, `.${pathname}`)
    if (requestedPath !== webRoot && !requestedPath.startsWith(`${webRoot}${path.sep}`)) {
      return new Response('Forbidden', { status: 403 })
    }
    const hasFile = existsSync(requestedPath) && statSync(requestedPath).isFile()
    const filePath = hasFile ? requestedPath : path.join(webRoot, 'index.html')
    return electronNet.fetch(pathToFileURL(filePath).toString())
  })
}

const createMainWindow = async () => {
  console.log('[desktop] creating main window')
  const saved = resolveWindowState()
  const windowIcon = resolveAppIconPath()
  mainWindow = new BrowserWindow({
    ...DEFAULT_BOUNDS,
    ...saved,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Wemux',
    icon: windowIcon,
    backgroundColor: isMac ? '#00000000' : '#09090b',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 20 } : undefined,
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    webPreferences: {
      preload: path.join(moduleDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow.hide()
  })
  mainWindow.on('move', scheduleWindowStateSave)
  mainWindow.on('resize', scheduleWindowStateSave)
  mainWindow.on('maximize', scheduleWindowStateSave)
  mainWindow.on('unmaximize', scheduleWindowStateSave)
  if (isMac) {
    mainWindow.on('enter-full-screen', () => mainWindow?.setVibrancy(null))
    mainWindow.on('leave-full-screen', () => mainWindow?.setVibrancy('sidebar'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedOrigin = app.isPackaged ? `${DESKTOP_SCHEME}://local` : new URL(process.env.WEMUX_DESKTOP_DEV_URL || 'http://127.0.0.1:15173/chat').origin
    if (new URL(url).origin === allowedOrigin) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingDeepLinks.length > 0) {
      const urls = pendingDeepLinks
      pendingDeepLinks = []
      mainWindow?.webContents.send('wemux:deep-link', urls)
    }
  })
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(`[desktop] failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[desktop] renderer process exited: ${details.reason}`)
  })
  let rendererReadyToShow = false
  mainWindow.once('ready-to-show', () => {
    rendererReadyToShow = true
    console.log('[desktop] main window ready to show')
  })

  const initialUrl = app.isPackaged
    ? `${DESKTOP_SCHEME}://local/chat`
    : process.env.WEMUX_DESKTOP_DEV_URL || 'http://127.0.0.1:15173/chat'
  const retryableDevLoadError = (error) => !app.isPackaged
    && (String(error?.code) === '-3' || String(error?.message).includes('ERR_ABORTED'))

  for (let attempt = 1; attempt <= DEV_LOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      await mainWindow.loadURL(initialUrl)
      break
    } catch (error) {
      if (!retryableDevLoadError(error) || attempt === DEV_LOAD_MAX_ATTEMPTS) throw error
      console.warn(`[desktop] Vite interrupted initial navigation; retrying (${attempt}/${DEV_LOAD_MAX_ATTEMPTS})`)
      await new Promise((resolve) => setTimeout(resolve, DEV_LOAD_RETRY_DELAY_MS))
    }
  }
  console.log(`[desktop] main window loaded ${initialUrl}`)
  if (saved.maximized) mainWindow.maximize()
  if (rendererReadyToShow || !mainWindow.isVisible()) showMainWindow()
}

const registerDeepLinkProtocol = () => {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
console.log(`[desktop] single-instance lock: ${gotSingleInstanceLock ? 'acquired' : 'unavailable'}; ready: ${app.isReady()}`)

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    dispatchDeepLinks(takeDeepLinksFromArgv(argv))
    showMainWindow()
  })
  app.on('open-url', (event, url) => {
    event.preventDefault()
    dispatchDeepLinks([url])
  })
  app.on('before-quit', () => {
    isQuitting = true
    stopMeetingRuntime()
    persistWindowState()
  })
  app.on('activate', () => {
    if (mainWindow) showMainWindow()
    else void createMainWindow()
  })
  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })

  app.on('ready', () => console.log('[desktop] Electron ready event received'))
  void app.whenReady()
    .then(async () => {
      console.log('[desktop] Electron ready promise resolved')
      nativeTheme.themeSource = 'dark'
      registerDeepLinkProtocol()
      if (app.isPackaged) registerAppProtocol()
      registerIpc()
      configureUpdater()

      session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const isMainWindow = webContents === mainWindow?.webContents
        callback(permission === 'notifications' || (permission === 'media' && isMainWindow))
      })
      session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        const isMainWindow = webContents === mainWindow?.webContents
        return permission === 'media' && isMainWindow
      })
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        ...(isMac ? [{ role: 'appMenu' }] : []),
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ]))

      if (isMac) {
        const dockIcon = nativeImage.createFromPath(resolveAppIconPath())
        if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon)
      }
      createTray()
      await createMainWindow()
      globalShortcut.register('CommandOrControl+Shift+W', toggleMainWindow)
      dispatchDeepLinks(takeDeepLinksFromArgv(process.argv))

      if (app.isPackaged) {
        setTimeout(() => void checkForDesktopUpdate().catch(() => {}), 8_000).unref()
      }
    })
    .catch((error) => console.error('[desktop] failed to bootstrap Electron', error))
}
