import { extname } from 'path';
import { FileDoc } from '@/lib/types';
import { readFileFromStorage } from '@/lib/db/storage';
import { replaceFileChunks } from '@/lib/db/chunks';
import { chunkText } from './chunks';
import { parseFile } from './parse';
import { embedChunk } from './embeddings';
import { cleanText } from './text';

// Preserve the existing import surface while the dependency-free leaf module
// lets seed scripts and tests avoid pulling in storage/env dependencies.
export { cleanText } from './text';

type ReindexOptions = { signal?: AbortSignal };

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
