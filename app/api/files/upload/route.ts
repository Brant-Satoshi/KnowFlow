import { extname } from 'path';
import { FileDoc } from '@/lib/types';
import { success, error } from '@/lib/api/response';
import { withAuth } from '@/lib/api/route';
import { addFile } from '@/lib/db/files';
import { supabase, STORAGE_BUCKET } from '@/lib/db/supabase';
import { isValidUuid, MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_FILE_MB } from '@/lib/validation';
import { requireKnowledgeBaseAccess } from '@/lib/authz/access';

// Multipart framing (boundaries, part headers, the knowledgeBaseId field) adds
// a little on top of the file bytes; the exact file size is re-checked below.
const UPLOAD_FORM_OVERHEAD_BYTES = 16 * 1024;

const fileTooLargeResponse = () =>
  Response.json(error(`File exceeds the ${MAX_UPLOAD_FILE_MB}MB size limit`), { status: 413 });

export const POST = withAuth(
  'Upload failed',
  async (req, user) => {
    // Check Content-Length before formData(): that call buffers the whole
    // request body in memory, so oversized uploads must be rejected first.
    const contentLength = Number(req.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_FILE_BYTES + UPLOAD_FORM_OVERHEAD_BYTES) {
      return fileTooLargeResponse();
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const knowledgeBaseId = formData.get('knowledgeBaseId') as string | null;

    if (!file) {
      return Response.json(error('No file provided'), { status: 400 });
    }

    if (!knowledgeBaseId || !isValidUuid(knowledgeBaseId)) {
      return Response.json(error('Valid knowledgeBaseId is required'), { status: 400 });
    }

    await requireKnowledgeBaseAccess(user.id, knowledgeBaseId);

    const allowedExtensions = ['.md', '.txt', '.pdf', '.doc', '.docx'];
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    if (!allowedExtensions.includes(ext)) {
      return Response.json(error('Only .pdf, .md, .txt, .doc, and .docx files are allowed'), { status: 400 });
    }

    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      return fileTooLargeResponse();
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

    // The DB row is the source of truth: if it can't be written, remove the
    // just-uploaded blob so it doesn't linger as an invisible orphan.
    try {
      await addFile(fileDoc, knowledgeBaseId);
    } catch (e) {
      const { error: cleanupError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([filename]);
      if (cleanupError) {
        console.error('Failed to remove orphaned blob after DB insert failure:', filename, cleanupError);
      }
      throw e;
    }

    return Response.json(success({ file: fileDoc }));
  },
);
