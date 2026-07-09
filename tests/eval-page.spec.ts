import { test, expect, type Page } from "@playwright/test"

const MOCK_KB_ID = "550e8400-e29b-41d4-a716-446655440000"
const MOCK_KB_NAME = "Test Knowledge Base"

function makeEvalRunResult(knowledgeBaseId: string, runId: string) {
  return {
    runId,
    knowledgeBaseId,
    mode: "curated",
    datasetHash: "hash-mock",
    totalCases: 2,
    passedCases: 1,
    retrievalHitRate: 0.5,
    citationHitRate: 0.5,
    avgLatencyMs: 320,
    recallAtK: { 1: 0.5, 3: 0.5, 5: 0.5 },
    precisionAtK: { 1: 0.5, 3: 0.33, 5: 0.2 },
    ndcgAtK: { 1: 0.5, 3: 0.55, 5: 0.6 },
    mrr: 0.75,
    avgFaithfulness: 0.86,
    avgAnswerRelevance: 0.91,
    cases: [
      {
        caseId: "case-1",
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
        expectedAnswer: "An introduction of the topic.",
        gradedHits: [3],
        faithfulness: 0.95,
        answerRelevance: 0.92,
      },
      {
        caseId: "case-2",
        question: "What does the knowledge base say about: Recap?",
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
        expectedAnswer: "A recap of the topic.",
        gradedHits: [],
        faithfulness: 0.2,
        answerRelevance: 0.4,
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

/** The page loads run history and the KB file list on KB selection; keep both hermetic. */
function mockEvalHistory(page: Page) {
  return page.route("**/api/eval/runs*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ requestId: "req-mock-runs", ok: true, data: { runs: [] } }),
    })
  )
}

function mockKbFiles(page: Page) {
  return page.route("**/api/files*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ requestId: "req-mock-files", ok: true, data: { files: [] } }),
    })
  )
}

/** Run a mocked evaluation and wait until the overview dashboard shows metrics. */
async function runMockedEval(page: Page) {
  await page.goto("/eval")
  await page
    .getByRole("combobox", { name: /select knowledge base/i })
    .selectOption({ value: MOCK_KB_ID })
  await page.getByRole("button", { name: /run evaluation/i }).click()
  await expect(page.getByText("Faithfulness").first()).toBeVisible({ timeout: 5000 })
}

test.describe("/eval page — layout and initial state", () => {
  test("renders the dashboard topbar and sidebar", async ({ page }) => {
    await mockKnowledgeBases(page, [])
    await page.goto("/eval")

    // The page is a tabbed dashboard now (no <h1>): topbar shows the active
    // tab title and the run button; the sidebar lists the tab switchers.
    await expect(page.getByRole("button", { name: /run evaluation/i })).toBeVisible()
    await expect(page.locator("aside").getByRole("button", { name: /inspector/i })).toBeVisible()
    await expect(page.getByText("Overview").first()).toBeVisible()
  })

  test("hides the knowledge base selector when none exist", async ({
    page,
  }) => {
    await mockKnowledgeBases(page, [])
    await page.goto("/eval")

    // With an empty KB list the selector is not rendered at all and the run
    // button can never enable — that's the current "no knowledge bases" state.
    await expect(page.getByRole("button", { name: /run evaluation/i })).toBeDisabled()
    await expect(
      page.getByRole("combobox", { name: /select knowledge base/i })
    ).toHaveCount(0)
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
    await mockEvalHistory(page)
    await mockKbFiles(page)
    await page.goto("/eval")

    await expect(
      page.getByText(/run an evaluation to populate the dashboard/i)
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
    await mockEvalHistory(page)
    await mockKbFiles(page)
    await mockEvalRun(page, {
      status: 200,
      body: {
        requestId: "req-ok",
        ok: true,
        data: makeEvalRunResult(MOCK_KB_ID, "run-a"),
      },
    })

    await runMockedEval(page)

    // The overview hero cards render the curated metrics from the mock
    await expect(page.getByText("Answer Relevance").first()).toBeVisible()
    await expect(page.getByText("Recall@5").first()).toBeVisible()
  })

  test("shows per-case results in the inspector after a run", async ({ page }) => {
    await mockKnowledgeBases(page, [
      { id: MOCK_KB_ID, name: MOCK_KB_NAME },
    ])
    await mockEvalHistory(page)
    await mockKbFiles(page)
    await mockEvalRun(page, {
      status: 200,
      body: {
        requestId: "req-ok",
        ok: true,
        data: makeEvalRunResult(MOCK_KB_ID, "run-a"),
      },
    })

    await runMockedEval(page)

    // Switch to the Inspector tab via the sidebar (client-side, keeps the
    // in-memory run result)
    await page.locator("aside").getByRole("button", { name: /inspector/i }).click()

    // The case list renders both mock questions with their index
    await expect(page.getByText("#001")).toBeVisible()
    await expect(
      page.getByText(/what does the knowledge base say about: introduction/i).first()
    ).toBeVisible()
    await expect(
      page.getByText(/what does the knowledge base say about: recap/i).first()
    ).toBeVisible()
  })

  test("filters cases by pass/fail in the inspector", async ({ page }) => {
    await mockKnowledgeBases(page, [
      { id: MOCK_KB_ID, name: MOCK_KB_NAME },
    ])
    await mockEvalHistory(page)
    await mockKbFiles(page)
    await mockEvalRun(page, {
      status: 200,
      body: {
        requestId: "req-ok",
        ok: true,
        data: makeEvalRunResult(MOCK_KB_ID, "run-a"),
      },
    })

    await runMockedEval(page)
    await page.locator("aside").getByRole("button", { name: /inspector/i }).click()
    await expect(page.getByText("#001")).toBeVisible()

    // "Failed" filter → only the failing case remains in the list
    await page.getByRole("button", { name: /^failed$/i }).first().click()
    await expect(
      page.getByText(/what does the knowledge base say about: recap/i).first()
    ).toBeVisible()
    await expect(
      page.getByText(/what does the knowledge base say about: introduction/i)
    ).toHaveCount(0)
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
