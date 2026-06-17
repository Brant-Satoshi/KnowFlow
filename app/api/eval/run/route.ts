import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { isValidUuid } from '@/lib/validation';
import { loadDataset } from '@/lib/eval/dataset';
import { runComparison } from '@/lib/eval/runner';
import { ensureDataset, saveRun } from '@/lib/db/eval';

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(error('invalid_request'), { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return Response.json(error('invalid_request'), { status: 400 });
  }

  const b = body as Record<string, unknown>;

  const knowledgeBaseId = b['knowledgeBaseId'];
  if (!knowledgeBaseId || typeof knowledgeBaseId !== 'string' || !isValidUuid(knowledgeBaseId)) {
    return Response.json(error('invalid_request'), { status: 400 });
  }

  if (b['mode'] !== 'curated') {
    return Response.json(error('invalid_request'), { status: 400 });
  }

  const useRerank = b['useRerank'] !== false;
  const datasetName = b['datasetName'];

  if (!datasetName || typeof datasetName !== 'string') {
    return Response.json(error('invalid_request'), { status: 400 });
  }

  let cases;
  try {
    cases = loadDataset(datasetName);
  } catch {
    return Response.json(error('unknown_dataset'), { status: 400 });
  }

  try {
    const comparison = await runComparison(cases, { knowledgeBaseId });
    const result = useRerank ? comparison.withRerank : comparison.withoutRerank;
    try {
      const datasetId = await ensureDataset(datasetName, undefined, cases);

      await saveRun(result, {
        useRerank,
        datasetId,
        datasetName,
      });
    } catch (error) {
      console.error("Failed to persist eval run", error);
    }
    return Response.json(success(result));
  } catch (e) {
    console.error('[eval/run] curated error:', e);
    return Response.json(error('eval_failed'), { status: 500 });
  }
}
