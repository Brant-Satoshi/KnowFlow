import { NextRequest } from 'next/server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const body = await req.json();
    }
    catch (e) {
        return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

}