export type PreviewTunnelProtocolVersion = 'preview-tunnel.v1'

export const PREVIEW_TUNNEL_MIN_CHUNK_BYTES = 16 * 1024
export const PREVIEW_TUNNEL_DEFAULT_CHUNK_BYTES = 128 * 1024
export const PREVIEW_TUNNEL_MAX_CHUNK_BYTES = 512 * 1024

export const normalizePreviewTunnelChunkBytes = (value?: number) => {
  if (!Number.isFinite(value)) {
    return PREVIEW_TUNNEL_DEFAULT_CHUNK_BYTES
  }

  const rounded = Math.floor(value as number)
  return Math.max(
    PREVIEW_TUNNEL_MIN_CHUNK_BYTES,
    Math.min(PREVIEW_TUNNEL_MAX_CHUNK_BYTES, rounded),
  )
}

export interface PreviewTunnelFrameBase {
  type: string
  previewSessionId: string
  sentAt: string
}

export interface PreviewTunnelStreamFrameBase extends PreviewTunnelFrameBase {
  streamId: string
}

export interface PreviewBindFrame extends PreviewTunnelFrameBase {
  type: 'preview.bind'
  protocolVersion: PreviewTunnelProtocolVersion
  executorId: string
  binaryPayloads?: boolean
  preferredChunkBytes?: number
}

export interface PreviewBindAckFrame extends PreviewTunnelFrameBase {
  type: 'preview.bind.ack'
  accepted: boolean
  reason?:
    | 'ok'
    | 'invalid_token'
    | 'session_not_found'
    | 'session_closed'
    | 'executor_mismatch'
    | 'protocol_mismatch'
    | 'tunnel_conflict'
  connectionId?: string
  publicHost?: string
  idleTimeoutMs?: number
  maxChunkBytes?: number
  binaryPayloads?: boolean
}

export interface PreviewTunnelPingFrame extends PreviewTunnelFrameBase {
  type: 'preview.tunnel.ping'
  pingId: string
}

export interface PreviewTunnelPongFrame extends PreviewTunnelFrameBase {
  type: 'preview.tunnel.pong'
  pingId: string
}

export interface PreviewHttpRequestStartFrame extends PreviewTunnelStreamFrameBase {
  type: 'preview.http.request.start'
  method: string
  pathWithQuery: string
  targetUrl?: string
  injectNavigationBridge?: boolean
  headers: Array<[string, string]>
  hasBody: boolean
  requestId: string
}

export interface PreviewHttpRequestBodyFrame extends PreviewTunnelStreamFrameBase {
  type: 'preview.http.request.body'
  seq: number
  encoding: 'base64'
  data: string
}

export interface PreviewHttpRequestEndFrame extends PreviewTunnelStreamFrameBase {
  type: 'preview.http.request.end'
}

export interface PreviewHttpResponseStartFrame extends PreviewTunnelStreamFrameBase {
  type: 'preview.http.response.start'
  status: number
  headers: Array<[string, string]>
}

export interface PreviewHttpResponseBodyFrame extends PreviewTunnelStreamFrameBase {
  type: 'preview.http.response.body'
  seq: number
  encoding: 'base64'
  data: string
}

export type PreviewTunnelBinaryFrameType =
  | 'preview.http.request.body.binary'
  | 'preview.http.response.body.binary'
  | 'preview.ws.data.binary'

export interface PreviewTunnelBinaryFrameHeader extends PreviewTunnelStreamFrameBase {
  type: PreviewTunnelBinaryFrameType
  seq: number
}

export interface PreviewHttpResponseEndFrame extends PreviewTunnelStreamFrameBase {
  type: 'preview.http.response.end'
}

export interface PreviewHttpAbortFrame extends PreviewTunnelStreamFrameBase {
  type: 'preview.http.abort'
  code:
    | 'client_closed'
    | 'gateway_timeout'
    | 'upstream_connect_failed'
    | 'upstream_reset'
    | 'session_closed'
    | 'internal_error'
  message?: string
}

export interface PreviewWsOpenFrame extends PreviewTunnelStreamFrameBase {
  type: 'preview.ws.open'
  pathWithQuery: string
  targetUrl?: string
  headers: Array<[string, string]>
  subprotocols: string[]
}

export interface PreviewWsOpenedFrame extends PreviewTunnelStreamFrameBase {
  type: 'preview.ws.opened'
  accepted: boolean
  selectedSubprotocol?: string
  status?: number
  message?: string
}

export interface PreviewWsDataFrame extends PreviewTunnelStreamFrameBase {
  type: 'preview.ws.data'
  seq: number
  opcode: 'text' | 'binary'
  encoding: 'utf8' | 'base64'
  data: string
}

export interface PreviewWsCloseFrame extends PreviewTunnelStreamFrameBase {
  type: 'preview.ws.close'
  code?: number
  reason?: string
}

export type PreviewTunnelFrame =
  | PreviewBindFrame
  | PreviewBindAckFrame
  | PreviewTunnelPingFrame
  | PreviewTunnelPongFrame
  | PreviewHttpRequestStartFrame
  | PreviewHttpRequestBodyFrame
  | PreviewHttpRequestEndFrame
  | PreviewHttpResponseStartFrame
  | PreviewHttpResponseBodyFrame
  | PreviewHttpResponseEndFrame
  | PreviewHttpAbortFrame
  | PreviewWsOpenFrame
  | PreviewWsOpenedFrame
  | PreviewWsDataFrame
  | PreviewWsCloseFrame

const PREVIEW_TUNNEL_BINARY_HEADER_BYTES = 4
const previewTunnelTextEncoder = new TextEncoder()
const previewTunnelTextDecoder = new TextDecoder()
const PREVIEW_TUNNEL_BINARY_FRAME_TYPES: PreviewTunnelBinaryFrameType[] = [
  'preview.http.request.body.binary',
  'preview.http.response.body.binary',
  'preview.ws.data.binary',
]

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
)

const isPreviewTunnelBinaryFrameHeader = (value: unknown): value is PreviewTunnelBinaryFrameHeader => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const header = value as Partial<PreviewTunnelBinaryFrameHeader>
  return Boolean(
    header.type
    && PREVIEW_TUNNEL_BINARY_FRAME_TYPES.includes(header.type)
    && isNonEmptyString(header.previewSessionId)
    && isNonEmptyString(header.streamId)
    && isNonEmptyString(header.sentAt)
    && typeof header.seq === 'number'
    && Number.isInteger(header.seq)
    && header.seq >= 0,
  )
}

export const encodePreviewTunnelBinaryFrame = (
  header: PreviewTunnelBinaryFrameHeader,
  payload: Uint8Array,
) => {
  const headerBytes = previewTunnelTextEncoder.encode(JSON.stringify(header))
  const frame = new Uint8Array(PREVIEW_TUNNEL_BINARY_HEADER_BYTES + headerBytes.byteLength + payload.byteLength)
  new DataView(frame.buffer, frame.byteOffset, PREVIEW_TUNNEL_BINARY_HEADER_BYTES).setUint32(0, headerBytes.byteLength)
  frame.set(headerBytes, PREVIEW_TUNNEL_BINARY_HEADER_BYTES)
  frame.set(payload, PREVIEW_TUNNEL_BINARY_HEADER_BYTES + headerBytes.byteLength)
  return frame
}

export const decodePreviewTunnelBinaryFrame = (frame: Uint8Array) => {
  if (frame.byteLength < PREVIEW_TUNNEL_BINARY_HEADER_BYTES) {
    return null
  }

  const headerLength = new DataView(frame.buffer, frame.byteOffset, PREVIEW_TUNNEL_BINARY_HEADER_BYTES).getUint32(0)
  const headerStart = PREVIEW_TUNNEL_BINARY_HEADER_BYTES
  const payloadStart = headerStart + headerLength
  if (headerLength <= 0 || payloadStart > frame.byteLength) {
    return null
  }

  let header: unknown
  try {
    header = JSON.parse(previewTunnelTextDecoder.decode(frame.subarray(headerStart, payloadStart)))
  } catch {
    return null
  }

  if (!isPreviewTunnelBinaryFrameHeader(header)) {
    return null
  }

  return {
    header,
    payload: frame.subarray(payloadStart),
  }
}
