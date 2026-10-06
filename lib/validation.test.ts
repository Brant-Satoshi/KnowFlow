import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getUploadExtension,
  isConversationSummaryQuery,
  isSummaryQuery,
  MAX_UPLOAD_BATCH_FILES,
  MAX_UPLOAD_FILE_BYTES,
  parseAddEvalCasesBody,
  parseCreateEvalDatasetBody,
  parseEvalCaseInput,
  parseEvalRunBody,
  parseEvalValidateBody,
  parseExpectedRevisionBody,
  parseUpdateEvalCaseBody,
  parseUpdateEvalDatasetBody,
  triageUploadFiles,
} from './validation';

const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = '550e8400-e29b-41d4-a716-446655440001';

const validCase = {
  id: ' case-1 ',
  question: ' Who leads it? ',
  expectedKeywords: [' kovacs ', '', '  '],
  category: 'single_fact',
  difficulty: 'easy',
  targetFileNames: [' sample.txt '],
  targetChunkSubstrings: [' Dr. Elena Kovacs ', '   '],
  expectedAnswer: 'Dr. Elena Kovacs.',
  notes: '',
};

test('parseEvalCaseInput normalizes: trims id/question/keywords/fileNames, preserves substrings verbatim', () => {
  const parsed = parseEvalCaseInput(validCase);
  assert.ok(parsed.ok);
  assert.equal(parsed.value.id, 'case-1');
  assert.equal(parsed.value.question, 'Who leads it?');
  assert.deepEqual(parsed.value.expectedKeywords, ['kovacs']);
  assert.deepEqual(parsed.value.targetFileNames, ['sample.txt']);
  // substrings are matched case-sensitively and verbatim — not trimmed,
  // but whitespace-only entries are dropped
  assert.deepEqual(parsed.value.targetChunkSubstrings, [' Dr. Elena Kovacs ']);
  assert.equal(parsed.value.expectedAnswer, 'Dr. Elena Kovacs.');
  assert.equal('notes' in parsed.value, false);
});

test('parseEvalCaseInput rejects missing required fields and bad enums', () => {
  assert.equal(parseEvalCaseInput({ ...validCase, id: '  ' }).ok, false);
  assert.equal(parseEvalCaseInput({ ...validCase, question: undefined }).ok, false);
  assert.equal(parseEvalCaseInput({ ...validCase, category: 'bogus' }).ok, false);
  assert.equal(parseEvalCaseInput({ ...validCase, difficulty: 'extreme' }).ok, false);
  assert.equal(parseEvalCaseInput({ ...validCase, expectedKeywords: 'kovacs' }).ok, false);
  assert.equal(parseEvalCaseInput('not-an-object').ok, false);
  assert.equal(parseEvalCaseInput([validCase]).ok, false);
});

test('parseAddEvalCasesBody: object = single, array = batch, empty array invalid, revision required', () => {
  const single = parseAddEvalCasesBody({ expectedRevision: 3, cases: validCase });
  assert.ok(single.ok);
  assert.equal(single.value.cases.length, 1);
  assert.equal(single.value.expectedRevision, 3);

  const batch = parseAddEvalCasesBody({
    expectedRevision: 0,
    cases: [validCase, { ...validCase, id: 'case-2' }],
  });
  assert.ok(batch.ok);
  assert.equal(batch.value.cases.length, 2);

  assert.equal(parseAddEvalCasesBody({ expectedRevision: 1, cases: [] }).ok, false);
  assert.equal(parseAddEvalCasesBody({ cases: validCase }).ok, false);
  assert.equal(parseAddEvalCasesBody({ expectedRevision: -1, cases: validCase }).ok, false);
  assert.equal(parseAddEvalCasesBody({ expectedRevision: 1.5, cases: validCase }).ok, false);
  assert.equal(parseAddEvalCasesBody({ expectedRevision: '1', cases: validCase }).ok, false);
});

test('parseCreateEvalDatasetBody: name required, cases optional (object or array)', () => {
  const bare = parseCreateEvalDatasetBody({ name: ' My Goldset ', description: '  ' });
  assert.ok(bare.ok);
  assert.equal(bare.value.name, 'My Goldset');
  assert.equal(bare.value.description, undefined);
  assert.deepEqual(bare.value.cases, []);

  const withCases = parseCreateEvalDatasetBody({ name: 'g', cases: validCase });
  assert.ok(withCases.ok);
  assert.equal(withCases.value.cases.length, 1);

  assert.equal(parseCreateEvalDatasetBody({ name: '   ' }).ok, false);
  assert.equal(parseCreateEvalDatasetBody({}).ok, false);
  assert.equal(parseCreateEvalDatasetBody({ name: 'g', cases: [] }).ok, false);
});

test('parseUpdateEvalDatasetBody: revision + at least one field; empty description clears to null', () => {
  const rename = parseUpdateEvalDatasetBody({ expectedRevision: 2, name: ' New ' });
  assert.ok(rename.ok);
  assert.equal(rename.value.name, 'New');
  assert.equal(rename.value.expectedRevision, 2);

  const clearDesc = parseUpdateEvalDatasetBody({ expectedRevision: 2, description: '' });
  assert.ok(clearDesc.ok);
  assert.equal(clearDesc.value.description, null);

  assert.equal(parseUpdateEvalDatasetBody({ expectedRevision: 2 }).ok, false);
  assert.equal(parseUpdateEvalDatasetBody({ name: 'x' }).ok, false);
  assert.equal(parseUpdateEvalDatasetBody({ expectedRevision: 2, name: '' }).ok, false);
});

test('parseUpdateEvalCaseBody and parseExpectedRevisionBody require their pieces', () => {
  const ok = parseUpdateEvalCaseBody({ expectedRevision: 4, case: validCase });
  assert.ok(ok.ok);
  assert.equal(ok.value.case.id, 'case-1');
  assert.equal(parseUpdateEvalCaseBody({ expectedRevision: 4 }).ok, false);
  assert.equal(parseUpdateEvalCaseBody({ case: validCase }).ok, false);

  assert.ok(parseExpectedRevisionBody({ expectedRevision: 0 }).ok);
  assert.equal(parseExpectedRevisionBody({}).ok, false);
  assert.equal(parseExpectedRevisionBody(null).ok, false);
  assert.equal(parseExpectedRevisionBody({ expectedRevision: 'abc' }).ok, false);
});

test('parseEvalRunBody: requires curated mode and UUID ids; useRerank defaults on', () => {
  const parsed = parseEvalRunBody({
    knowledgeBaseId: UUID_A,
    datasetId: UUID_B,
    mode: 'curated',
  });
  assert.ok(parsed.ok);
  assert.equal(parsed.value.useRerank, true);
  assert.equal(parsed.value.filter, undefined);

  const noRerank = parseEvalRunBody({
    knowledgeBaseId: UUID_A,
    datasetId: UUID_B,
    mode: 'curated',
    useRerank: false,
    filter: { fileIds: [UUID_A] },
  });
  assert.ok(noRerank.ok);
  assert.equal(noRerank.value.useRerank, false);
  assert.deepEqual(noRerank.value.filter, { fileIds: [UUID_A] });

  assert.equal(parseEvalRunBody({ datasetId: UUID_B, mode: 'curated' }).ok, false);
  assert.equal(parseEvalRunBody({ knowledgeBaseId: 'nope', datasetId: UUID_B, mode: 'curated' }).ok, false);
  assert.equal(parseEvalRunBody({ knowledgeBaseId: UUID_A, datasetId: 'nope', mode: 'curated' }).ok, false);
  assert.equal(parseEvalRunBody({ knowledgeBaseId: UUID_A, datasetId: UUID_B }).ok, false);
  assert.equal(parseEvalRunBody({ knowledgeBaseId: UUID_A, datasetId: UUID_B, mode: 'bogus' }).ok, false);
  assert.equal(
    parseEvalRunBody({ knowledgeBaseId: UUID_A, datasetId: UUID_B, mode: 'curated', filter: 'x' }).ok,
    false,
  );
});

test('parseEvalValidateBody mirrors the run body minus mode/rerank', () => {
  const parsed = parseEvalValidateBody({ knowledgeBaseId: UUID_A, datasetId: UUID_B });
  assert.ok(parsed.ok);
  assert.equal(parsed.value.datasetId, UUID_B);

  assert.equal(parseEvalValidateBody({ knowledgeBaseId: UUID_A }).ok, false);
  assert.equal(parseEvalValidateBody({ knowledgeBaseId: UUID_A, datasetId: 'nope' }).ok, false);
});

// A conversation recap is the only query allowed to reach the LLM with zero
// retrieved chunks. Anything that names a topic must stay subject to the refusal
// gate, or "summarize what the docs say about X" quietly becomes a recap of the
// chat when the KB has nothing on X.

test('a bare summary request is a conversation recap', () => {
  for (const q of [
    '总结一下',
    '总结',
    'summarize',
    'Summarize.',
    'Give me a summary',
    'Can you summarize this?',
    '请帮我总结一下',
  ]) {
    assert.equal(isConversationSummaryQuery(q), true, q);
  }
});

test('an explicit reference to the conversation is a recap', () => {
  for (const q of [
    'summarize this conversation',
    'Summarize the discussion so far',
    '总结一下我们刚才聊的',
    '概括一下以上对话',
  ]) {
    assert.equal(isConversationSummaryQuery(q), true, q);
  }
});

test('a topical summary is NOT a conversation recap', () => {
  for (const q of [
    'Summarize information about Olympus',
    'Summarize the report',
    'Write a summary of the budget section',
    '总结一下知识库里关于奥林匹斯的内容',
    '概括这份文档的要点',
  ]) {
    assert.equal(isConversationSummaryQuery(q), false, q);
  }
});

test('a question with no summary keyword is never a recap', () => {
  assert.equal(isConversationSummaryQuery('who is the lead researcher?'), false);
  assert.equal(isConversationSummaryQuery('首席研究员是谁？'), false);
});

test('isSummaryQuery stays loose — it only picks the prompt when chunks exist', () => {
  assert.equal(isSummaryQuery('Summarize information about Olympus'), true);
  assert.equal(isSummaryQuery('总结一下'), true);
  assert.equal(isSummaryQuery('who is the lead researcher?'), false);
});

// Batch upload pre-check. It must agree with the upload route (which uses the
// same helpers), so a file it lets through is never rejected for type or size.

const file = (name: string, size = 1024) => ({ name, size });

test('getUploadExtension is lower-cased, keeps the dot, and is empty without one', () => {
  assert.equal(getUploadExtension('Report.PDF'), '.pdf');
  assert.equal(getUploadExtension('archive.tar.gz'), '.gz');
  assert.equal(getUploadExtension('README'), '');
});

test('triage accepts supported extensions regardless of case', () => {
  const result = triageUploadFiles([file('a.md'), file('b.TXT'), file('c.Pdf'), file('d.doc'), file('e.DOCX')]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.accepted.map((f) => f.name), ['a.md', 'b.TXT', 'c.Pdf', 'd.doc', 'e.DOCX']);
  assert.deepEqual(result.rejected, []);
});

test('triage rejects unsupported types and extensionless names without dropping the rest', () => {
  const result = triageUploadFiles([file('photo.png'), file('notes.md'), file('README')]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.accepted.map((f) => f.name), ['notes.md']);
  assert.deepEqual(result.rejected, [
    { name: 'photo.png', reason: 'unsupported_type' },
    { name: 'README', reason: 'unsupported_type' },
  ]);
});

test('triage enforces the per-file size limit at the exact boundary', () => {
  const result = triageUploadFiles([
    file('at-limit.pdf', MAX_UPLOAD_FILE_BYTES),
    file('over-limit.pdf', MAX_UPLOAD_FILE_BYTES + 1),
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.accepted.map((f) => f.name), ['at-limit.pdf']);
  assert.deepEqual(result.rejected, [{ name: 'over-limit.pdf', reason: 'too_large' }]);
});

test('triage refuses a batch over the cap, counting accepted files only', () => {
  const valid = (n: number) => Array.from({ length: n }, (_, i) => file(`doc-${i}.md`));

  const atCap = triageUploadFiles([...valid(MAX_UPLOAD_BATCH_FILES), file('x.png'), file('y.zip')]);
  assert.equal(atCap.ok, true, 'rejected files must not count toward the cap');

  const overCap = triageUploadFiles(valid(MAX_UPLOAD_BATCH_FILES + 1));
  assert.deepEqual(overCap, { ok: false, reason: 'too_many', count: MAX_UPLOAD_BATCH_FILES + 1 });
});
