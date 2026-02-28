import { replaceFileChunks } from '@/lib/db/chunks';
import { getFile, updateFileStatus } from '@/lib/db/files';
import { parseFile } from '@/lib/rag/parse';
import { readFile } from 'fs/promises';
import { NextRequest } from 'next/server';
import { join } from 'path';

export const runtime = "nodejs";

// buffer → parse → clean → chunk → (embed)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    let id = '';
    try {
        id = (await params)?.id;
        const file = await getFile(id);
        if (!file) {
            return Response.json({
                requestId: crypto.randomUUID(),
                ok: false,
                error: 'File not found',
            }, { status: 404 });
        }

        await updateFileStatus(id, 'parsing');
        const filePath = join(process.cwd(), 'data', 'uploads', `${id}_${file.name}`);
        const buffer = await readFile(filePath);

        let text = "";

        text = await parseFile(file, buffer);
        text = clean(text);
        const chunkDocs = chunkText(text).map((c, idx) => ({
            id: `${id}-${idx}`,
            fileId: id,
            idx,
            text: c,
            meta: {},
        }));

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

    catch {
        if (id) {
            await updateFileStatus(id, 'failed');
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

function chunkText(text: string, size = 500, overlap = 100) {
    if (size > 0 && overlap >= 0 && size > overlap) {
        const chunks: string[] = [];
        let start = 0;

        while (start < text.length) {
            chunks.push(text.slice(start, start + size));
            start += size - overlap;
        }
        return chunks;
    } else {
        throw new Error("Invalid chunk size or overlap");
    }

}