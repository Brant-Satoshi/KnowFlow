/**
 * E2E: 错误兜底 —— 系统「不知道」时不能乱答（真实依赖）
 *
 * 依赖：真实 Postgres + 真实 OpenRouter + Supabase Storage，同 chat-ask-question.spec.ts。
 *
 * 关键点:断言不能只看「回答文案等于那句拒答」——prompt 本来就要求 LLM 在找不到
 * 答案时原样输出同一句话,所以即使拒答闸门完全没生效,这种断言也会通过。
 * 因此这里直接读原始 SSE 字节流,断言两件只有闸门生效才可能成立的事:
 *   1. meta 事件带 refusal 字段(LLM 永远不会产出它);
 *   2. 整个流里有且只有一个 token 事件,且 delta 全等拒答文案
 *      (真实 LLM 流是逐字吐的,不可能只有一个 token 事件)。
 */
import { test, expect, type APIRequestContext } from "@playwright/test"
import { readFileSync } from "node:fs"
import path from "node:path"

const TXT_FIXTURE = path.join(__dirname, "fixtures/sample.txt")

const REQUIRED_ENV = [
  "OPENROUTER_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key])

// Must match REFUSAL_TEXT_EN in lib/llm/refusal.ts.
const REFUSAL_TEXT_EN = "I couldn't find relevant information in the knowledge base."

type SseEvent = { event: string; data: Record<string, unknown> }

/** Parse a complete SSE body into its events (the stream closes, so we can read it whole). */
function parseSse(body: string): SseEvent[] {
  const events: SseEvent[] = []
  for (const block of body.split("\n\n")) {
    const lines = block.split("\n")
    const eventLine = lines.find((l) => l.startsWith("event:"))
    const dataLine = lines.find((l) => l.startsWith("data:"))
    if (!eventLine || !dataLine) continue
    try {
      events.push({
        event: eventLine.slice(6).trim(),
        data: JSON.parse(dataLine.slice(5).trim()),
      })
    } catch {
      // keepalive comments and partial blocks
    }
  }
  return events
}

async function createConversation(request: APIRequestContext, kbId: string): Promise<string> {
  const res = await request.post("/api/conversations", {
    data: { knowledgeBaseId: kbId },
  })
  expect(res.ok()).toBeTruthy()
  return (await res.json()).data.conversation.id as string
}

async function uploadAndIndex(
  request: APIRequestContext,
  kbId: string,
  name: string,
  contents: Buffer,
): Promise<string> {
  const upload = await request.post("/api/files/upload", {
    multipart: {
      knowledgeBaseId: kbId,
      file: { name, mimeType: "text/plain", buffer: contents },
    },
  })
  expect(upload.ok()).toBeTruthy()
  const fileId = (await upload.json()).data.file.id as string

  const parse = await request.post(`/api/files/${fileId}/parse`, { timeout: 120_000 })
  expect(parse.ok()).toBeTruthy()
  return fileId
}

async function ask(
  request: APIRequestContext,
  kbId: string,
  conversationId: string,
  message: string,
): Promise<SseEvent[]> {
  const res = await request.post("/api/chat/stream", {
    data: { message, knowledgeBaseId: kbId, conversationId },
    timeout: 120_000,
  })
  expect(res.status()).toBe(200)
  expect(res.headers()["content-type"]).toMatch(/text\/event-stream/)
  return parseSse(await res.text())
}

/** The assertions that only hold if the server refused *without* calling the LLM. */
function expectServerSideRefusal(events: SseEvent[], reason: "empty" | "low_score") {
  const meta = events.find((e) => e.event === "meta")
  expect(meta, "a meta event must be sent").toBeTruthy()
  // Proof the gate fired. The LLM cannot produce this field.
  expect(meta!.data.refusal).toBe(reason)

  const tokens = events.filter((e) => e.event === "token")
  // Proof the LLM never streamed: a real answer arrives as many deltas.
  expect(tokens).toHaveLength(1)
  expect(tokens[0].data.delta).toBe(REFUSAL_TEXT_EN)

  expect(events.some((e) => e.event === "error")).toBe(false)

  // Ordering: the client's stage machine needs meta and progress before the first
  // token, and done last. `title` is excluded — on a conversation's first turn it
  // is generated concurrently and deliberately drains *after* done, which the
  // client keeps reading for.
  const order = events.filter((e) => e.event !== "title").map((e) => e.event)
  expect(order.indexOf("meta")).toBeLessThan(order.indexOf("token"))
  expect(order).toContain("progress")
  expect(order.indexOf("token")).toBeLessThan(order.indexOf("done"))
  expect(order.at(-1)).toBe("done")
}

test.describe("Chat — refuses instead of inventing (real services)", () => {
  test.skip(missingEnv.length > 0, `Missing required env: ${missingEnv.join(", ")}`)

  let kbId: string

  test.beforeEach(async ({ request }) => {
    const res = await request.post("/api/knowledge-bases", {
      data: { name: `E2E Fallback ${Date.now()}`, description: "" },
    })
    kbId = (await res.json()).data?.knowledgeBase?.id
    expect(kbId).toBeTruthy()
  })

  test.afterEach(async ({ request }) => {
    if (kbId) await request.delete(`/api/knowledge-bases/${kbId}`)
  })

  test("a question the knowledge base cannot answer is refused, and the answer is persisted", async ({
    request,
  }) => {
    test.setTimeout(180_000)

    await uploadAndIndex(request, kbId, "sample.txt", readFileSync(TXT_FIXTURE))
    const conversationId = await createConversation(request, kbId)

    const events = await ask(
      request,
      kbId,
      conversationId,
      "What is the best way to cook a risotto?",
    )

    expectServerSideRefusal(events, "empty")

    // The refusal is a real turn: it survives a reload like any other answer.
    const convo = await request.get(`/api/conversations/${conversationId}`)
    const messages = (await convo.json()).data.conversation.messages as Array<{
      role: string
      content: string
      retrievedChunks?: unknown[]
    }>
    const assistant = messages.filter((m) => m.role === "assistant")
    expect(assistant).toHaveLength(1)
    expect(assistant[0].content).toBe(REFUSAL_TEXT_EN)
    expect(assistant[0].retrievedChunks ?? []).toHaveLength(0)
  })

  test("after its only document is deleted, the knowledge base refuses", async ({ request }) => {
    test.setTimeout(180_000)

    const fileId = await uploadAndIndex(request, kbId, "sample.txt", readFileSync(TXT_FIXTURE))
    const conversationId = await createConversation(request, kbId)

    // Answerable while the document is there...
    const before = await ask(
      request,
      kbId,
      conversationId,
      "Who is the lead researcher of the Olympus Initiative?",
    )
    expect(before.filter((e) => e.event === "token").length).toBeGreaterThan(1)

    // ...and unanswerable once it is gone. Deleting a file drops its chunks, so
    // the same question now retrieves nothing — this is the case where a model
    // asked to "answer from context" has no context left and is most likely to
    // fall back on what it remembers.
    const del = await request.delete(`/api/files/${fileId}`)
    expect(del.ok()).toBeTruthy()

    const after = await ask(
      request,
      kbId,
      conversationId,
      "Who is the lead researcher of the Olympus Initiative?",
    )
    expectServerSideRefusal(after, "empty")
  })

  test("an empty message is rejected before any work happens", async ({ request }) => {
    const conversationId = await createConversation(request, kbId)

    const res = await request.post("/api/chat/stream", {
      data: { message: "   ", knowledgeBaseId: kbId, conversationId },
    })

    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe("Message is required")
    expect(body.requestId).toBeTruthy()
  })

  test("the refusal renders as a plain answer, with no sources and no error", async ({ page, request }) => {
    test.setTimeout(180_000)

    await uploadAndIndex(request, kbId, "sample.txt", readFileSync(TXT_FIXTURE))

    await page.goto(`/knowledge-bases/${kbId}/chat`)

    // Send needs both text and an indexed file, so type first, then wait for the
    // file to finish indexing.
    await page.getByRole("textbox").fill("What is the best way to cook a risotto?")

    const sendBtn = page.getByRole("button", { name: "Send", exact: true })
    await expect(sendBtn).toBeEnabled({ timeout: 120_000 })
    await sendBtn.click()

    const assistantMessage = page.locator('[data-testid="assistant-message"]').first()
    await expect(assistantMessage).toContainText(REFUSAL_TEXT_EN, { timeout: 60_000 })

    // A refusal is not an error, cites nothing, and must not be nagged at by the
    // "no citations" warning — it declined to cite on purpose.
    await expect(page.locator('[data-testid="chat-error"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="citation"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="no-citation-warning"]')).toHaveCount(0)
  })
})
