/**
 * Shared auth setup for all specs.
 *
 * Every API route is wrapped in withAuth/requireUser (401 for anonymous) and
 * proxy.ts redirects anonymous page navigations to /login, so specs can no
 * longer run unauthenticated. This setup project signs in a dedicated e2e
 * user once per run and saves the rag_session cookie to STORAGE_STATE, which
 * the chromium project applies to both browser contexts and the `request`
 * fixture.
 *
 * The account is a fixed throwaway. Login is attempted first so the flow
 * never depends on duplicate-register semantics; only a virgin database
 * takes the register path. Registration also creates the user's personal
 * workspace, so KB creation works without a workspaceId.
 */
import { test as setup, expect } from "@playwright/test"
import { STORAGE_STATE } from "../playwright.config"

const E2E_EMAIL = "e2e-playwright@knowflow.test"
const E2E_PASSWORD = "playwright-e2e-pass"

setup("authenticate as shared e2e user", async ({ request }) => {
  const login = await request.post("/api/auth/login", {
    data: { email: E2E_EMAIL, password: E2E_PASSWORD },
  })

  if (login.status() !== 200) {
    // Account doesn't exist yet — first run against this database.
    const register = await request.post("/api/auth/register", {
      data: { email: E2E_EMAIL, password: E2E_PASSWORD },
    })
    expect(register.status(), "register e2e user").toBe(201)
  }

  await request.storageState({ path: STORAGE_STATE })
})
