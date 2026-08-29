// [INPUT]: 端侧会议模型的固定版本清单与 native bridge 状态。
// [OUTPUT]: 桌面/Android 共用的下载、校验和推理能力模型。
// [POS]: 背后听写设置页与 Electron/Android 原生下载器之间的稳定契约。

export type MeetingModelId = 'moss-transcribe' | 'minicpm5-value'

export type MeetingModelDefinition = {
  id: MeetingModelId
  name: string
  description: string
  fileName: string
  sizeBytes: number
  sha256: string
  downloadUrl: string
  format: 'gguf'
  inference: 'native-ready' | 'native-pending'
}

export type MeetingModelState = {
  id: MeetingModelId
  status: 'not-downloaded' | 'downloading' | 'ready' | 'error'
  downloadedBytes: number
  totalBytes: number
  error?: string | null
  path?: string | null
  inferenceReady: boolean
  inferenceBackendAvailable?: boolean
  inferenceStatus?: 'model-not-downloaded' | 'backend-unavailable' | 'not-loaded' | 'ready'
}

// Quantized artifacts keep the full two-model bundle around 1.2 GB. The SHA
// values are the immutable LFS object ids returned by Hugging Face.
export const MEETING_MODEL_CATALOG: readonly MeetingModelDefinition[] = [
  {
    id: 'moss-transcribe',
    name: 'MOSS 转录与说话人模型',
    description: 'GGUF Q4_K，约 535 MB；负责中文转录、时间戳和说话人区分。',
    fileName: 'moss-transcribe-q4_k.gguf',
    sizeBytes: 535_272_448,
    sha256: 'ac22065a8f9ad10416262a950e9e87e4e6b51ef90e07a42a1a62cb718a12623b',
    downloadUrl: 'https://huggingface.co/mudler/moss-transcribe.cpp-gguf/resolve/main/moss-transcribe-q4_k.gguf?download=true',
    format: 'gguf',
    inference: 'native-ready',
  },
  {
    id: 'minicpm5-value',
    name: 'MiniCPM5 价值判断模型',
    description: 'GGUF Q4_K_M，约 656 MB；负责判断哪些会议片段值得进入 Agent 上下文。',
    fileName: 'MiniCPM5-1B-Q4_K_M.gguf',
    sizeBytes: 688_065_920,
    sha256: '81b64d05a23b17b34c475f42b3e72fbde62d4b92cc34541f7a8031d0752deafa',
    downloadUrl: 'https://huggingface.co/openbmb/MiniCPM5-1B-GGUF/resolve/main/MiniCPM5-1B-Q4_K_M.gguf?download=true',
    format: 'gguf',
    inference: 'native-ready',
  },
]

export const getMeetingModelDefinition = (id: MeetingModelId) => (
  MEETING_MODEL_CATALOG.find((model) => model.id === id) ?? null
)

export const emptyMeetingModelStates = (): MeetingModelState[] => MEETING_MODEL_CATALOG.map((model) => ({
  id: model.id,
  status: 'not-downloaded',
  downloadedBytes: 0,
  totalBytes: model.sizeBytes,
  error: null,
  path: null,
  inferenceReady: false,
  inferenceBackendAvailable: false,
  inferenceStatus: 'model-not-downloaded',
}))

export const formatModelSize = (bytes: number) => {
  if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(1)} GB`
  return `${Math.round(bytes / (1024 ** 2))} MB`
}
