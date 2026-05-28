import { createHash } from 'node:crypto';
import type { EvalCase } from '@/lib/types';

/**
 * Stable hash of a dataset. Used to guard against comparing runs across
 * datasets that have silently drifted (cases added/removed/edited).
 *
 * Canonicalizes by sorting keys at every depth so that field order in the
 * source file does not affect the hash.
 */
export function hashDataset(cases: EvalCase[]): string {
  const canonical = canonicalize(cases);
  return createHash('sha1').update(canonical).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map(k => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
  return `{${entries.join(',')}}`;
}
