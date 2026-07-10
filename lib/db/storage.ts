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
  if (targets.length === 0) {
    return { deletedKeys: [], failedKeys: [] };
  }

  const keys = targets.map((target) => getStorageKey(target.id, target.name));

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove(keys);

  if (error) {
    console.error('Supabase batch delete error:', error);
    return { deletedKeys: [], failedKeys: keys };
  }

  return { deletedKeys: keys, failedKeys: [] };
}

export async function readFileFromStorage(filePath: string) {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(filePath);
  if (error) throw new Error(error.message);

  const buffer = Buffer.from(await data.arrayBuffer());
  return buffer;
}
