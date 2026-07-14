import { extname } from 'path';
import { FileDoc } from '@/lib/types';
import { readFileFromStorage } from '@/lib/db/storage';
import { replaceFileChunks } from '@/lib/db/chunks';
import { chunkText } from './chunks';
import { hasExtractableText, ParseUserError, parseFile } from './parse';
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

  // A scanned PDF parses to "" without throwing. Left alone it would be chunked
  // into nothing and stored as `indexed` — a file that sits in the list looking
  // ready and can never be retrieved. Fail it instead, and say why.
  if (!hasExtractableText(text)) {
    throw new ParseUserError(
      'No text could be extracted from this file. If it is a scan or images, it needs OCR first.',
      'no_text_extracted',
    );
  }

  let chunkDocs = chunkText(text, file.id, { fileName: file.name });
  if (chunkDocs.length === 0) {
    throw new ParseUserError(
      'No text could be extracted from this file. If it is a scan or images, it needs OCR first.',
      'no_text_extracted',
    );
  }

  chunkDocs = await embedChunk(chunkDocs, { signal: options.signal });
  await replaceFileChunks(file.id, chunkDocs);
  return chunkDocs.length;
}
