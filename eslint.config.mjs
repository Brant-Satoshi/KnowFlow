import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{jsx,tsx}"],
    plugins: {
      "better-tailwindcss": betterTailwindcss,
    },
    settings: {
      "better-tailwindcss": {
        entryPoint: "app/globals.css",
      },
    },
    rules: {
      // Nudge toward canonical scale classes, e.g. h-1.75 over h-[7px].
      // "warn" so it flags without failing the build or forcing churn on
      // existing off-scale values that don't fit the theme (e.g. rounded-[4px]).
      "better-tailwindcss/enforce-canonical-classes": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Session worktrees (each with its own .next) live under .claude/ —
    // they are separate checkouts and must not be linted from here.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
