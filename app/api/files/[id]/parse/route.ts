import { updateFileStatus } from '@/lib/db/files';
import { NextRequest } from 'next/server';
import { isValidUuid } from '@/lib/validation';
import { reindexFile } from '@/lib/rag/reindex';
import { requireUser } from '@/lib/auth/current-user';
import { success, error } from '@/lib/api/response';
import { isNotFoundOrForbiddenError, requireFileAccess } from '@/lib/authz/access';

export const runtime = "nodejs";

// buffer → parse → clean → chunk → embed → replace (see reindexFile)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireUser();
    if (auth instanceof Response) return auth;

    let id = '';
    let canUpdateStatus = false;
    try {
        id = (await params)?.id;

        if (!isValidUuid(id ?? '')) {
            return Response.json(error('Invalid file ID'), { status: 400 });
        }

        const file = await requireFileAccess(auth.id, id);
        canUpdateStatus = true;

        await updateFileStatus(id, 'parsing');

        const chunkCount = await reindexFile(file, { signal: req.signal });

        const updatedFile = await updateFileStatus(id, 'indexed');
        return Response.json(success({ chunkCount, file: updatedFile }));

    }

    catch (e) {
        if (isNotFoundOrForbiddenError(e)) {
            return Response.json(error(e.message), { status: 404 });
        }
        const message = e instanceof Error ? e.message : 'Parse failed';
        if (id && canUpdateStatus) {
            await updateFileStatus(id, 'failed');
            console.log('error', e)
        }
        return Response.json(error(message), { status: 500 });
    }
}
