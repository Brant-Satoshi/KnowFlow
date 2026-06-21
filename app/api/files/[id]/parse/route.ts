import { getFileById, updateFileStatus } from '@/lib/db/files';
import { NextRequest } from 'next/server';
import { isValidUuid } from '@/lib/validation';
import { reindexFile } from '@/lib/rag/reindex';
import { requireUser } from '@/lib/auth/current-user';

export const runtime = "nodejs";

// buffer → parse → clean → chunk → embed → replace (see reindexFile)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireUser();
    if (auth instanceof Response) return auth;

    let id = '';
    try {
        id = (await params)?.id;

        if (!isValidUuid(id ?? '')) {
            return Response.json({
                requestId: crypto.randomUUID(),
                ok: false,
                error: 'Invalid file ID',
            }, { status: 400 });
        }

        const file = await getFileById(id);
        if (!file) {
            return Response.json({
                requestId: crypto.randomUUID(),
                ok: false,
                error: 'File not found',
            }, { status: 404 });
        }

        await updateFileStatus(id, 'parsing');

        const chunkCount = await reindexFile(file, { signal: req.signal });

        const updatedFile = await updateFileStatus(id, 'indexed');
        return Response.json({
            requestId: crypto.randomUUID(),
            ok: true,
            data: {
                chunkCount,
                file: updatedFile,
            },
        });

    }

    catch (e) {
        const message = e instanceof Error ? e.message : 'Parse failed';
        if (id) {
            await updateFileStatus(id, 'failed');
            console.log('error', e)
        }
        return Response.json({
            requestId: crypto.randomUUID(),
            ok: false,
            error: message,
        }, { status: 500 });
    }
}
