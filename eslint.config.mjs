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
      // Colour discipline: semantic/component tokens only. "warn" until the
      // remaining legacy offenders are cleaned up, then promote to "error".
      "better-tailwindcss/no-restricted-classes": [
        "warn",
        {
          restrict: [
            // Any Tailwind palette family, on any colour-bearing prefix.
            {
              pattern:
                "(?:^|:)(?:bg|text|border|ring|from|via|to|fill|stroke|shadow|outline|decoration|divide|accent|caret|placeholder)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-|/|$)",
              message: "请使用项目语义颜色 Token。",
            },
            // Colour literals anywhere inside an arbitrary value, including
            // gradients — `bg-[linear-gradient(…,rgba(…),…)]` slipped through
            // an anchored `bg-[#|rgb(` check. `hsl(var(--token))` is allowed,
            // and `shadow-` is exempt because rgba shadows are theme-neutral.
            {
              pattern:
                "(?:^|:)(?:bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|divide|accent|caret|placeholder)-\\[[^\\]]*(?:#[0-9a-fA-F]{3,8}|rgba?\\(|hsla?\\((?!var\\()|oklch\\(|oklab\\()",
              message: "不要在组件中硬编码颜色。",
            },
          ],
        },
      ],
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
