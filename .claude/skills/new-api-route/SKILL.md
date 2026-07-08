---
name: new-api-route
description: Create or modify a KnowFlow API route handler. Use for any new endpoint or when editing an existing one — enforces the withAuth wrapper, authz guards, uuid param validation, and the standard response envelope that every endpoint must return.
---

# New / modified API route

Every business endpoint follows the same skeleton. Deviating from it (hand-rolled auth, ad-hoc JSON shapes, missing guards) has caused rework before — copy the pattern, don't improvise.

## Skeleton

```typescript
import { withAuth, parseUuidParam } from '@/lib/api/route';
import { success, error } from '@/lib/api/response';
import { requireKnowledgeBaseAccess } from '@/lib/authz/access';

export const GET = withAuth('Failed to <verb> <noun>', async (req, user, ctx: { params: Promise<{ id: string }> }) => {
  const id = await parseUuidParam(ctx.params, 'id', 'knowledge base id');
  if (id instanceof Response) return id;

  await requireKnowledgeBaseAccess(user.id, id); // throws → withAuth maps to 404/403

  const data = await someQueryModuleFn(id);      // queries live in lib/db/, not here
  return Response.json(success(data));
});
```

## Checklist

- [ ] `withAuth(fallbackMessage, handler)` from `lib/api/route.ts` — it handles `requireUser()` and the standard error tail (`NotFoundOrForbiddenError`→404, `ForbiddenError`→403 with `code`, else 500). Only keep an inner try/catch for genuinely non-standard error strings.
- [ ] Dynamic params validated with `parseUuidParam` (returns a ready 400 `Response` on bad input).
- [ ] Authz guard from `lib/authz/access.ts` for **every** KB-scoped resource: `requireKnowledgeBaseAccess`, `requireConversationAccess`, `requireFileAccess`, `requireEvalRunAccess`, `requireWorkspaceRole`. Never query KB-scoped tables by id without a guard — cross-tenant must be indistinguishable from not-found (404).
- [ ] Response envelope via `success(data)` / `error(message)` from `lib/api/response.ts` — shape is `{ requestId, ok, data?, error? }`. Never return bare JSON.
- [ ] Request body validation lives in `lib/validation.ts` (see `parseRetrievalFilter` as the model).
- [ ] DB access goes through a query module in `lib/db/`.
- [ ] No new top-level page routes — API routes under existing `/api/*` namespaces only.

## Verify

`pnpm build` (type-check) and, if the route is user-reachable, exercise it through the UI or a `curl` against `pnpm dev`.
