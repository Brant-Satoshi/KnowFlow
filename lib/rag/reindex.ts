import { extname } from 'path';
import { FileDoc } from '@/lib/types';
import { readFileFromStorage } from '@/lib/db/storage';
import { replaceFileChunks } from '@/lib/db/chunks';
import { chunkText } from './chunks';
import { parseFile } from './parse';
import { embedChunk } from './embeddings';

type ReindexOptions = { signal?: AbortSignal };

export function cleanText(text: string): string {
  return text
    // pdf2json emits CRLF around its markers; normalize before the line rules.
    .replace(/\r\n?/g, '\n')
    // pdf2json page-break marker lines ("----------------Page (N) Break----…").
    // Match them exactly — a bare /Page \d+/ also destroys legitimate content.
    .replace(/^-+Page \(\d+\) Break-+$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// buffer → parse → clean → chunk → embed → replace. Shared by the parse route
// and the reembed backfill script. Returns the number of chunks written.
export async function reindexFile(
  file: FileDoc,
  options: ReindexOptions = {},
): Promise<number> {
  const filePath = `${file.id}${extname(file.name)}`;
  const buffer = await readFileFromStorage(filePath);
  const text = cleanText(await parseFile(file, buffer));
  let chunkDocs = chunkText(text, file.id, { fileName: file.name });
  chunkDocs = await embedChunk(chunkDocs, { signal: options.signal });
  await replaceFileChunks(file.id, chunkDocs);
  return chunkDocs.length;
}
