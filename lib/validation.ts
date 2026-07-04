import type { RetrievalFileType, RetrievalFilter } from '@/lib/types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

export const RETRIEVAL_FILE_TYPES: readonly RetrievalFileType[] = ['pdf', 'markdown', 'word', 'text'];
export const MAX_FILTER_FILE_IDS = 50;
export const MAX_TITLE_QUERY_LENGTH = 200;

/**
 * Validate and normalize the optional `filter` field of a retrieval request
 * body. Empty dimensions are dropped; a filter with no active dimension
 * normalizes to `undefined`.
 */
export function parseRetrievalFilter(raw: unknown):
  | { ok: true; filter?: RetrievalFilter }
  | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, filter: undefined };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'filter must be an object' };
  }
  const { fileIds, fileTypes, titleQuery } = raw as Record<string, unknown>;
  const filter: RetrievalFilter = {};

  if (fileIds !== undefined && fileIds !== null) {
    if (!Array.isArray(fileIds) || fileIds.some(id => typeof id !== 'string' || !isValidUuid(id))) {
      return { ok: false, error: 'filter.fileIds must be an array of UUIDs' };
    }
    if (fileIds.length > MAX_FILTER_FILE_IDS) {
      return { ok: false, error: `filter.fileIds must contain at most ${MAX_FILTER_FILE_IDS} ids` };
    }
    const deduped = [...new Set(fileIds as string[])];
    if (deduped.length > 0) filter.fileIds = deduped;
  }

  if (fileTypes !== undefined && fileTypes !== null) {
    if (
      !Array.isArray(fileTypes) ||
      fileTypes.some(t => !RETRIEVAL_FILE_TYPES.includes(t as RetrievalFileType))
    ) {
      return { ok: false, error: `filter.fileTypes entries must be one of: ${RETRIEVAL_FILE_TYPES.join(', ')}` };
    }
    const deduped = [...new Set(fileTypes as RetrievalFileType[])];
    if (deduped.length > 0) filter.fileTypes = deduped;
  }

  if (titleQuery !== undefined && titleQuery !== null) {
    if (typeof titleQuery !== 'string') {
      return { ok: false, error: 'filter.titleQuery must be a string' };
    }
    const trimmed = titleQuery.trim();
    if (trimmed.length > MAX_TITLE_QUERY_LENGTH) {
      return { ok: false, error: `filter.titleQuery must be at most ${MAX_TITLE_QUERY_LENGTH} characters` };
    }
    if (trimmed.length > 0) filter.titleQuery = trimmed;
  }

  if (!filter.fileIds && !filter.fileTypes && !filter.titleQuery) {
    return { ok: true, filter: undefined };
  }
  return { ok: true, filter };
}

export function isSummaryQuery(q: string) {
  return /summary|summarize|总结|概括/i.test(q)
}
