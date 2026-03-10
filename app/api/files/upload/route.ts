import { NextRequest } from 'next/server';
import { extname } from 'path';
import { FileDoc } from '@/lib/types';
import { success, error } from '@/lib/api/response';
import { addFile } from '@/lib/db/files';
import { supabase, STORAGE_BUCKET } from '@/lib/db/supabase';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return Response.json(error('No file provided'), { status: 400 });
    }

    const allowedExtensions = ['.md', '.txt', '.pdf'];
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    if (!allowedExtensions.includes(ext)) {
      return Response.json(error('Only .pdf, .md, .txt files are allowed'), { status: 400 });
    }

    const id = crypto.randomUUID();
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const filename = `${id}${extname(file.name)}`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filename, buffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) {
      console.error('Supabase upload error:', uploadError);
      return Response.json(error(`Failed to upload file: ${uploadError.message}`), { status: 500 });
    }

    const fileDoc: FileDoc = {
      id,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      status: 'uploaded',
      createdAt: new Date().toISOString(),
    };

    await addFile(fileDoc);

    return Response.json(success({ file: fileDoc }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload failed';
    return Response.json(error(message), { status: 500 });
  }
}
