import { success, error } from '@/lib/api/response';
import { withAuth } from '@/lib/api/route';
import { isValidUuid, parseRetrievalFilter } from '@/lib/validation';
import { loadDataset } from '@/lib/eval/dataset';
import { runComparison } from '@/lib/eval/runner';
import { ensureDataset, saveRun } from '@/lib/db/eval';
import { isNotFoundOrForbiddenError, requireKnowledgeBaseAccess } from '@/lib/authz/access';

export const POST = withAuth('eval_failed', async (request, user) => {
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

  try {
    await requireKnowledgeBaseAccess(user.id, knowledgeBaseId);
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(error(e.message), { status: 404 });
    }
    throw e;
  }

  if (b['mode'] !== 'curated') {
    return Response.json(error('invalid_request'), { status: 400 });
  }

  const useRerank = b['useRerank'] !== false;
  const datasetName = b['datasetName'];

  if (!datasetName || typeof datasetName !== 'string') {
    return Response.json(error('invalid_request'), { status: 400 });
  }

  const filterResult = parseRetrievalFilter(b['filter']);
  if (!filterResult.ok) {
    return Response.json(error('invalid_request'), { status: 400 });
  }
  const filter = filterResult.filter;

  let cases;
  try {
    cases = loadDataset(datasetName);
  } catch {
    return Response.json(error('unknown_dataset'), { status: 400 });
  }

  try {
    const comparison = await runComparison(cases, { knowledgeBaseId, judge: true, useRerank, filter });
    const result = useRerank ? comparison.withRerank : comparison.withoutRerank;
    try {
      const datasetId = await ensureDataset(datasetName, undefined, cases);

      await saveRun(result, {
        useRerank,
        datasetId,
        datasetName,
        filter,
      });
    } catch (error) {
      console.error("Failed to persist eval run", error);
    }
    return Response.json(success(result));
  } catch (e) {
    console.error('[eval/run] curated error:', e);
    return Response.json(error('eval_failed'), { status: 500 });
  }
});
