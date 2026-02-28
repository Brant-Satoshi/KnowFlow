import { promises as fs } from 'fs';
import { join } from 'path';
import { Chunk } from '@/lib/types';

const DB_DIR = join(process.cwd(), 'data');
const CHUNKS_DB = join(DB_DIR, 'chunks.json');

async function ensureDbDir() {
  try {
    await fs.mkdir(DB_DIR, { recursive: true });
  } catch {
    // dir exists
  }
}

async function readChunksDb(): Promise<Chunk[]> {
  try {
    await ensureDbDir();
    const data = await fs.readFile(CHUNKS_DB, 'utf-8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeChunksDb(chunks: Chunk[]): Promise<void> {
  await ensureDbDir();
  await fs.writeFile(CHUNKS_DB, JSON.stringify(chunks, null, 2));
}

export async function getChunks(fileId?: string): Promise<Chunk[]> {
  const chunks = await readChunksDb();
  if (!fileId) {
    return chunks;
  }
  return chunks.filter((chunk) => chunk.fileId === fileId);
}

export async function replaceFileChunks(
  fileId: string,
  nextChunks: Chunk[],
): Promise<void> {
  const chunks = await readChunksDb();
  const remaining = chunks.filter((chunk) => chunk.fileId !== fileId);
  await writeChunksDb([...remaining, ...nextChunks]);
}

export async function deleteChunksByFileId(fileId: string): Promise<number> {
  const chunks = await readChunksDb();
  const remaining = chunks.filter((chunk) => chunk.fileId !== fileId);
  const deletedCount = chunks.length - remaining.length;
  await writeChunksDb(remaining);
  return deletedCount;
}
