import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatFileNameList } from './format';

test('formatFileNameList shows up to `max` names and counts the rest', () => {
  assert.equal(formatFileNameList([]), '');
  assert.equal(formatFileNameList(['a.png']), 'a.png');
  assert.equal(formatFileNameList(['a.png', 'b.zip', 'c.exe']), 'a.png, b.zip, c.exe');
  assert.equal(formatFileNameList(['a', 'b', 'c', 'd', 'e']), 'a, b, c +2');
  assert.equal(formatFileNameList(['a', 'b'], 1), 'a +1');
});
