import { success, error } from '@/lib/api/response';
import { getFiles } from '@/lib/db/files';

export async function GET() {
  try {
    const files = await getFiles();
    return Response.json(success({ files }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to get files';
    return Response.json(error(message), { status: 500 });
  }
}
