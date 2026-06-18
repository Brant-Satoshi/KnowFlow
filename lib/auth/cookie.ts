/**
 * Edge-safe auth constants. This module is the ONLY auth file that
 * `proxy.ts` (Edge runtime) may import, so it must stay free of any
 * server-only imports — no `pg`, no `next/headers`, no Node built-ins.
 */

export const SESSION_COOKIE = 'rag_session';

/** 30 days, in seconds. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  // localhost is http, so only require Secure in production — otherwise the
  // browser silently drops the cookie during local development.
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_MAX_AGE,
};
