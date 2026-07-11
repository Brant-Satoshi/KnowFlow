import { success, error } from '@/lib/api/response';
import { parseJsonBody, withAuth } from '@/lib/api/route';
import { parseEvalValidateBody } from '@/lib/validation';
import { getEvalDatasetSnapshot } from '@/lib/db/eval-datasets';
import { hasGoldsetErrors, lintGoldset, preflightDataset } from '@/lib/eval/validate';
import { requireKnowledgeBaseAccess } from '@/lib/authz/access';
import type { GoldsetValidationReport } from '@/lib/types';

// Two-layer report: structural lint (KB-independent) + filter-aware KB
// compatibility. `ok` = no errors in either layer = the run gate would open.
export const POST = withAuth('validate_failed', async (request, user) => {
  const body = await parseJsonBody(request);
  if (body instanceof Response) return body;
  const parsed = parseEvalValidateBody(body.raw);
  if (!parsed.ok) {
    return Response.json(error('invalid_request', { reason: parsed.error }), { status: 400 });
  }
  const { datasetId, knowledgeBaseId, filter } = parsed.value;

  await requireKnowledgeBaseAccess(user.id, knowledgeBaseId);

  const snapshot = await getEvalDatasetSnapshot(datasetId);
  if (!snapshot) return Response.json(error('dataset_not_found'), { status: 404 });

  const structural = lintGoldset(snapshot.cases);
  const compatibility = await preflightDataset({
    datasetSnapshot: snapshot,
    knowledgeBaseId,
    filter,
  });

  const report: GoldsetValidationReport = {
    datasetId: snapshot.id,
    datasetName: snapshot.name,
    knowledgeBaseId,
    totalCases: snapshot.cases.length,
    structural,
    compatibility,
    ok: !hasGoldsetErrors(structural) && !hasGoldsetErrors(compatibility),
  };
  return Response.json(success(report));
});
