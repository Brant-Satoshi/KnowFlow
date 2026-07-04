import type { NextRequest } from 'next/server';
import { error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import type { AuthUser } from '@/lib/auth/users';
import { isForbiddenError, isNotFoundOrForbiddenError } from '@/lib/authz/access';
import { isValidUuid } from '@/lib/validation';

/**
 * Standard error tail for business API routes:
 * NotFoundOrForbiddenError → 404, ForbiddenError → 403, anything else → 500
 * with the thrown message (or `fallbackMessage` for non-Error throws).
 */
export function routeErrorResponse(e: unknown, fallbackMessage: string): Response {
  if (isNotFoundOrForbiddenError(e)) {
    return Response.json(error(e.message), { status: 404 });
  }
  if (isForbiddenError(e)) {
    return Response.json(error(e.message, { code: e.code }), { status: 403 });
  }
  console.error(`[api] ${fallbackMessage}:`, e);
  const message = e instanceof Error ? e.message : fallbackMessage;
  return Response.json(error(message), { status: 500 });
}

/**
 * Wraps a business route handler with the auth guard and the standard error
 * tail. Handlers with non-standard catch behavior (fixed error strings,
 * custom error codes) keep their own inner try/catch.
 *
 *   export const GET = withAuth('Failed to ...', async (req, user, ctx) => {...});
 */
export function withAuth<Ctx = unknown>(
  fallbackMessage: string,
  handler: (req: NextRequest, user: AuthUser, ctx: Ctx) => Promise<Response>,
): (req: NextRequest, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    const auth = await requireUser();
    if (auth instanceof Response) return auth;
    try {
      return await handler(req, auth, ctx);
    } catch (e) {
      return routeErrorResponse(e, fallbackMessage);
    }
  };
}

/**
 * Awaits a dynamic route param and validates it as a UUID; returns the value
 * or a ready-to-return 400 `Response` (same convention as `requireUser`).
 *
 *   const id = await parseUuidParam(params, 'id', 'workspace id');
 *   if (id instanceof Response) return id;
 */
export async function parseUuidParam(
  params: Promise<Record<string, string>>,
  key: string,
  label: string,
): Promise<string | Response> {
  const value = (await params)[key];
  if (typeof value !== 'string' || !isValidUuid(value)) {
    return Response.json(error(`Invalid ${label}`), { status: 400 });
  }
  return value;
}
