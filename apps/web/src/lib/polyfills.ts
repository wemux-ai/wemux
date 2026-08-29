const createFallbackRandomUUID = (): string => {
  const cryptoObject = globalThis.crypto

  if (cryptoObject?.getRandomValues) {
    const bytes = cryptoObject.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
  }

  let timestamp = Date.now()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (timestamp + Math.random() * 16) % 16 | 0
    timestamp = Math.floor(timestamp / 16)
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

const installRandomUUIDPolyfill = () => {
  const cryptoObject = globalThis.crypto as Crypto & { randomUUID?: () => string }

  if (typeof cryptoObject?.randomUUID === 'function') {
    return
  }

  const randomUUID = () => createFallbackRandomUUID()

  if (cryptoObject) {
    Object.defineProperty(cryptoObject, 'randomUUID', {
      value: randomUUID,
      configurable: true,
    })
    return
  }

  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID },
    configurable: true,
  })
}

installRandomUUIDPolyfill()
