import { defineConfig, devices } from "@playwright/test"
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

// Load .env.local into process.env so specs can read API keys
// (Next.js auto-loads them for the dev server, but the Playwright runner
// is a separate process that doesn't).
const envPath = resolve(__dirname, ".env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i)
    if (!m || line.trim().startsWith("#")) continue
    const [, key, rawVal] = m
    if (process.env[key]) continue
    process.env[key] = rawVal.replace(/^['"](.*)['"]$/, "$1")
  }
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    locale: "en-US",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
