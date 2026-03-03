import { replaceFileChunks } from '@/lib/db/chunks';
import { getFileById, updateFileStatus } from '@/lib/db/files';
import { chunkText } from '@/lib/rag/chunks';
import { parseFile } from '@/lib/rag/parse';
import { readFile } from 'fs/promises';
import { NextRequest } from 'next/server';
import { extname, join } from 'path';

export const runtime = "nodejs";

// buffer → parse → clean → chunk → (embed)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    let id = '';
    try {
        id = (await params)?.id;
        const file = await getFileById(id);
        if (!file) {
            return Response.json({
                requestId: crypto.randomUUID(),
                ok: false,
                error: 'File not found',
            }, { status: 404 });
        }

        await updateFileStatus(id, 'parsing');

        const filePath = join(process.cwd(), 'data', 'uploads', `${id}${extname(file.name)}`);
        const buffer = await readFile(filePath);

        const text = clean(await parseFile(file, buffer));
        const chunkDocs = chunkText(text, id)

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
        if (id) {
            await updateFileStatus(id, 'failed');
            console.log('error', e)
        }
        return Response.json({
            requestId: crypto.randomUUID(),
            ok: false,
            error: 'Parse failed',
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