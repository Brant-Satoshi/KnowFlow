/**
 * E2E: 知识面板批量上传
 *
 * Every KB-scoped API the chat page calls is mocked (the same approach as
 * eval-page.spec.ts), so this needs neither Supabase Storage nor OpenRouter —
 * only the shared auth setup. The upload/parse mocks count how many requests
 * are in flight at once, which is how the concurrency cap is checked from the
 * outside.
 */
import { test, expect, type Page } from "@playwright/test"

const KB_ID = "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f"
// Keep in sync with UPLOAD_CONCURRENCY in lib/hooks/use-file-state.ts.
const UPLOAD_CONCURRENCY = 3

interface MockFile {
  id: string
  name: string
  type: string
  size: number
  status: "uploaded" | "parsing" | "indexed" | "failed"
  createdAt: string
  knowledgeBaseId: string
}

interface MockOptions {
  uploadDelayMs?: number
  parseDelayMs?: number
  /** Files whose parse fails with `no_text_extracted`. */
  unparseable?: string[]
  /** Files whose first upload attempt fails. */
  flakyUploads?: string[]
}

const ok = (data: unknown) => JSON.stringify({ requestId: "req-mock", ok: true, data })
const fail = (error: string, data?: unknown) =>
  JSON.stringify({ requestId: "req-mock", ok: false, error, data })
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function mockChatPageApi(page: Page, options: MockOptions = {}) {
  const { uploadDelayMs = 250, parseDelayMs = 250, unparseable = [], flakyUploads = [] } = options
  const files = new Map<string, MockFile>()
  const stats = { peakInFlight: 0, uploadAttempts: [] as string[] }
  let inFlight = 0

  // Counted from arrival until just before the response is sent, so the browser
  // can't have started a follow-up request while the old one is still counted.
  const hold = async (ms: number) => {
    inFlight += 1
    stats.peakInFlight = Math.max(stats.peakInFlight, inFlight)
    await sleep(ms)
    inFlight -= 1
  }

  const now = new Date().toISOString()
  await page.route(
    (url) => url.pathname === "/api/knowledge-bases",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: ok({
          knowledgeBase: { id: KB_ID, name: "Batch upload e2e", description: "", createdAt: now, updatedAt: now },
        }),
      })
  )
  await page.route(
    (url) => url.pathname === "/api/conversations",
    (route) => route.fulfill({ contentType: "application/json", body: ok({ conversations: [] }) })
  )
  await page.route(
    (url) => url.pathname === "/api/files",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: ok({ files: [...files.values()].reverse() }),
      })
  )

  await page.route(
    (url) => url.pathname === "/api/files/upload",
    async (route) => {
      const body = route.request().postDataBuffer()?.toString("latin1") ?? ""
      const name = /filename="([^"]+)"/.exec(body)?.[1] ?? "unknown"
      stats.uploadAttempts.push(name)
      await hold(uploadDelayMs)

      const attempt = stats.uploadAttempts.filter((n) => n === name).length
      if (flakyUploads.includes(name) && attempt === 1) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: fail("Failed to upload file: storage unavailable"),
        })
      }

      const file: MockFile = {
        id: crypto.randomUUID(),
        name,
        type: "text/plain",
        size: 64,
        status: "uploaded",
        createdAt: new Date().toISOString(),
        knowledgeBaseId: KB_ID,
      }
      files.set(file.id, file)
      return route.fulfill({ contentType: "application/json", body: ok({ file }) })
    }
  )

  await page.route(
    (url) => /^\/api\/files\/[^/]+\/parse$/.test(url.pathname),
    async (route) => {
      const id = new URL(route.request().url()).pathname.split("/")[3]
      await hold(parseDelayMs)

      const file = files.get(id)
      if (!file) {
        return route.fulfill({ status: 404, contentType: "application/json", body: fail("Not found") })
      }
      if (unparseable.includes(file.name)) {
        file.status = "failed"
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: fail("No text could be extracted from this file.", { code: "no_text_extracted" }),
        })
      }
      file.status = "indexed"
      return route.fulfill({ contentType: "application/json", body: ok({ chunkCount: 3, file }) })
    }
  )

  return stats
}

const textFile = (name: string) => ({
  name,
  mimeType: name.endsWith(".md") ? "text/markdown" : "text/plain",
  buffer: Buffer.from(`Contents of ${name}\n`),
})

/** The row for one file, matched on its exact name (the name cell carries it as `title`). */
const rowFor = (page: Page, name: string) =>
  page.getByTestId("file-row").filter({ has: page.getByTitle(name, { exact: true }) })

test.describe("Chat page — batch upload", () => {
  test("processes a batch at most three at a time and accounts for every file", async ({ page }) => {
    const stats = await mockChatPageApi(page, { unparseable: ["scanned.txt"] })
    await page.goto(`/knowledge-bases/${KB_ID}/chat`)

    const accepted = ["alpha.txt", "bravo.md", "charlie.txt", "delta.md", "scanned.txt"]
    await page.locator("#panel-file-upload").setInputFiles([
      ...accepted.map(textFile),
      { name: "photo.png", mimeType: "image/png", buffer: Buffer.from("not a document") },
    ])

    // The image is refused before any request: named once, in a toast, never listed.
    // (Exact matches: the toast also repeats its text in an aria-live announcement.)
    await expect(page.getByText("1 file skipped", { exact: true })).toBeVisible()
    await expect(page.getByText("Unsupported type: photo.png", { exact: true })).toBeVisible()
    await expect(rowFor(page, "photo.png")).toHaveCount(0)

    // Files beyond the first three wait their turn, and the drop zone counts progress.
    const progress = page.locator("p", { hasText: /\d\/5 processed/ })
    await expect(rowFor(page, "scanned.txt")).toContainText("queued")
    await expect(progress).toBeVisible()

    for (const name of ["alpha.txt", "bravo.md", "charlie.txt", "delta.md"]) {
      await expect(rowFor(page, name)).toContainText("indexed", { timeout: 15_000 })
    }

    // A parse failure stays on its row with the reason, next to a retry.
    const failedRow = rowFor(page, "scanned.txt")
    await expect(failedRow).toContainText("failed", { timeout: 15_000 })
    await expect(failedRow).toContainText("No text could be extracted")
    await expect(failedRow.getByRole("button", { name: "Retry parse" })).toBeVisible()

    await expect(progress).toHaveCount(0)
    expect(stats.uploadAttempts.toSorted()).toEqual(accepted.toSorted())
    expect(stats.peakInFlight).toBeLessThanOrEqual(UPLOAD_CONCURRENCY)
    expect(stats.peakInFlight).toBeGreaterThan(1)
  })

  test("a failed upload keeps its row for a retry, and a queued file can be removed", async ({ page }) => {
    // Slow uploads keep the fifth file queued long enough to remove it.
    const stats = await mockChatPageApi(page, { uploadDelayMs: 1500, flakyUploads: ["flaky.md"] })
    await page.goto(`/knowledge-bases/${KB_ID}/chat`)

    await page
      .locator("#panel-file-upload")
      .setInputFiles(["one.md", "two.md", "flaky.md", "four.md", "five.md"].map(textFile))

    const queuedRow = rowFor(page, "five.md")
    await expect(queuedRow).toContainText("queued")
    await queuedRow.getByRole("button", { name: "Remove from queue" }).click()
    await expect(queuedRow).toHaveCount(0)

    const flakyRow = rowFor(page, "flaky.md")
    await expect(flakyRow).toContainText("Failed to upload file: storage unavailable", { timeout: 10_000 })
    await flakyRow.getByRole("button", { name: "Retry upload" }).click()
    await expect(flakyRow).toContainText("indexed", { timeout: 15_000 })

    for (const name of ["one.md", "two.md", "four.md"]) {
      await expect(rowFor(page, name)).toContainText("indexed", { timeout: 15_000 })
    }
    expect(stats.uploadAttempts).not.toContain("five.md")
    expect(stats.uploadAttempts.filter((name) => name === "flaky.md")).toHaveLength(2)
  })

  test("a selection over the batch cap is refused before anything is sent", async ({ page }) => {
    const stats = await mockChatPageApi(page)
    await page.goto(`/knowledge-bases/${KB_ID}/chat`)

    await page
      .locator("#panel-file-upload")
      .setInputFiles(Array.from({ length: 21 }, (_, i) => textFile(`doc-${i + 1}.md`)))

    await expect(
      page.getByText("You can upload up to 20 files at a time. Select fewer and try again.", { exact: true })
    ).toBeVisible()
    await expect(page.getByTestId("file-row")).toHaveCount(0)
    expect(stats.uploadAttempts).toEqual([])
  })
})
