---
name: write-adr
description: Record a durable KnowFlow architecture decision or supersede an existing ADR, in Chinese and English.
---

# Architecture decisions

Record decisions that constrain future work or are expensive to reverse. A routine implementation choice or discarded experiment does not automatically need an ADR.

Use the next available `NNN.slug.md` in `docs/adr/` and the matching English file in `docs/adr/en/`. Follow the existing ADR structure: status, context, decision, alternatives, trade-offs, and consequences. Update both directories' README indexes.

Explain the strongest relevant alternatives and why the chosen approach fits this repository's constraints. Reference concrete implementation artifacts or evidence. Mark an unaccepted proposal as such; when replacing a decision, link the successor and update the old status in both languages.
