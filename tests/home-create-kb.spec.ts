import { test, expect } from "@playwright/test"

const TEST_KB_NAME = `Playwright Test KB ${Date.now()}`
const TEST_KB_DESC = "Created by automated Playwright test"

test.describe("Home page — create knowledge base", () => {
  let createdKbId: string | null = null

  // Clean up: delete the KB created during the test
  test.afterEach(async ({ request }) => {
    if (!createdKbId) return
    await request.delete(`/api/knowledge-bases/${createdKbId}`)
    createdKbId = null
  })

  test("opens create dialog via header button and creates a KB", async ({ page }) => {
    await page.goto("/")

    // Wait for the page to finish loading (skeleton gone)
    await expect(page.locator("main h1")).toBeVisible()

    // Click the "New Collection" button in the header
    await page.locator("header").getByRole("button", { name: /new collection/i }).click()

    // Dialog should appear with a title
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("heading", { name: /create knowledge base/i })).toBeVisible()

    // Fill in name
    await dialog.getByPlaceholder(/name/i).fill(TEST_KB_NAME)

    // Fill in description
    await dialog.getByRole("textbox").nth(1).fill(TEST_KB_DESC)

    // Intercept the POST response to capture the new KB id
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/knowledge-bases") && res.request().method() === "POST"
    )

    // Click the create button inside the dialog
    await dialog.getByRole("button", { name: /^create$/i }).click()

    const response = await responsePromise
    const json = await response.json()
    expect(json.ok).toBe(true)
    createdKbId = json.data?.knowledgeBase?.id ?? null

    // After creation, should redirect to the chat page for the new KB
    await page.waitForURL(/\/knowledge-bases\/.+\/chat/, { timeout: 10_000 })
    expect(page.url()).toMatch(/\/knowledge-bases\/.+\/chat/)
  })

  test("shows validation error when name is empty", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("main h1")).toBeVisible()

    await page.locator("header").getByRole("button", { name: /new collection/i }).click()

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()

    // The Create button should be disabled when name is empty
    const createBtn = dialog.getByRole("button", { name: /^create$/i })
    await expect(createBtn).toBeDisabled()
  })

  test("can cancel the create dialog", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("main h1")).toBeVisible()

    await page.locator("header").getByRole("button", { name: /new collection/i }).click()

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()

    // Click Cancel
    await dialog.getByRole("button", { name: /cancel/i }).click()

    // Dialog should close and we stay on the home page
    await expect(dialog).not.toBeVisible()
    expect(page.url()).toMatch(/\/$|\/\?/)
  })

  test("opens create dialog via grid + card when KBs exist", async ({ page }) => {
    // Create a KB via API first so the grid (not the empty state) is shown
    const res = await page.request.post("/api/knowledge-bases", {
      data: { name: `${TEST_KB_NAME} seed` },
    })
    const seedJson = await res.json()
    const seedId: string = seedJson.data?.knowledgeBase?.id

    await page.goto("/")

    // Wait for KB grid to appear (contains the NewKBCard)
    await expect(page.locator("main .grid")).toBeVisible()

    // The "New Collection" card in the grid
    await page.locator("main .grid").getByRole("button", { name: /new collection/i }).click()

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("heading", { name: /create knowledge base/i })).toBeVisible()

    // Close dialog
    await dialog.getByRole("button", { name: /cancel/i }).click()
    await expect(dialog).not.toBeVisible()

    // Cleanup seed KB
    await page.request.delete(`/api/knowledge-bases/${seedId}`)
  })
})
