---
name: ui-conventions-audit
description: Review KnowFlow UI changes for translation, theme, component, and interaction convention violations.
---

# UI convention review

Apply `AGENTS.md` conventions to the requested diff or component scope.

- Trace visible text, accessibility labels, placeholders, tooltips, and notifications to matching `en` and `zh` translation keys. User content stays unchanged; generated workspace names use `lib/i18n/workspace-name.ts`.
- Check translation prop ownership and parameter replacement. Remove obsolete keys only after checking remaining callers.
- Check `cursor-pointer` on interactive host elements, including clickable cards.
- Use semantic color tokens and inspect changed styling in light and dark themes.
- Reuse `components/ui/` and lucide icons. Add a needed component within the task's scope using the existing UI system.

For a review request, report actionable findings with file and line references. For an implementation request, fix in-scope violations. Do not rerun build/lint solely because this audit was loaded; reuse the task's verification.
