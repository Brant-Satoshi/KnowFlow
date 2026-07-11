/**
 * API-level tests for the eval endpoints (Playwright APIRequestContext, no
 * browser). Covers the request-validation layer of POST /api/eval/run and the
 * managed-dataset CRUD semantics (optimistic concurrency, atomic import,
 * cap). None of these hit OpenRouter — runs are never actually started.
 */
import { test, expect } from "@playwright/test"

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000"

function makeCase(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    question: `What does the corpus say about ${id}?`,
    expectedKeywords: ["kovacs"],
    category: "single_fact",
    difficulty: "easy",
    targetFileNames: ["sample.txt"],
    targetChunkSubstrings: [],
    ...overrides,
  }
}

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
      data: { knowledgeBaseId: "not-a-uuid", datasetId: VALID_UUID, mode: "curated" },
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  test("returns 400 when knowledgeBaseId is an empty string", async ({
    request,
  }) => {
    const res = await request.post("/api/eval/run", {
      data: { knowledgeBaseId: "", datasetId: VALID_UUID, mode: "curated" },
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  test("returns 400 when knowledgeBaseId is a number", async ({ request }) => {
    const res = await request.post("/api/eval/run", {
      data: { knowledgeBaseId: 12345, datasetId: VALID_UUID, mode: "curated" },
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
      data: JSON.stringify([{ knowledgeBaseId: VALID_UUID }]),
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
  // Must be a real KB the signed-in e2e user can access: the route runs
  // requireKnowledgeBaseAccess before the dataset lookup and returns 404 for
  // unknown KB ids, so a hardcoded UUID would never reach the branches
  // asserted below.
  let validKbId: string

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/knowledge-bases", {
      data: { name: `Eval API Spec KB ${Date.now()}` },
    })
    const json = await res.json()
    expect(json.ok).toBe(true)
    validKbId = json.data.knowledgeBase.id
  })

  test.afterAll(async ({ request }) => {
    if (validKbId) await request.delete(`/api/knowledge-bases/${validKbId}`)
  })

  test("curated mode with missing datasetId returns 400", async ({ request }) => {
    const res = await request.post("/api/eval/run", {
      data: { knowledgeBaseId: validKbId, mode: "curated" },
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  test("curated mode with non-UUID datasetId returns 400", async ({ request }) => {
    const res = await request.post("/api/eval/run", {
      data: { knowledgeBaseId: validKbId, mode: "curated", datasetId: "not-a-uuid" },
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  test("curated mode with an unknown datasetId returns 404 dataset_not_found", async ({ request }) => {
    const res = await request.post("/api/eval/run", {
      data: {
        knowledgeBaseId: validKbId,
        mode: "curated",
        datasetId: "00000000-0000-4000-8000-0000000000ff",
      },
    })
    expect(res.status()).toBe(404)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toBe("dataset_not_found")
  })

  test("unknown mode value returns 400", async ({ request }) => {
    const res = await request.post("/api/eval/run", {
      data: { knowledgeBaseId: validKbId, mode: "bogus", datasetId: VALID_UUID },
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toBe("invalid_request")
  })

  test("missing mode returns 400 even with a datasetId", async ({ request }) => {
    const res = await request.post("/api/eval/run", {
      data: { knowledgeBaseId: validKbId, datasetId: VALID_UUID },
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toBe("invalid_request")
  })
})

test.describe("eval datasets API — CRUD, atomic import, optimistic concurrency", () => {
  test("lifecycle: create, add, conflict, stale-hash 409, edit, delete", async ({ request }) => {
    const name = `Goldset Spec ${Date.now()}`

    // create (no expectedDatasetHash on creation)
    let res = await request.post("/api/eval/datasets", {
      data: { name, description: "spec dataset" },
    })
    expect(res.status()).toBe(200)
    let json = await res.json()
    expect(json.ok).toBe(true)
    const datasetId: string = json.data.dataset.id
    const emptyHash: string = json.data.dataset.datasetHash
    expect(json.data.dataset.caseCount).toBe(0)

    try {
      // duplicate name → 409
      res = await request.post("/api/eval/datasets", { data: { name } })
      expect(res.status()).toBe(409)
      json = await res.json()
      expect(json.error).toBe("dataset_name_conflict")

      // single add (object form) — response carries the new hash
      res = await request.post(`/api/eval/datasets/${datasetId}/cases`, {
        data: { expectedDatasetHash: emptyHash, cases: makeCase("case-a") },
      })
      expect(res.status()).toBe(200)
      json = await res.json()
      expect(json.data.dataset.caseCount).toBe(1)
      const hashAfterA: string = json.data.dataset.datasetHash
      expect(hashAfterA).not.toBe(emptyHash)
      const caseAUuid: string = json.data.cases[0].id
      expect(json.data.cases[0].caseKey).toBe("case-a")

      // concurrent editor with the stale (pre-add) hash → 409 dataset_changed
      res = await request.post(`/api/eval/datasets/${datasetId}/cases`, {
        data: { expectedDatasetHash: emptyHash, cases: makeCase("case-b") },
      })
      expect(res.status()).toBe(409)
      json = await res.json()
      expect(json.error).toBe("dataset_changed")
      expect(json.data.currentHash).toBe(hashAfterA)

      // batch with an in-batch duplicate id → whole batch rejected, nothing written
      res = await request.post(`/api/eval/datasets/${datasetId}/cases`, {
        data: {
          expectedDatasetHash: hashAfterA,
          cases: [makeCase("case-dup"), makeCase("case-dup")],
        },
      })
      expect(res.status()).toBe(409)
      json = await res.json()
      expect(json.error).toBe("duplicate_case_keys")
      expect(json.data.duplicateCaseKeys).toEqual(["case-dup"])

      // batch conflicting with a stored case_key → whole batch rejected
      res = await request.post(`/api/eval/datasets/${datasetId}/cases`, {
        data: {
          expectedDatasetHash: hashAfterA,
          cases: [makeCase("case-a"), makeCase("case-c")],
        },
      })
      expect(res.status()).toBe(409)
      json = await res.json()
      expect(json.error).toBe("duplicate_case_keys")
      expect(json.data.duplicateCaseKeys).toEqual(["case-a"])

      // nothing was written by the two rejected batches
      res = await request.get(`/api/eval/datasets/${datasetId}`)
      json = await res.json()
      expect(json.data.dataset.caseCount).toBe(1)
      expect(json.data.dataset.datasetHash).toBe(hashAfterA)

      // edit the case (full replacement, business key rename)
      res = await request.patch(`/api/eval/datasets/${datasetId}/cases/${caseAUuid}`, {
        data: {
          expectedDatasetHash: hashAfterA,
          case: makeCase("case-a-renamed", { question: "Renamed question?" }),
        },
      })
      expect(res.status()).toBe(200)
      json = await res.json()
      const hashAfterEdit: string = json.data.dataset.datasetHash
      expect(hashAfterEdit).not.toBe(hashAfterA)
      expect(json.data.cases[0].caseKey).toBe("case-a-renamed")

      // delete the case; idx compaction leaves an empty set
      res = await request.fetch(`/api/eval/datasets/${datasetId}/cases/${caseAUuid}`, {
        method: "DELETE",
        data: { expectedDatasetHash: hashAfterEdit },
      })
      expect(res.status()).toBe(200)
      json = await res.json()
      expect(json.data.dataset.caseCount).toBe(0)

      // delete the dataset with its current hash
      const finalHash: string = json.data.dataset.datasetHash
      res = await request.fetch(`/api/eval/datasets/${datasetId}`, {
        method: "DELETE",
        data: { expectedDatasetHash: finalHash },
      })
      expect(res.status()).toBe(200)

      res = await request.get(`/api/eval/datasets/${datasetId}`)
      expect(res.status()).toBe(404)
    } finally {
      // best-effort cleanup if an assertion aborted the flow above
      const detail = await request.get(`/api/eval/datasets/${datasetId}`)
      if (detail.ok()) {
        const body = await detail.json()
        await request.fetch(`/api/eval/datasets/${datasetId}`, {
          method: "DELETE",
          data: { expectedDatasetHash: body.data.dataset.datasetHash },
        })
      }
    }
  })

  test("cap: the 50th case is allowed, the 51st single add is rejected", async ({ request }) => {
    const name = `Goldset Cap Spec ${Date.now()}`
    const initial = Array.from({ length: 49 }, (_, i) => makeCase(`case-${i}`))

    let res = await request.post("/api/eval/datasets", {
      data: { name, cases: initial },
    })
    expect(res.status()).toBe(200)
    let json = await res.json()
    const datasetId: string = json.data.dataset.id
    let hash: string = json.data.dataset.datasetHash
    expect(json.data.dataset.caseCount).toBe(49)

    try {
      // 50th case: allowed
      res = await request.post(`/api/eval/datasets/${datasetId}/cases`, {
        data: { expectedDatasetHash: hash, cases: makeCase("case-49") },
      })
      expect(res.status()).toBe(200)
      json = await res.json()
      expect(json.data.dataset.caseCount).toBe(50)
      hash = json.data.dataset.datasetHash

      // 51st case: single add rejected with the structured cap payload
      res = await request.post(`/api/eval/datasets/${datasetId}/cases`, {
        data: { expectedDatasetHash: hash, cases: makeCase("case-50") },
      })
      expect(res.status()).toBe(409)
      json = await res.json()
      expect(json.error).toBe("goldset_limit_exceeded")
      expect(json.data).toMatchObject({ limit: 50, existingCount: 50, incomingCount: 1 })
    } finally {
      const detail = await request.get(`/api/eval/datasets/${datasetId}`)
      if (detail.ok()) {
        const body = await detail.json()
        await request.fetch(`/api/eval/datasets/${datasetId}`, {
          method: "DELETE",
          data: { expectedDatasetHash: body.data.dataset.datasetHash },
        })
      }
    }
  })
})
