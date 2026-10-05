import { success, error } from '@/lib/api/response';
import { parseJsonBody, withAuth } from '@/lib/api/route';
import { datasetWriteFailureResponse } from '@/lib/api/eval-datasets';
import { parseCreateEvalDatasetBody } from '@/lib/validation';
import { createEvalDataset, listEvalDatasets } from '@/lib/db/eval-datasets';

// Goldsets are global by decision (no workspace/KB tenancy): any signed-in
// user may list and create them. Running one still requires KB access.
export const GET = withAuth('Failed to list eval datasets', async () => {
  const datasets = await listEvalDatasets();
  return Response.json(success({ datasets }));
});

export const POST = withAuth('Failed to create eval dataset', async (request) => {
  const body = await parseJsonBody(request);
  if (body instanceof Response) return body;

  const parsed = parseCreateEvalDatasetBody(body.raw);
  if (!parsed.ok) {
    return Response.json(error('invalid_request', { reason: parsed.error }), { status: 400 });
  }

  const result = await createEvalDataset(parsed.value);
  if (result.kind !== 'ok') return datasetWriteFailureResponse(result);
  return Response.json(success({ dataset: result.dataset, cases: result.cases }));
});
