import { extname } from 'path';
import { supabase, STORAGE_BUCKET } from './supabase';

export async function deleteFile(id: string, name: string): Promise<boolean> {
  const filename = `${id}${extname(name)}`;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([filename]);

  if (error) {
    console.error('Supabase delete error:', error);
    return false;
  }

  return true;
}

export async function readFileFromStorage(filePath: string) {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(filePath); 
  if (error) throw new Error(error.message);

  const buffer = Buffer.from(await data.arrayBuffer());
  return buffer;
}