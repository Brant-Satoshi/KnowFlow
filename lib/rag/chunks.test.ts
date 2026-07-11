import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunkText } from './chunks';

// Dense CJK filler with sentence breaks so boundary snapping has targets.
function cjkFiller(sentences: number, tag: string): string {
  return Array.from({ length: sentences }, (_, i) => `${tag}第${i}句填充内容用于撑长段落。`).join('');
}

const ZH_DOC = [
  '奥林匹斯计划文档',
  '这是标题之后、第一个章节之前的导语部分。导语不属于任何章节。',
  `一、项目概况\n${cjkFiller(20, '概况')}`,
  `二、研究背景\n${cjkFiller(20, '背景')}`,
  `三、结论\n${cjkFiller(3, '结论')}`,
].join('\n');

const OPTS = { chunkSize: 150, overlap: 25 };

function sectionOffsets(text: string): number[] {
  return ['一、项目概况', '二、研究背景', '三、结论'].map((h) => text.indexOf(h));
}

test('empty text yields no chunks', () => {
  assert.deepEqual(chunkText('', 'f1'), []);
});

test('no chunk straddles a section heading', () => {
  const chunks = chunkText(ZH_DOC, 'f1', OPTS);
  const offsets = sectionOffsets(ZH_DOC);

  for (const chunk of chunks) {
    const { start, end } = chunk.meta as { start: number; end: number };
    for (const offset of offsets) {
      assert.ok(
        !(start < offset && offset < end),
        `chunk ${chunk.idx} [${start}, ${end}) straddles heading at ${offset}`,
      );
    }
  }
});

test('every chunk carries the section title of the section containing it', () => {
  const chunks = chunkText(ZH_DOC, 'f1', OPTS);
  const [s1, s2, s3] = sectionOffsets(ZH_DOC);

  for (const chunk of chunks) {
    const { start } = chunk.meta as { start: number };
    const expected =
      start >= s3 ? '三、结论' : start >= s2 ? '二、研究背景' : start >= s1 ? '一、项目概况' : null;
    assert.equal(chunk.sectionTitle, expected, `chunk ${chunk.idx} starting at ${start}`);
    assert.equal(chunk.documentTitle, '奥林匹斯计划文档');
  }

  // All three sections must actually appear, and the preamble stays title-less.
  const titles = new Set(chunks.map((chunk) => chunk.sectionTitle));
  assert.deepEqual(
    titles,
    new Set([null, '一、项目概况', '二、研究背景', '三、结论']),
  );
});

test('each section begins a fresh chunk at its heading, without cross-section overlap', () => {
  const chunks = chunkText(ZH_DOC, 'f1', OPTS);
  const offsets = sectionOffsets(ZH_DOC);

  for (const offset of offsets) {
    const first = chunks.find((chunk) => (chunk.meta as { start: number }).start >= offset);
    assert.ok(first, `no chunk found for section at ${offset}`);
    assert.equal((first.meta as { start: number }).start, offset);
  }
});

test('consecutive chunks within a section overlap; long sections still window', () => {
  const chunks = chunkText(ZH_DOC, 'f1', OPTS);
  const bySection = chunks.filter((chunk) => chunk.sectionTitle === '一、项目概况');

  assert.ok(bySection.length >= 2, 'section 一 should be split into multiple chunks');
  for (const chunk of bySection) {
    assert.ok(chunk.text.length <= OPTS.chunkSize);
  }
  for (let i = 1; i < bySection.length; i += 1) {
    const prev = bySection[i - 1].meta as { end: number };
    const curr = bySection[i].meta as { start: number };
    assert.ok(curr.start < prev.end, `chunks ${i - 1} and ${i} should overlap`);
  }
});

test('mid-section chunk boundaries snap to sentence breaks', () => {
  const chunks = chunkText(ZH_DOC, 'f1', OPTS);
  const bySection = chunks.filter((chunk) => chunk.sectionTitle === '二、研究背景');

  for (const chunk of bySection.slice(0, -1)) {
    assert.match(chunk.text, /[。！？!?.;；]$/, `chunk ${chunk.idx} should end at a sentence break`);
  }
});

test('embeddingText is contextualized with document and section titles', () => {
  const chunks = chunkText(ZH_DOC, 'f1', OPTS);
  const chunk = chunks.find((c) => c.sectionTitle === '二、研究背景');

  assert.ok(chunk);
  assert.ok(chunk.embeddingText?.startsWith('title: 奥林匹斯计划文档\nsection: 二、研究背景\ntext:\n'));

  const preamble = chunks.find((c) => c.sectionTitle === null);
  assert.ok(preamble);
  assert.ok(preamble.embeddingText?.startsWith('title: 奥林匹斯计划文档\ntext:\n'));
});

test('document starting with a CN-numbered heading falls back to file name as title', () => {
  const text = `一、直接开始\n${cjkFiller(4, '内容')}`;
  const chunks = chunkText(text, 'f1', { ...OPTS, fileName: 'report-2026.txt' });

  assert.ok(chunks.length >= 1);
  for (const chunk of chunks) {
    assert.equal(chunk.documentTitle, 'report-2026');
    assert.equal(chunk.sectionTitle, '一、直接开始');
  }
});

test('markdown heading as first line is the document title, not a section', () => {
  const text = `# 总标题\n开头介绍。\n## 小节甲\n${cjkFiller(3, '甲')}\n## 小节乙\n${cjkFiller(3, '乙')}`;
  const chunks = chunkText(text, 'f1', OPTS);

  assert.equal(chunks[0].documentTitle, '总标题');
  assert.equal(chunks[0].sectionTitle, null);
  const titles = new Set(chunks.map((chunk) => chunk.sectionTitle));
  assert.ok(titles.has('## 小节甲'));
  assert.ok(titles.has('## 小节乙'));
});
