import { replaceFileChunks } from '@/lib/db/chunks';
import { getFileById, updateFileStatus } from '@/lib/db/files';
import { chunkText } from '@/lib/rag/chunks';
import { parseFile } from '@/lib/rag/parse';
import { NextRequest } from 'next/server';
import { extname } from 'path';
import { isValidUuid } from '@/lib/validation';
import { embedChunk } from '@/lib/rag/embedings';
import { readFileFromStorage } from '@/lib/db/storage';

export const runtime = "nodejs";

// buffer → parse → clean → chunk → (embed)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

        const filePath = `${id}${extname(file.name)}`;

        const buffer = await readFileFromStorage(filePath);

        const text = clean(await parseFile(file, buffer));

        let chunkDocs = chunkText(text, id)

        chunkDocs = await embedChunk(chunkDocs);

        await replaceFileChunks(id, chunkDocs);
        
        const updatedFile = await updateFileStatus(id, 'indexed');
        return Response.json({
            requestId: crypto.randomUUID(),
            ok: true,
            data: {
                chunkCount: chunkDocs.length,
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

function clean(text: string) {
    return text
        .replace(/\n{2,}/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/Page \d+/g, "")
        .trim();
}
