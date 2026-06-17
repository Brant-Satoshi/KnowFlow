import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'crypto';

// Hand-rolled promise wrapper (instead of promisify) so the options overload —
// which carries the N/r/p cost parameters — survives type-checking. Still async,
// so the event loop is not blocked.
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

// scrypt cost parameters. Stored in the hash string so they can be tuned later
// without invalidating existing hashes.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * Hashes a plaintext password. Format:
 *   scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P })) as Buffer;
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/**
 * Verifies a plaintext password against a stored hash in constant time.
 * Parses the cost parameters from the stored string so older hashes keep
 * verifying after the constants above are changed.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const derived = (await scryptAsync(password, salt, expected.length, { N: n, r, p })) as Buffer;

  // Length guard before timingSafeEqual, which throws on mismatched lengths.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
