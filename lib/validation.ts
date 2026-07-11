import type {
  EvalCase,
  EvalCaseCategory,
  EvalCaseDifficulty,
  RetrievalFileType,
  RetrievalFilter,
} from '@/lib/types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

export const MAX_UPLOAD_FILE_MB = 25;
export const MAX_UPLOAD_FILE_BYTES = MAX_UPLOAD_FILE_MB * 1024 * 1024;

export const RETRIEVAL_FILE_TYPES: readonly RetrievalFileType[] = ['pdf', 'markdown', 'word', 'text'];
export const MAX_FILTER_FILE_IDS = 50;
export const MAX_TITLE_QUERY_LENGTH = 200;

/** Hard cap on cases per managed goldset — enforced on create, single add, and batch import. */
export const MAX_GOLDSET_CASES = 50;

export const EVAL_CASE_CATEGORIES: readonly EvalCaseCategory[] = [
  'single_fact',
  'numeric_fact',
  'list_extraction',
  'synthesis',
  'disambiguation',
  'out_of_scope',
];

export const EVAL_CASE_DIFFICULTIES: readonly EvalCaseDifficulty[] = ['easy', 'medium', 'hard'];

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

/* ────────────────────────────────────────────────────────────────────────────
 * Managed eval dataset body parsers. All dataset/case write bodies except
 * dataset creation carry `expectedDatasetHash` for optimistic concurrency.
 * `EvalCase.id` here is the business case_key — row UUIDs never appear in
 * these bodies (they live in the URL, validated by parseUuidParam).
 * ──────────────────────────────────────────────────────────────────────────── */

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * String-array field: entries must be strings; whitespace-only entries are
 * dropped. `trim` is off for chunk substrings — they are matched
 * case-sensitively and verbatim against chunk text.
 */
function parseStringArray(
  raw: unknown,
  field: string,
  opts: { trim: boolean },
): Parsed<string[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw) || raw.some(v => typeof v !== 'string')) {
    return { ok: false, error: `${field} must be an array of strings` };
  }
  const value = (raw as string[])
    .map(v => (opts.trim ? v.trim() : v))
    .filter(v => v.trim().length > 0);
  return { ok: true, value };
}

/** Optional free-text field; whitespace-only collapses to undefined. */
function parseOptionalText(raw: unknown, field: string): Parsed<string | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (typeof raw !== 'string') return { ok: false, error: `${field} must be a string` };
  const trimmed = raw.trim();
  return { ok: true, value: trimmed.length > 0 ? trimmed : undefined };
}

/** One EvalCase in the JSON import shape (also the manual-form shape). */
export function parseEvalCaseInput(raw: unknown): Parsed<EvalCase> {
  if (!isRecord(raw)) return { ok: false, error: 'case must be an object' };

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) return { ok: false, error: 'case.id is required' };

  const question = typeof raw.question === 'string' ? raw.question.trim() : '';
  if (!question) return { ok: false, error: 'case.question is required' };

  const category = raw.category;
  if (!EVAL_CASE_CATEGORIES.includes(category as EvalCaseCategory)) {
    return { ok: false, error: `case.category must be one of: ${EVAL_CASE_CATEGORIES.join(', ')}` };
  }
  const difficulty = raw.difficulty;
  if (!EVAL_CASE_DIFFICULTIES.includes(difficulty as EvalCaseDifficulty)) {
    return { ok: false, error: `case.difficulty must be one of: ${EVAL_CASE_DIFFICULTIES.join(', ')}` };
  }

  const keywords = parseStringArray(raw.expectedKeywords, 'case.expectedKeywords', { trim: true });
  if (!keywords.ok) return keywords;
  const fileNames = parseStringArray(raw.targetFileNames, 'case.targetFileNames', { trim: true });
  if (!fileNames.ok) return fileNames;
  const substrings = parseStringArray(raw.targetChunkSubstrings, 'case.targetChunkSubstrings', { trim: false });
  if (!substrings.ok) return substrings;
  const expectedAnswer = parseOptionalText(raw.expectedAnswer, 'case.expectedAnswer');
  if (!expectedAnswer.ok) return expectedAnswer;
  const notes = parseOptionalText(raw.notes, 'case.notes');
  if (!notes.ok) return notes;

  const value: EvalCase = {
    id,
    question,
    expectedKeywords: keywords.value,
    category: category as EvalCaseCategory,
    difficulty: difficulty as EvalCaseDifficulty,
    targetFileNames: fileNames.value,
    targetChunkSubstrings: substrings.value,
  };
  if (expectedAnswer.value !== undefined) value.expectedAnswer = expectedAnswer.value;
  if (notes.value !== undefined) value.notes = notes.value;
  return { ok: true, value };
}

/** Object → single-element list; array → batch. An empty array is invalid. */
function parseCaseList(raw: unknown, field: string): Parsed<EvalCase[]> {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return { ok: false, error: `${field} must not be empty` };
    const cases: EvalCase[] = [];
    for (const entry of raw) {
      const parsed = parseEvalCaseInput(entry);
      if (!parsed.ok) return parsed;
      cases.push(parsed.value);
    }
    return { ok: true, value: cases };
  }
  const single = parseEvalCaseInput(raw);
  if (!single.ok) return single;
  return { ok: true, value: [single.value] };
}

function parseRequiredHash(raw: unknown): Parsed<string> {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, error: 'expectedDatasetHash is required' };
  }
  return { ok: true, value: raw };
}

export function parseCreateEvalDatasetBody(raw: unknown): Parsed<{
  name: string;
  description?: string;
  cases: EvalCase[];
}> {
  if (!isRecord(raw)) return { ok: false, error: 'body must be an object' };
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return { ok: false, error: 'name is required' };
  const description = parseOptionalText(raw.description, 'description');
  if (!description.ok) return description;

  let cases: EvalCase[] = [];
  if (raw.cases !== undefined && raw.cases !== null) {
    const parsed = parseCaseList(raw.cases, 'cases');
    if (!parsed.ok) return parsed;
    cases = parsed.value;
  }
  return { ok: true, value: { name, description: description.value, cases } };
}

export function parseUpdateEvalDatasetBody(raw: unknown): Parsed<{
  name?: string;
  description?: string | null;
  expectedDatasetHash: string;
}> {
  if (!isRecord(raw)) return { ok: false, error: 'body must be an object' };
  const hash = parseRequiredHash(raw.expectedDatasetHash);
  if (!hash.ok) return hash;

  const value: { name?: string; description?: string | null; expectedDatasetHash: string } = {
    expectedDatasetHash: hash.value,
  };
  if (raw.name !== undefined) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) return { ok: false, error: 'name must be a non-empty string' };
    value.name = name;
  }
  if (raw.description !== undefined) {
    const description = parseOptionalText(raw.description, 'description');
    if (!description.ok) return description;
    value.description = description.value ?? null;
  }
  if (value.name === undefined && value.description === undefined) {
    return { ok: false, error: 'nothing to update' };
  }
  return { ok: true, value };
}

/** POST /api/eval/datasets/[id]/cases — `cases` object = single add, array = batch import. */
export function parseAddEvalCasesBody(raw: unknown): Parsed<{
  cases: EvalCase[];
  expectedDatasetHash: string;
}> {
  if (!isRecord(raw)) return { ok: false, error: 'body must be an object' };
  const hash = parseRequiredHash(raw.expectedDatasetHash);
  if (!hash.ok) return hash;
  const cases = parseCaseList(raw.cases, 'cases');
  if (!cases.ok) return cases;
  return { ok: true, value: { cases: cases.value, expectedDatasetHash: hash.value } };
}

export function parseUpdateEvalCaseBody(raw: unknown): Parsed<{
  case: EvalCase;
  expectedDatasetHash: string;
}> {
  if (!isRecord(raw)) return { ok: false, error: 'body must be an object' };
  const hash = parseRequiredHash(raw.expectedDatasetHash);
  if (!hash.ok) return hash;
  const parsed = parseEvalCaseInput(raw.case);
  if (!parsed.ok) return parsed;
  return { ok: true, value: { case: parsed.value, expectedDatasetHash: hash.value } };
}

/** DELETE bodies carry only the concurrency token. */
export function parseExpectedDatasetHashBody(raw: unknown): Parsed<{ expectedDatasetHash: string }> {
  if (!isRecord(raw)) return { ok: false, error: 'body must be an object' };
  const hash = parseRequiredHash(raw.expectedDatasetHash);
  if (!hash.ok) return hash;
  return { ok: true, value: { expectedDatasetHash: hash.value } };
}

export function parseEvalRunBody(raw: unknown): Parsed<{
  knowledgeBaseId: string;
  datasetId: string;
  useRerank: boolean;
  filter?: RetrievalFilter;
}> {
  if (!isRecord(raw)) return { ok: false, error: 'body must be an object' };
  const { knowledgeBaseId, datasetId } = raw;
  if (typeof knowledgeBaseId !== 'string' || !isValidUuid(knowledgeBaseId)) {
    return { ok: false, error: 'knowledgeBaseId must be a UUID' };
  }
  if (raw.mode !== 'curated') {
    return { ok: false, error: "mode must be 'curated'" };
  }
  if (typeof datasetId !== 'string' || !isValidUuid(datasetId)) {
    return { ok: false, error: 'datasetId must be a UUID' };
  }
  const filter = parseRetrievalFilter(raw.filter);
  if (!filter.ok) return filter;
  return {
    ok: true,
    value: {
      knowledgeBaseId,
      datasetId,
      useRerank: raw.useRerank !== false,
      filter: filter.filter,
    },
  };
}

export function parseEvalValidateBody(raw: unknown): Parsed<{
  datasetId: string;
  knowledgeBaseId: string;
  filter?: RetrievalFilter;
}> {
  if (!isRecord(raw)) return { ok: false, error: 'body must be an object' };
  const { knowledgeBaseId, datasetId } = raw;
  if (typeof knowledgeBaseId !== 'string' || !isValidUuid(knowledgeBaseId)) {
    return { ok: false, error: 'knowledgeBaseId must be a UUID' };
  }
  if (typeof datasetId !== 'string' || !isValidUuid(datasetId)) {
    return { ok: false, error: 'datasetId must be a UUID' };
  }
  const filter = parseRetrievalFilter(raw.filter);
  if (!filter.ok) return filter;
  return { ok: true, value: { datasetId, knowledgeBaseId, filter: filter.filter } };
}
