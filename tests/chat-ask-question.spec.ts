/**
 * E2E: chat 关键路径（真实依赖）
 *
 * 依赖：真实 Postgres + 真实 OpenRouter API。
 * .env.local 需配齐 OPENROUTER_API_KEY、NEXT_PUBLIC_SUPABASE_*。
 * 不 mock 外部 HTTP——这是「敢上线」级别的烟雾测试。
 *
 * 覆盖：建 KB → 上传 .txt（自动解析）→ 等 hasKnowledge → 提问
 *       → SSE 200 + text/event-stream → 助手回答渲染到 DOM
 *
 * 这是「管道还通」级别的 smoke——不验证召回质量（那是 /eval 的事）。
 * citation 出不出来取决于 embedding/query 距离能否过 cosine<0.4 阈值，属于
 * retrieval quality 范畴；这里只把它当作 soft signal 在测试输出里 log，
 * 不作为断言。
 */
import { test, expect } from "@playwright/test"
import path from "node:path"

const TXT_FIXTURE = path.join(__dirname, "fixtures/sample.txt")

// Hard requirements — no fallbacks in code, so absence guarantees test failure.
// OPENROUTER = chat + embeddings + rerank; SUPABASE = file storage
// (the upload path writes to a Supabase Storage bucket).
// DATABASE_URL has a localhost:5433/airag default in lib/db/pg.ts, so we don't
// gate on it — if the default Postgres isn't reachable the test fails loudly.
const REQUIRED_ENV = [
  "OPENROUTER_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key])

test.describe("Chat — ask question (real services)", () => {
  test.skip(missingEnv.length > 0, `Missing required env: ${missingEnv.join(", ")}`)

  let kbId: string | null = null

  test.beforeEach(async ({ request }) => {
    const res = await request.post("/api/knowledge-bases", {
      data: { name: `E2E Chat ${Date.now()}`, description: "" },
    })
    const json = await res.json()
    expect(json.ok).toBe(true)
    kbId = json.data?.knowledgeBase?.id ?? null
    expect(kbId).toBeTruthy()
  })

  test.afterEach(async ({ request }) => {
    if (kbId) await request.delete(`/api/knowledge-bases/${kbId}`)
    kbId = null
  })

  test("uploads a file and gets a grounded streamed answer", async ({ page }) => {
    test.setTimeout(180_000)

    await page.goto(`/knowledge-bases/${kbId}/chat`)

    // The KnowledgePanel always renders the hidden file input on desktop.
    await page.locator("#panel-file-upload").setInputFiles(TXT_FIXTURE)

    const sendBtn = page.getByRole("button", { name: "Send", exact: true })

    await page.getByRole("textbox").fill("What is the capital of the Olympus Initiative?")

    // Real embeddings + index can take 30–60s; give a generous bound.
    // The button only enables once a file reaches status="indexed".
    await expect(sendBtn).toBeEnabled({ timeout: 120_000 })

    const sseResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/chat/stream") && res.request().method() === "POST"
    )
    await sendBtn.click()
    const response = await sseResponse
    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toMatch(/text\/event-stream/)

    // Hard assertion: assistant text rendered to DOM (tokens were consumed).
    // Scoped to the assistant message body — KnowledgePanel and empty-state
    // paragraphs are out of scope so they can't satisfy this on their own.
    await expect(
      page.locator('[data-testid="assistant-message"]').filter({ hasText: /\S{10,}/ }).first()
    ).toBeVisible({ timeout: 60_000 })

    // Soft signal: log whether retrieval surfaced a citation. Don't fail —
    // recall quality belongs to /eval, not this smoke test.
    const citationCount = await page.locator('[data-testid="citation"]').count()
    console.log(`[smoke] retrieved citations rendered: ${citationCount}`)
  })

  test("send button stays disabled before any file is indexed", async ({ page }) => {
    await page.goto(`/knowledge-bases/${kbId}/chat`)

    // Wait for chat input to render (page out of the loading state).
    const textbox = page.getByRole("textbox")
    await expect(textbox).toBeVisible({ timeout: 15_000 })

    await textbox.fill("hello")

    const sendBtn = page.getByRole("button", { name: "Send", exact: true })
    await expect(sendBtn).toBeDisabled()
  })
})
