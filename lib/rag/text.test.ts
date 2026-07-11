import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanText } from './text';

test('normalizes CRLF, repeated blank lines, and horizontal whitespace', () => {
  assert.equal(cleanText('Title\r\n\r\nBody\t  text\rTail'), 'Title\nBody text\nTail');
});

test('removes exact pdf2json page-break marker lines', () => {
  assert.equal(
    cleanText('Before\r\n----------------Page (5) Break----------------\r\nAfter'),
    'Before\nAfter',
  );
});

test('preserves legitimate Page-number prose', () => {
  assert.equal(
    cleanText('Page 5 explains the rollout.\nSee Page 12 for details.'),
    'Page 5 explains the rollout.\nSee Page 12 for details.',
  );
});
