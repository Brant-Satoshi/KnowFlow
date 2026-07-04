import { updateFileStatus } from '@/lib/db/files';
import { parseUuidParam, withAuth } from '@/lib/api/route';
import { reindexFile } from '@/lib/rag/reindex';
import { success, error } from '@/lib/api/response';
import { isNotFoundOrForbiddenError, requireFileAccess } from '@/lib/authz/access';

export const runtime = "nodejs";

// buffer → parse → clean → chunk → embed → replace (see reindexFile)
export const POST = withAuth(
    'Parse failed',
    async (req, user, { params }: { params: Promise<{ id: string }> }) => {
        const id = await parseUuidParam(params, 'id', 'file id');
        if (id instanceof Response) return id;

        let canUpdateStatus = false;
        try {
            const file = await requireFileAccess(user.id, id);
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
    },
);
