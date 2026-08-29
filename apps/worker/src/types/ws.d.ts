declare module 'ws' {
  export type RawData = Buffer | ArrayBuffer | Buffer[]

  export class WebSocket {
    static readonly OPEN: number
    readonly OPEN: number
    readonly readyState: number
    readonly protocol: string

    constructor(
      address: string | URL,
      protocols?: string | string[],
      options?: {
        headers?: Record<string, string>
      },
    )

    send(data: string | Uint8Array | Buffer): void
    close(code?: number, reason?: string): void
    on(event: 'open', listener: () => void): this
    on(event: 'message', listener: (data: RawData, isBinary: boolean) => void): this
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this
    on(event: 'error', listener: (error: Error) => void): this
  }

  export class WebSocketServer {
    constructor(options: { noServer: true })
    handleUpgrade(
      request: import('node:http').IncomingMessage,
      socket: import('node:stream').Duplex,
      head: Buffer,
      callback: (client: WebSocket) => void,
    ): void
  }
}
