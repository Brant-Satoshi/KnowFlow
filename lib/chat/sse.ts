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

export async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: ParsedSseEvent) => void
) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    buffer += decoder.decode(value, { stream: true })
    buffer = buffer.replace(/\r\n/g, "\n")

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

  const lastEvent = buffer.trim()
  if (lastEvent.length > 0) {
    const parsed = parseSseEvent(lastEvent)
    if (parsed) {
      onEvent(parsed)
    }
  }
}
