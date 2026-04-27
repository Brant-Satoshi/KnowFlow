/**
 * API-level tests for POST /api/eval/run.
 * These use Playwright's APIRequestContext so no browser is needed.
 * They verify the input validation layer in app/api/eval/run/route.ts
 * without hitting the database or external services.
 */
import { test, expect } from "@playwright/test"

test.describe("POST /api/eval/run — request validation", () => {
  test("returns 400 when body is empty JSON object", async ({ request }) => {
    const res = await request.post("/api/eval/run", { data: {} })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(typeof json.error).toBe("string")
  })

  test("returns 400 when knowledgeBaseId is missing", async ({ request }) => {
    const res = await request.post("/api/eval/run", {
      data: { somethingElse: "value" },
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  test("returns 400 when knowledgeBaseId is not a valid UUID", async ({
    request,
  }) => {
    const res = await request.post("/api/eval/run", {
      data: { knowledgeBaseId: "not-a-uuid" },
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  test("returns 400 when knowledgeBaseId is an empty string", async ({
    request,
  }) => {
    const res = await request.post("/api/eval/run", {
      data: { knowledgeBaseId: "" },
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  test("returns 400 when knowledgeBaseId is a number", async ({ request }) => {
    const res = await request.post("/api/eval/run", {
      data: { knowledgeBaseId: 12345 },
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  test("returns 400 when body is a plain string (not JSON object)", async ({
    request,
  }) => {
    const res = await request.post("/api/eval/run", {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify("just a string"),
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  test("returns 400 when body is a JSON array", async ({ request }) => {
    const res = await request.post("/api/eval/run", {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify([{ knowledgeBaseId: "550e8400-e29b-41d4-a716-446655440000" }]),
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  test("returns 400 when body is not valid JSON", async ({ request }) => {
    const res = await request.post("/api/eval/run", {
      headers: { "Content-Type": "application/json" },
      data: "{ invalid json }",
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  test("response always includes a requestId field", async ({ request }) => {
    const res = await request.post("/api/eval/run", { data: {} })
    const json = await res.json()
    expect(typeof json.requestId).toBe("string")
    expect(json.requestId.length).toBeGreaterThan(0)
  })
})
