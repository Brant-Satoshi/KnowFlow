import { claimFileForParsing, updateFileStatus } from '@/lib/db/files';
import { parseUuidParam, withAuth } from '@/lib/api/route';
import { reindexFile } from '@/lib/rag/reindex';
import { ParseUserError } from '@/lib/rag/parse';
import { success, error } from '@/lib/api/response';
import { isNotFoundOrForbiddenError, requireFileAccess } from '@/lib/authz/access';

export const runtime = "nodejs";

// buffer → parse → clean → chunk → embed → replace (see reindexFile)
export const POST = withAuth(
    'Parse failed',
    async (req, user, { params }: { params: Promise<{ id: string }> }) => {
        const id = await parseUuidParam(params, 'id', 'file id');
        if (id instanceof Response) return id;

        let claimed = false;
        try {
            await requireFileAccess(user.id, id);

            // Atomic claim: only one request may flip the status to 'parsing',
            // so a double-click or second tab can't run two chunk replacements
            // concurrently. `?force=true` is the escape hatch for a file stuck
            // in 'parsing' after a crashed process.
            const force = new URL(req.url).searchParams.get('force') === 'true';
            const file = await claimFileForParsing(id, { force });
            if (!file) {
                return Response.json(error('File is already being parsed'), { status: 409 });
            }
            claimed = true;

            const chunkCount = await reindexFile(file, { signal: req.signal });

            const updatedFile = await updateFileStatus(id, 'indexed');
            return Response.json(success({ chunkCount, file: updatedFile }));

        }

        catch (e) {
            if (isNotFoundOrForbiddenError(e)) {
                return Response.json(error(e.message), { status: 404 });
            }
            if (claimed) {
                await updateFileStatus(id, 'failed');
            }
            console.error(`[api/files/parse] Parse failed for file ${id}:`, e);
            // Keep storage/provider internals server-side; only deliberately
            // user-facing messages (ParseUserError) pass through.
            const message = e instanceof ParseUserError ? e.message : 'Parse failed';
            return Response.json(error(message), { status: 500 });
        }
    },
);
