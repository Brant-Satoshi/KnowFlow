import { extname } from 'path';
import { supabase, STORAGE_BUCKET } from './supabase';

function getStorageKey(id: string, name: string): string {
  return `${id}${extname(name)}`;
}

export async function deleteFile(id: string, name: string): Promise<boolean> {
  const filename = getStorageKey(id, name);

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([filename]);

  if (error) {
    console.error('Supabase delete error:', error);
    return false;
  }

  return true;
}

export type StorageDeleteTarget = {
  id: string;
  name: string;
};

export type DeleteFilesResult = {
  deletedKeys: string[];
  failedKeys: string[];
};

export async function deleteFiles(targets: StorageDeleteTarget[]): Promise<DeleteFilesResult> {
  const deletedKeys: string[] = [];
  const failedKeys: string[] = [];

  for (const target of targets) {
    const key = getStorageKey(target.id, target.name);
    const ok = await deleteFile(target.id, target.name);

    if (ok) {
      deletedKeys.push(key);
    } else {
      failedKeys.push(key);
    }
  }

  return { deletedKeys, failedKeys };
}

export async function readFileFromStorage(filePath: string) {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(filePath);
  if (error) throw new Error(error.message);

  const buffer = Buffer.from(await data.arrayBuffer());
  return buffer;
}
