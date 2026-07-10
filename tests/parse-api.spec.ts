/**
 * E2E: parse concurrency guard (real dependencies)
 *
 * Uploads a real .txt, then fires two parse requests at once: the atomic
 * status claim must let exactly one run (200) and reject the other (409),
 * leaving the file indexed. Requires OpenRouter (embeddings) + Supabase
 * Storage, mirroring chat-ask-question.spec.ts.
 */
import { test, expect } from "@playwright/test"
import { readFileSync } from "node:fs"
import path from "node:path"

const TXT_FIXTURE = path.join(__dirname, "fixtures/sample.txt")

const REQUIRED_ENV = [
  "OPENROUTER_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key])

test.describe("POST /api/files/[id]/parse — concurrency guard", () => {
  test.skip(missingEnv.length > 0, `Missing required env: ${missingEnv.join(", ")}`)

  test("second concurrent parse is rejected with 409", async ({ request }) => {
    test.setTimeout(120_000)

    const createKb = await request.post("/api/knowledge-bases", {
      data: { name: `parse-guard-e2e-${Date.now()}` },
    })
    expect(createKb.status()).toBe(201)
    const kbId = (await createKb.json()).data.knowledgeBase.id as string

    try {
      const upload = await request.post("/api/files/upload", {
        multipart: {
          knowledgeBaseId: kbId,
          file: {
            name: "parse-guard.txt",
            mimeType: "text/plain",
            buffer: readFileSync(TXT_FIXTURE),
          },
        },
      })
      expect(upload.ok()).toBeTruthy()
      const fileId = (await upload.json()).data.file.id as string

      const [first, second] = await Promise.all([
        request.post(`/api/files/${fileId}/parse`),
        request.post(`/api/files/${fileId}/parse`),
      ])

      const statuses = [first.status(), second.status()].sort()
      expect(statuses).toEqual([200, 409])

      const loser = first.status() === 409 ? first : second
      expect((await loser.json()).error).toContain("already being parsed")

      // The winner must leave the file indexed, not failed.
      const files = await request.get(`/api/files?knowledgeBaseId=${kbId}`)
      const fileRow = (await files.json()).data.files.find(
        (f: { id: string }) => f.id === fileId,
      )
      expect(fileRow?.status).toBe("indexed")
    } finally {
      await request.delete(`/api/knowledge-bases/${kbId}`)
    }
  })
})
