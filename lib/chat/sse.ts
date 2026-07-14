type ParsedSseEvent = {
  event: string
  data: unknown
}

export function parseSseEvent(rawEvent: string): ParsedSseEvent | null {
  const lines = rawEvent.split("\n")
  let event = "message"
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim()
      continue
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (dataLines.length === 0) return null

  const rawData = dataLines.join("\n")
  try {
    return { event, data: JSON.parse(rawData) }
  } catch {
    return { event, data: rawData }
  }
}

/**
 * The connection went quiet for longer than the watchdog allows.
 *
 * Note this can only catch a *dead* connection: the server keepalives every 15s,
 * so a live connection whose upstream LLM has stalled still looks busy from here.
 * That case is caught server-side (see streamLlmAnswer's idle watchdog), which is
 * why a stall surfaces as a `timeout` error event rather than through this class.
 */
export class SseIdleTimeoutError extends Error {
  constructor() {
    super("Connection timed out")
    this.name = "SseIdleTimeoutError"
  }
}

// The server emits a keepalive comment every 15s, so an idle gap of several
// multiples of that means the connection is dead, not the stage slow.
async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number | undefined
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!idleTimeoutMs) return reader.read()

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // Reject first: cancel() settles the pending read() with
          // { done: true }, which would otherwise win the race.
          reject(new SseIdleTimeoutError())
          reader.cancel().catch(() => {})
        }, idleTimeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: ParsedSseEvent) => void,
  options?: { idleTimeoutMs?: number }
) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await readWithIdleTimeout(reader, options?.idleTimeoutMs)
    if (done) break
    if (!value) continue

    buffer += decoder.decode(value, { stream: true })
    // Normalize CRLF and lone CR to LF. A trailing \r may be the first half of
    // a CRLF pair split across chunks, so hold it back until the next read.
    const holdback = buffer.endsWith("\r") ? "\r" : ""
    if (holdback) buffer = buffer.slice(0, -1)
    buffer = buffer.replace(/\r\n|\r/g, "\n") + holdback

    let boundary = buffer.indexOf("\n\n")
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary).trim()
      buffer = buffer.slice(boundary + 2)

      if (rawEvent.length > 0) {
        const parsed = parseSseEvent(rawEvent)
        if (parsed) {
          onEvent(parsed)
        }
      }

      boundary = buffer.indexOf("\n\n")
    }
  }

  const lastEvent = buffer.replace(/\r\n|\r/g, "\n").trim()
  if (lastEvent.length > 0) {
    const parsed = parseSseEvent(lastEvent)
    if (parsed) {
      onEvent(parsed)
    }
  }
}
