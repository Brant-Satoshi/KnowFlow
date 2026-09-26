import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getUploadExtension,
  isConversationSummaryQuery,
  isSummaryQuery,
  MAX_UPLOAD_BATCH_FILES,
  MAX_UPLOAD_FILE_BYTES,
  triageUploadFiles,
} from './validation';

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
