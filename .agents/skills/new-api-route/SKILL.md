---
name: new-api-route
description: Implement or change authentication, validation, or responses in KnowFlow API handlers.
---

# API handlers

Use nearby handlers and `lib/api/route.ts` as the implementation reference.

- Authenticated JSON business routes use `withAuth`. Public authentication endpoints and streaming handlers retain their established auth flow; streaming handlers still require authentication and scoped access checks.
- Validate UUID route parameters with `parseUuidParam`; return its 400 response on failure. Reuse body validators in `lib/validation.ts` where applicable.
- Guard scoped resources before reading or mutating them using `lib/authz/access.ts`. Cross-tenant access is 404; an authenticated user's insufficient role can be 403. Unauthenticated business requests are 401.
- JSON responses use `success` / `error` from `lib/api/response.ts`. Streaming handlers retain their established SSE protocol and validate access before starting the stream.
- Keep database queries in `lib/db/`. `withAuth` provides the standard error mapping; retain an inner catch only for endpoint-specific behavior.

Verify the changed success and failure paths, especially invalid input and cross-workspace access when those paths change.
