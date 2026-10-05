import { success, error } from '@/lib/api/response';
import { parseJsonBody, withAuth } from '@/lib/api/route';
import { parseEvalRunBody } from '@/lib/validation';
import { runComparison } from '@/lib/eval/runner';
import { hashDataset } from '@/lib/eval/hash';
import { hasGoldsetErrors, lintGoldset, preflightDataset } from '@/lib/eval/validate';
import { getEvalDatasetSnapshot } from '@/lib/db/eval-datasets';
import { saveRun } from '@/lib/db/eval';
import { isNotFoundOrForbiddenError, requireKnowledgeBaseAccess } from '@/lib/authz/access';
import type { EvalRunResult } from '@/lib/types';

export const POST = withAuth('eval_failed', async (request, user) => {
  const body = await parseJsonBody(request);
  if (body instanceof Response) return body;
  const parsed = parseEvalRunBody(body.raw);
  if (!parsed.ok) {
    return Response.json(error('invalid_request', { reason: parsed.error }), { status: 400 });
  }
  const { knowledgeBaseId, datasetId, useRerank, filter } = parsed.value;

  try {
    await requireKnowledgeBaseAccess(user.id, knowledgeBaseId);
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(error(e.message), { status: 404 });
    }
    throw e;
  }

  // 1. One snapshot for the whole request — the gate below and the run itself
  //    see the same cases; edits/deletes during the run don't touch it.
  const snapshot = await getEvalDatasetSnapshot(datasetId);
  if (!snapshot) return Response.json(error('dataset_not_found'), { status: 404 });

  if (hashDataset(snapshot.cases) !== snapshot.datasetHash) {
    // The stored hash must always equal the hash of the stored cases — a
    // mismatch means the CRUD hash maintenance is broken. Refuse to run.
    console.error(`[eval/run] dataset_hash_mismatch for dataset ${datasetId}`);
    return Response.json(error('dataset_hash_mismatch'), { status: 500 });
  }

  // 2. Two-layer gate: structural lint + KB compatibility. Any error (empty
  //    set and the case cap included) blocks the run; warnings don't.
  const structural = lintGoldset(snapshot.cases);
  const compatibility = await preflightDataset({
    datasetSnapshot: snapshot,
    knowledgeBaseId,
    filter,
  });
  if (hasGoldsetErrors(structural) || hasGoldsetErrors(compatibility)) {
    return Response.json(
      error('dataset_incompatible', {
        datasetId,
        knowledgeBaseId,
        issues: { structural, compatibility },
      }),
      { status: 422 },
    );
  }

  // 3. Run over the snapshot cases.
  let result: EvalRunResult;
  try {
    const comparison = await runComparison(snapshot.cases, {
      knowledgeBaseId,
      judge: true,
      useRerank,
      filter,
    });
    result = useRerank ? comparison.withRerank : comparison.withoutRerank;
  } catch (e) {
    console.error('[eval/run] curated error:', e);
    return Response.json(error('eval_failed'), { status: 500 });
  }

  // 4. Persist with the snapshot's identity (name/hash). saveRun handles a
  //    mid-run dataset deletion by orphaning (dataset_id = NULL); any other
  //    persistence failure is a failure — never report success without a row.
  try {
    await saveRun(result, {
      useRerank,
      datasetId: snapshot.id,
      datasetName: snapshot.name,
      filter,
    });
  } catch (e) {
    console.error('[eval/run] failed to persist run:', e);
    return Response.json(error('eval_persist_failed'), { status: 500 });
  }

  return Response.json(success(result));
});
