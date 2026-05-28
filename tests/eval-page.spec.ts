import { test, expect, type Page } from "@playwright/test"

const MOCK_KB_ID = "550e8400-e29b-41d4-a716-446655440000"
const MOCK_KB_NAME = "Test Knowledge Base"

function makeEvalRunResult(knowledgeBaseId: string, runId: string) {
  return {
    runId,
    knowledgeBaseId,
    totalCases: 2,
    passedCases: 1,
    retrievalHitRate: 0.5,
    citationHitRate: 0.5,
    avgLatencyMs: 320,
    cases: [
      {
        caseId: "chunk-1",
        question: "What does the knowledge base say about: Introduction?",
        passed: true,
        failureReasons: [],
        retrievalHit: true,
        citationHit: true,
        latencyMs: 310,
        retrievedChunks: [
          {
            chunkId: "chunk-1",
            fileId: "file-1",
            fileName: "doc.pdf",
            textPreview: "Introduction to the topic…",
          },
        ],
        topKHits: [
          { k: 1, hit: true },
          { k: 3, hit: true },
          { k: 5, hit: true },
        ],
        answer: "The knowledge base says [1] that this is an introduction.",
      },
      {
        caseId: "chunk-2",
        question: "What does the knowledge base say about: Summary?",
        passed: false,
        failureReasons: ["retrieval_miss"],
        retrievalHit: false,
        citationHit: false,
        latencyMs: 330,
        retrievedChunks: [],
        topKHits: [
          { k: 1, hit: false },
          { k: 3, hit: false },
          { k: 5, hit: false },
        ],
        answer: "I couldn't find relevant information in the knowledge base.",
      },
    ],
  }
}

function mockKnowledgeBases(page: Page, kbs: { id: string; name: string }[]) {
  return page.route("/api/knowledge-bases", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        requestId: "req-mock-kbs",
        ok: true,
        data: {
          knowledgeBases: kbs.map((kb) => ({
            ...kb,
            description: "",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })),
        },
      }),
    })
  )
}

function mockEvalRun(
  page: Page,
  response: { status: number; body: object }
) {
  return page.route("/api/eval/run", (route) =>
    route.fulfill({
      status: response.status,
      contentType: "application/json",
      body: JSON.stringify(response.body),
    })
  )
}

test.describe("/eval page — layout and initial state", () => {
  test("renders the page title and description", async ({ page }) => {
    await mockKnowledgeBases(page, [])
    await page.goto("/eval")

    // Title should be visible
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /evaluation/i
    )
  })

  test("shows 'no knowledge bases' message when list is empty", async ({
    page,
  }) => {
    await mockKnowledgeBases(page, [])
    await page.goto("/eval")

    await expect(
      page.getByText(/no knowledge bases/i)
    ).toBeVisible()
  })

  test("run button is disabled when no KB is selected", async ({ page }) => {
    await mockKnowledgeBases(page, [
      { id: MOCK_KB_ID, name: MOCK_KB_NAME },
    ])
    await page.goto("/eval")

    // The select exists; nothing chosen yet (placeholder selected)
    const runBtn = page.getByRole("button", { name: /run evaluation/i })
    await expect(runBtn).toBeDisabled()
  })

  test("run button is enabled after selecting a knowledge base", async ({
    page,
  }) => {
    await mockKnowledgeBases(page, [
      { id: MOCK_KB_ID, name: MOCK_KB_NAME },
    ])
    await page.goto("/eval")

    await page
      .getByRole("combobox", { name: /select knowledge base/i })
      .selectOption({ value: MOCK_KB_ID })

    const runBtn = page.getByRole("button", { name: /run evaluation/i })
    await expect(runBtn).toBeEnabled()
  })

  test("shows empty-state prompt before running", async ({ page }) => {
    await mockKnowledgeBases(page, [
      { id: MOCK_KB_ID, name: MOCK_KB_NAME },
    ])
    await page.goto("/eval")

    await expect(
      page.getByText(/select a knowledge base and click run evaluation/i)
    ).toBeVisible()
  })
})

test.describe("/eval page — running evaluation", () => {
  test("shows loading state while evaluation runs", async ({ page }) => {
    await mockKnowledgeBases(page, [
      { id: MOCK_KB_ID, name: MOCK_KB_NAME },
    ])

    // Delay the eval response so we can observe the loading state
    await page.route("/api/eval/run", async (route) => {
      await new Promise((r) => setTimeout(r, 300))
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          requestId: "req-slow",
          ok: true,
          data: {
            knowledgeBaseId: MOCK_KB_ID,
            withRerank: makeEvalRunResult(MOCK_KB_ID, "run-a"),
            withoutRerank: makeEvalRunResult(MOCK_KB_ID, "run-b"),
          },
        }),
      })
    })

    await page.goto("/eval")
    await page
      .getByRole("combobox", { name: /select knowledge base/i })
      .selectOption({ value: MOCK_KB_ID })
    await page.getByRole("button", { name: /run evaluation/i }).click()

    // Should show "Running…" in the button
    await expect(page.getByText(/running/i)).toBeVisible()
  })

  test("displays metric panels after a successful run", async ({
    page,
  }) => {
    await mockKnowledgeBases(page, [
      { id: MOCK_KB_ID, name: MOCK_KB_NAME },
    ])
    await mockEvalRun(page, {
      status: 200,
      body: {
        requestId: "req-ok",
        ok: true,
        data: makeEvalRunResult(MOCK_KB_ID, "run-a"),
      },
    })

    await page.goto("/eval")
    await page
      .getByRole("combobox", { name: /select knowledge base/i })
      .selectOption({ value: MOCK_KB_ID })
    await page.getByRole("button", { name: /run evaluation/i }).click()

    // Section title reflects the current rerank toggle (default: on)
    await expect(page.getByText(/with rerank/i).first()).toBeVisible({
      timeout: 5000,
    })
    // Aggregate panels render the values from the mock
    await expect(page.getByText("1/2")).toBeVisible()
  })

  test("displays test case pairs after a successful run", async ({ page }) => {
    await mockKnowledgeBases(page, [
      { id: MOCK_KB_ID, name: MOCK_KB_NAME },
    ])
    await mockEvalRun(page, {
      status: 200,
      body: {
        requestId: "req-ok",
        ok: true,
        data: makeEvalRunResult(MOCK_KB_ID, "run-a"),
      },
    })

    await page.goto("/eval")
    await page
      .getByRole("combobox", { name: /select knowledge base/i })
      .selectOption({ value: MOCK_KB_ID })
    await page.getByRole("button", { name: /run evaluation/i }).click()

    // The case list section title
    await expect(page.getByText(/test cases/i)).toBeVisible({ timeout: 5000 })

    // The question from our mock data
    await expect(
      page.getByText(/what does the knowledge base say about: introduction/i)
    ).toBeVisible()
  })

  test("shows pass/fail badges in case entries", async ({ page }) => {
    await mockKnowledgeBases(page, [
      { id: MOCK_KB_ID, name: MOCK_KB_NAME },
    ])
    await mockEvalRun(page, {
      status: 200,
      body: {
        requestId: "req-ok",
        ok: true,
        data: makeEvalRunResult(MOCK_KB_ID, "run-a"),
      },
    })

    await page.goto("/eval")
    await page
      .getByRole("combobox", { name: /select knowledge base/i })
      .selectOption({ value: MOCK_KB_ID })
    await page.getByRole("button", { name: /run evaluation/i }).click()

    await expect(page.getByText(/test cases/i)).toBeVisible({ timeout: 5000 })

    // There should be at least one Pass and one Fail badge
    await expect(page.getByText("Pass").first()).toBeVisible()
    await expect(page.getByText("Fail").first()).toBeVisible()
  })
})

test.describe("/eval page — error handling", () => {
  test("shows 'no indexed documents' error for eval_no_chunks", async ({
    page,
  }) => {
    await mockKnowledgeBases(page, [
      { id: MOCK_KB_ID, name: MOCK_KB_NAME },
    ])
    await mockEvalRun(page, {
      status: 422,
      body: {
        requestId: "req-err",
        ok: false,
        error: "eval_no_chunks",
      },
    })

    await page.goto("/eval")
    await page
      .getByRole("combobox", { name: /select knowledge base/i })
      .selectOption({ value: MOCK_KB_ID })
    await page.getByRole("button", { name: /run evaluation/i }).click()

    await expect(
      page.getByText(/no indexed documents/i)
    ).toBeVisible({ timeout: 5000 })
  })

  test("shows generic error message for unexpected API failures", async ({
    page,
  }) => {
    await mockKnowledgeBases(page, [
      { id: MOCK_KB_ID, name: MOCK_KB_NAME },
    ])
    await mockEvalRun(page, {
      status: 500,
      body: {
        requestId: "req-err",
        ok: false,
        error: "eval_failed",
      },
    })

    await page.goto("/eval")
    await page
      .getByRole("combobox", { name: /select knowledge base/i })
      .selectOption({ value: MOCK_KB_ID })
    await page.getByRole("button", { name: /run evaluation/i }).click()

    await expect(
      page.getByText(/failed to run evaluation/i)
    ).toBeVisible({ timeout: 5000 })
  })

  test("run button is re-enabled after an error", async ({ page }) => {
    await mockKnowledgeBases(page, [
      { id: MOCK_KB_ID, name: MOCK_KB_NAME },
    ])
    await mockEvalRun(page, {
      status: 500,
      body: { requestId: "req-err", ok: false, error: "eval_failed" },
    })

    await page.goto("/eval")
    await page
      .getByRole("combobox", { name: /select knowledge base/i })
      .selectOption({ value: MOCK_KB_ID })
    await page.getByRole("button", { name: /run evaluation/i }).click()

    // After the error the button should be usable again
    const runBtn = page.getByRole("button", { name: /run evaluation/i })
    await expect(runBtn).toBeEnabled({ timeout: 5000 })
  })
})
