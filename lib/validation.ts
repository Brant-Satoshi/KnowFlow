import type { RetrievalFileType, RetrievalFilter } from '@/lib/types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

export const MAX_UPLOAD_FILE_MB = 25;
export const MAX_UPLOAD_FILE_BYTES = MAX_UPLOAD_FILE_MB * 1024 * 1024;

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

const SUMMARY_KEYWORD = /summar(?:y|ize|ise)|总结|概括|归纳/gi;
// Phrases that point at the conversation itself rather than at anything in the
// knowledge base.
const CONVERSATION_REF =
  /conversation|chat|discussion|dialogue|so far|above|对话|聊天|会话|以上|上面|刚才|我们(?:聊|说|讲|谈)/i;
// Politeness and carrier words that add no topic of their own.
const SUMMARY_FILLER_EN = /\b(?:please|can|could|you|give|provide|write|make|do|a|an|the|it|this|that|for|me|us|now|brief|quick|short)\b/gi;
const SUMMARY_FILLER_ZH = /请|帮我|麻烦|一下|这个|那个|吧|呢|啊|的/g;

/**
 * Narrow form of `isSummaryQuery`: a request to recap *the conversation*, which
 * is the only query that may legitimately reach the LLM with zero retrieved
 * chunks (`buildPrompt` answers it from history alone).
 *
 * A topical summary — "summarize what the docs say about X" — must NOT match.
 * It shares the same keywords, but with nothing retrieved it has to be refused;
 * silently turning it into a recap of the chat would answer a question the user
 * never asked, from a source they never named.
 */
export function isConversationSummaryQuery(q: string): boolean {
  const trimmed = q.trim();
  SUMMARY_KEYWORD.lastIndex = 0;
  if (!SUMMARY_KEYWORD.test(trimmed)) return false;

  if (CONVERSATION_REF.test(trimmed)) return true;

  // No explicit reference: it only counts as a conversation recap if nothing
  // substantive is left once the summary keyword and filler words are removed —
  // i.e. the user asked for "a summary" of nothing in particular.
  const residue = trimmed
    .replace(SUMMARY_KEYWORD, ' ')
    .replace(SUMMARY_FILLER_EN, ' ')
    .replace(SUMMARY_FILLER_ZH, ' ')
    .replace(/[\s\p{P}\p{S}]/gu, '');

  return residue.length === 0;
}
