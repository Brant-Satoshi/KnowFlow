/** Build the fixed 100-question CMRC 2018 evaluation fixture. */
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chunkText } from '@/lib/rag/chunks';
import { cleanText } from '@/lib/rag/text';
import type { EvalCase } from '@/lib/types';

const SOURCE_COMMIT = 'c0eb1b6ba219847457e6af3180da722bbeb656af';
const SOURCE_URL = `https://raw.githubusercontent.com/ymcui/cmrc2018/${SOURCE_COMMIT}/data/cmrc2018_dev.json`;
const SOURCE_SHA256 = '5cfe4414c28a8ecbb51670f78c0dc7d1049f286c2d5769b52f1f94bcc0752cf1';
const CASE_COUNT = 100;
const QUESTIONS_PER_DOCUMENT = 4;
const TARGET_DOCUMENTS = CASE_COUNT / QUESTIONS_PER_DOCUMENT;
// Spot checks found contradictory or corrupted answers in these source rows.
const EXCLUDED_QUESTION_IDS = new Set(['DEV_18_QUERY_3', 'DEV_62_QUERY_3']);
const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures');
const CASES_PATH = join(process.cwd(), 'lib', 'eval', 'cmrc2018-mini.json');

interface CmrcQuestion {
  query_id: string;
  query_text: string;
  answers: unknown[];
}

interface CmrcContext {
  context_id: string;
  context_text: string;
  qas: CmrcQuestion[];
  title: string;
}

interface GeneratedDocument {
  name: string;
  content: string;
}

function sourceArgument(): string | undefined {
  return process.argv.slice(2).find(arg => arg.startsWith('--source='))?.slice('--source='.length);
}

async function loadSource(): Promise<CmrcContext[]> {
  const localPath = sourceArgument();
  let bytes: Buffer;
  if (localPath) {
    bytes = await readFile(localPath);
  } else {
    const response = await fetch(SOURCE_URL);
    if (!response.ok) throw new Error(`CMRC download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== SOURCE_SHA256) {
    throw new Error(`CMRC source hash mismatch: expected ${SOURCE_SHA256}, got ${digest}`);
  }
  const parsed: unknown = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(parsed)) throw new Error('Expected CMRC development set array');
  return parsed as CmrcContext[];
}

function canonicalAnswer(answers: unknown[]): string | null {
  const counts = new Map<string, number>();
  for (const raw of answers) {
    if (typeof raw !== 'string') continue;
    const answer = raw.trim();
    if (answer) counts.set(answer, (counts.get(answer) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function evidenceInChunk(text: string, answer: string): string | null {
  const offset = text.indexOf(answer);
  if (offset < 0) return null;
  const start = Math.max(0, offset - 18);
  const end = Math.min(text.length, offset + answer.length + 18);
  const evidence = text.slice(start, end).trim();
  return evidence.length >= 20 ? evidence : null;
}

function answerKeywords(answer: string): string[] {
  const clauses = answer
    .replace(/[。！？.!?]+$/, '')
    .split(/[，,、；;]+/)
    .map(part => part.trim())
    .filter(part => part.length >= 3);
  const keywords = clauses.length > 1
    ? clauses.map(part => part.slice(0, 16))
    : answer.length <= 16
      ? [answer]
      : [answer.slice(0, 10), answer.slice(-10)];
  return [...new Set(keywords)];
}

function candidates(row: CmrcContext): { document: GeneratedDocument; cases: EvalCase[] } | null {
  const title = row.title?.replace(/[《》「」\s]/g, '');
  if (!title || title.length < 3 || title.length > 35) return null;
  const name = `cmrc2018-${row.context_id.toLowerCase().replaceAll('_', '-')}.txt`;
  const content = `${cleanText(`${row.title}\n${row.context_text}`)}\n`;
  const chunks = chunkText(cleanText(content), row.context_id, { fileName: name });
  const seenAnswers = new Set<string>();
  const cases: EvalCase[] = [];

  for (const question of row.qas) {
    if (EXCLUDED_QUESTION_IDS.has(question.query_id)) continue;
    const answer = canonicalAnswer(question.answers);
    if (!answer || answer.length < 3 || answer.length > 50) continue;
    if (!content.includes(answer) || question.query_text.includes(answer)) continue;
    // Keep questions whose subject is explicit when read without the passage.
    if (!question.query_text.replace(/[《》「」\s]/g, '').includes(title)) continue;
    if (seenAnswers.has(answer)) continue;
    const evidence = chunks.map(chunk => evidenceInChunk(chunk.text, answer)).find(Boolean);
    if (!evidence) continue;
    seenAnswers.add(answer);
    cases.push({
      id: `cmrc2018-${question.query_id.toLowerCase().replaceAll('_', '-')}`,
      question: question.query_text,
      expectedAnswer: answer,
      expectedKeywords: answerKeywords(answer),
      category: /多少|哪年|哪一年|什么时候|何时|第几|几岁|多大|百分之/.test(question.query_text)
        ? 'numeric_fact'
        : /哪些|哪几|有哪|都有|分别/.test(question.query_text)
          ? 'list_extraction'
          : 'single_fact',
      difficulty: 'medium',
      targetFileNames: [name],
      targetChunkSubstrings: [evidence],
      notes: `CMRC 2018 development set: ${row.context_id}, ${question.query_id}.`,
    });
    if (cases.length === QUESTIONS_PER_DOCUMENT) break;
  }
  return cases.length === QUESTIONS_PER_DOCUMENT
    ? { document: { name, content }, cases }
    : null;
}

function generate(rows: CmrcContext[]): { documents: GeneratedDocument[]; cases: EvalCase[] } {
  const documents: GeneratedDocument[] = [];
  const cases: EvalCase[] = [];
  for (const row of rows) {
    const selected = candidates(row);
    if (!selected) continue;
    documents.push(selected.document);
    cases.push(...selected.cases);
    if (documents.length === TARGET_DOCUMENTS) break;
  }
  if (cases.length !== CASE_COUNT) throw new Error(`Only found ${cases.length} eligible questions`);

  // Grade 3 ignores the file name, so an evidence string must identify only
  // its own document across the entire selected corpus.
  for (const item of cases) {
    const evidence = item.targetChunkSubstrings?.[0];
    const ownFile = item.targetFileNames?.[0];
    if (!evidence || !ownFile) throw new Error(`Missing evidence for ${item.id}`);
    for (const document of documents) {
      if (document.name !== ownFile && document.content.includes(evidence)) {
        throw new Error(`Evidence for ${item.id} also appears in ${document.name}`);
      }
    }
  }
  return { documents, cases };
}

async function writeOrCheck(path: string, content: string, check: boolean): Promise<void> {
  if (check) {
    if (await readFile(path, 'utf8') !== content) throw new Error(`Generated file differs: ${path}`);
  } else {
    await writeFile(path, content, 'utf8');
  }
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const { documents, cases } = generate(await loadSource());
  if (check) {
    const selected = new Set(documents.map(document => document.name));
    const extra = (await readdir(FIXTURE_DIR)).filter(name =>
      name.startsWith('cmrc2018-dev-') && name.endsWith('.txt') && !selected.has(name),
    );
    if (extra.length) throw new Error(`Unexpected CMRC fixtures: ${extra.join(', ')}`);
  }
  for (const document of documents) {
    await writeOrCheck(join(FIXTURE_DIR, document.name), document.content, check);
  }
  await writeOrCheck(CASES_PATH, `${JSON.stringify(cases, null, 2)}\n`, check);
  console.log(`${check ? 'Verified' : 'Generated'} ${cases.length} CMRC questions and ${documents.length} source documents.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
