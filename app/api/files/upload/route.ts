import { NextRequest } from 'next/server';
import { writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { FileDoc } from '@/lib/types';
import { success, error } from '@/lib/api/response';
import { addFile } from '@/lib/db/files';
import { ensureUploadDir } from '@/lib/db/storage';

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

    await ensureUploadDir();
    const filename = `${id}${extname(file.name)}`;
    const filepath = join(process.cwd(), 'data', 'uploads', filename);
    await writeFile(filepath, buffer);

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
