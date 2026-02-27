import { promises as fs } from 'fs';
import { join } from 'path';

const UPLOAD_DIR = join(process.cwd(), 'data', 'uploads');

export async function ensureUploadDir(): Promise<void> {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch {
    // dir exists
  }
}

export async function saveFile(id: string, name: string, buffer: Buffer): Promise<string> {
  await ensureUploadDir();
  const filename = `${id}_${name}`;
  const filepath = join(UPLOAD_DIR, filename);
  await fs.writeFile(filepath, buffer);
  return filepath;
}

export async function deleteFile(id: string, name: string): Promise<boolean> {
  const filename = `${id}_${name}`;
  const filepath = join(UPLOAD_DIR, filename);
  try {
    await fs.unlink(filepath);
    return true;
  } catch {
    return false;
  }
}
