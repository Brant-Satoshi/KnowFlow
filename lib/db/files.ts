import { promises as fs } from 'fs';
import { join } from 'path';
import { FileDoc } from '@/lib/types';
import { deleteChunksByFileId } from './chunks';

const DB_DIR = join(process.cwd(), 'data');
const FILES_DB = join(DB_DIR, 'files.json');

async function ensureDbDir() {
  try {
    await fs.mkdir(DB_DIR, { recursive: true });
  } catch {
    // dir exists
  }
}

async function readFilesDb(): Promise<FileDoc[]> {
  try {
    await ensureDbDir();
    const data = await fs.readFile(FILES_DB, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writeFilesDb(files: FileDoc[]): Promise<void> {
  await ensureDbDir();
  await fs.writeFile(FILES_DB, JSON.stringify(files, null, 2));
}

export async function getFiles(): Promise<FileDoc[]> {
  return readFilesDb();
}

export async function getFile(id: string): Promise<FileDoc | undefined> {
  const files = await readFilesDb();
  return files.find(f => f.id === id);
}

export async function addFile(file: FileDoc): Promise<FileDoc> {
  const files = await readFilesDb();
  files.push(file);
  await writeFilesDb(files);
  return file;
}

export async function deleteFile(id: string): Promise<boolean> {
  const files = await readFilesDb();
  const index = files.findIndex(f => f.id === id);
  if (index === -1) return false;
  files.splice(index, 1);
  await writeFilesDb(files);
  await deleteChunksByFileId(id);
  return true;
}

export async function updateFileStatus(
  id: string,
  status: FileDoc['status'],
): Promise<FileDoc | undefined> {
  const files = await readFilesDb();
  const index = files.findIndex((f) => f.id === id);
  if (index === -1) return undefined;

  files[index] = { ...files[index], status };
  await writeFilesDb(files);
  return files[index];
}