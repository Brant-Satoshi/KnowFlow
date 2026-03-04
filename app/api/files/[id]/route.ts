import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { getFileById, deleteFile } from '@/lib/db/files';
import { deleteFile as deleteStorageFile } from '@/lib/db/storage';
import { isValidUuid } from '@/lib/validation';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    if (!isValidUuid(id)) {
      return Response.json(error('Invalid file ID'), { status: 400 });
    }

    const file = await getFileById(id);

    if (!file) {
      return Response.json(error('File not found'), { status: 404 });
    }

    await deleteStorageFile(id, file.name);
    await deleteFile(id);

    return Response.json(success({ deleted: true }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Delete failed';
    return Response.json(error(message), { status: 500 });
  }
}
