import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FileDoc } from '../types';
import { hasExtractableText, ParseUserError, parseFile } from './parse';

function file(name: string, type: string): FileDoc {
  return {
    id: 'f1',
    name,
    type,
    size: 10,
    status: 'uploaded',
    createdAt: new Date().toISOString(),
  };
}

async function parseErrorCode(doc: FileDoc, buffer: Buffer): Promise<string> {
  try {
    await parseFile(doc, buffer);
  } catch (e) {
    assert.ok(e instanceof ParseUserError, `expected ParseUserError, got: ${e}`);
    return e.code;
  }
  throw new Error('expected parseFile to reject');
}

test('an unsupported file type is named, not swallowed', async () => {
  const code = await parseErrorCode(
    file('archive.zip', 'application/zip'),
    Buffer.from('PK'),
  );
  assert.equal(code, 'unsupported_type');
});

test('a corrupt PDF reports a PDF problem, not a generic "Parse failed"', async () => {
  const code = await parseErrorCode(
    file('broken.pdf', 'application/pdf'),
    Buffer.from('this is definitely not a pdf'),
  );
  assert.equal(code, 'pdf_parse_failed');
});

test('a corrupt .docx reports a Word problem', async () => {
  const code = await parseErrorCode(
    file(
      'broken.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ),
    Buffer.from('not a zip archive at all'),
  );
  assert.equal(code, 'docx_parse_failed');
});

test('plain text still parses, including GB18030', async () => {
  const utf8 = await parseFile(file('a.txt', 'text/plain'), Buffer.from('hello 世界'));
  assert.equal(utf8, 'hello 世界');
});

test('hasExtractableText rejects what would silently index into nothing', () => {
  // A scanned PDF parses to "" without throwing: this is the check that stops it
  // from being stored as `indexed` and never retrieved.
  assert.equal(hasExtractableText(''), false);
  assert.equal(hasExtractableText('   \n\t  \n '), false);
  assert.equal(hasExtractableText('a'), true);
  assert.equal(hasExtractableText('  实际内容  '), true);
});
