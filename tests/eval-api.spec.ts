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

test.describe("POST /api/eval/run — curated mode validation", () => {
  const validKbId = "550e8400-e29b-41d4-a716-446655440000"

  test("curated mode with missing datasetName returns 400", async ({ request }) => {
    const res = await request.post("/api/eval/run", {
      data: { knowledgeBaseId: validKbId, mode: "curated" },
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  test("curated mode with empty datasetName returns 400", async ({ request }) => {
    const res = await request.post("/api/eval/run", {
      data: { knowledgeBaseId: validKbId, mode: "curated", datasetName: "" },
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  test("curated mode with unknown datasetName returns 400 unknown_dataset", async ({ request }) => {
    const res = await request.post("/api/eval/run", {
      data: {
        knowledgeBaseId: validKbId,
        mode: "curated",
        datasetName: "does-not-exist",
      },
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toBe("unknown_dataset")
  })

  test("curated mode still validates knowledgeBaseId first", async ({ request }) => {
    const res = await request.post("/api/eval/run", {
      data: { knowledgeBaseId: "not-a-uuid", mode: "curated", datasetName: "olympus" },
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  test("unknown mode value returns 400", async ({ request }) => {
    const res = await request.post("/api/eval/run", {
      data: { knowledgeBaseId: validKbId, mode: "bogus", datasetName: "olympus" },
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toBe("invalid_request")
  })

  test("missing mode returns 400 even with a datasetName", async ({ request }) => {
    const res = await request.post("/api/eval/run", {
      data: { knowledgeBaseId: validKbId, datasetName: "olympus" },
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toBe("invalid_request")
  })
})
