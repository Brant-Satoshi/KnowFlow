import { claimFileForParsing, updateFileStatus } from '@/lib/db/files';
import { parseUuidParam, withAuth } from '@/lib/api/route';
import { EmbeddingError } from '@/lib/llm/errors';
import { reindexFile } from '@/lib/rag/reindex';
import { ParseUserError, type ParseErrorCode } from '@/lib/rag/parse';
import { success, error } from '@/lib/api/response';
import { isNotFoundOrForbiddenError, requireFileAccess } from '@/lib/authz/access';

export const runtime = "nodejs";

/**
 * Storage and provider internals never reach the user; a code does. It tells the
 * UI which sentence to show, in the reader's language, and it tells the log which
 * failure this was — both stamped with the same requestId, so "my upload says
 * failed" can be traced to an actual line in the log.
 */
function classifyParseFailure(e: unknown): { code: ParseErrorCode; message: string } {
    if (e instanceof ParseUserError) {
        return { code: e.code, message: e.message };
    }
    if (e instanceof EmbeddingError) {
        return {
            code: 'embedding_failed',
            message: 'The file was read, but indexing it failed. Please try again.',
        };
    }
    return { code: 'parse_failed', message: 'Parse failed' };
}

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

            const { code, message } = classifyParseFailure(e);
            const payload = error(message, { code });
            console.error(
                `[api/files/parse][${payload.requestId}] parse failed for file ${id} (${code}):`,
                e,
            );
            return Response.json(payload, { status: 500 });
        }
    },
);
