---
name: ui-conventions-audit
description: Audit a diff or component tree for KnowFlow frontend conventions — bilingual i18n coverage, cursor-pointer, semantic Tailwind tokens, shadcn-only components. Use before finishing any UI change; also on demand ("i18n 补漏", "检查 UI 规范"). These four rules have historically been violated after the fact and fixed in follow-up commits — this audit prevents that.
---

# UI conventions audit

Run this on the current diff (`git diff` / `git diff main...HEAD`) before finishing any UI work. Each check below has produced real follow-up fix commits when skipped.

## 1. i18n — no hardcoded user-visible text

- Grep the diff for string literals in JSX and in `aria-label`, `placeholder`, `title`, `alt` attributes. Every user-visible string must come from `lib/i18n/translations.ts`.
- Every new key exists in **both** `en` and `zh`, in the correct section (`home`, `chat`, `eval`, `auth`).
- Parameterised strings use `{placeholder}` + `.replace("{placeholder}", value)` at the call site.
- Sub-components take `t` as a prop typed `ReturnType<typeof useLanguage>["home" | "t" | "evalT" | "authT"]` — they don't call `useLanguage()` themselves unless they're standalone client components.
- User data is never translated; system-generated names go through `lib/i18n/workspace-name.ts`.
- Check for **dead keys**: if the diff removes UI, remove its now-unused translation keys.

## 2. Interactivity — `cursor-pointer`

Every `button`, `a`, and clickable `div`/`Card` in the diff has `cursor-pointer`. Grep for `onClick` in the diff and verify each host element.

## 3. Colors — semantic tokens only

No raw palette classes (`text-gray-*`, `bg-white`, `text-black`, `border-slate-*`, hex values in `style`). Use `bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`. Verify the change looks right in **both light and dark** themes — raw palette classes are usually discovered as dark-mode bugs.

## 4. Components — shadcn/ui + lucide only

No MUI/antd/other UI kits, no inline CSS, no new icon packs. If a needed shadcn component isn't in `components/ui/`, ask before adding it.

## Output

Report violations as `file:line — rule — fix`, apply the fixes, then `pnpm build && pnpm lint`.
