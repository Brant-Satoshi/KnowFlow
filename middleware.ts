import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/cookie';

/**
 * Edge middleware — page-level navigation gate only. It checks for the presence
 * of the session cookie; it does NOT validate it against the database (the DB
 * pool is Node-only and unavailable on the Edge runtime). Real authorization
 * happens in each business API route via `requireUser()`, which verifies the
 * session row. Anyone holding a revoked-but-present cookie can reach a page
 * shell, but every data call it makes returns 401.
 *
 * Only `lib/auth/cookie.ts` (pure constants) may be imported here.
 */
const PUBLIC_PATHS = ['/login', '/register'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  const isPublic = PUBLIC_PATHS.includes(pathname);

  if (!hasSession && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  if (hasSession && isPublic) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Exclude /api (routes self-guard with 401 JSON), Next internals, and static assets.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|robots.txt).*)'],
};
