import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

export default defineConfig({
  // Handwritten SQL in db/migrations/00x_*.sql is the source of truth for
  // migrations (see Makefile). drizzle-kit is kept only for ORM type inference
  // and `db:studio`; any generated output goes to a scratch dir, NOT the
  // canonical migrations folder, to avoid a second source of truth.
  schema: "./lib/db/schema/auth.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
