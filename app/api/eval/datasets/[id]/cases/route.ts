import { success, error } from '@/lib/api/response';
import { parseJsonBody, parseUuidParam, withAuth } from '@/lib/api/route';
import { datasetWriteFailureResponse } from '@/lib/api/eval-datasets';
import { parseAddEvalCasesBody } from '@/lib/validation';
import { addEvalCases } from '@/lib/db/eval-datasets';

type Ctx = { params: Promise<{ id: string }> };

// `cases` object = single add, array = atomic batch import. Duplicate
// case_keys (in-batch or against stored rows) or the cap reject the whole
// batch with a 409 and nothing written.
export const POST = withAuth('Failed to add eval cases', async (request, _user, { params }: Ctx) => {
  const id = await parseUuidParam(params, 'id', 'dataset id');
  if (id instanceof Response) return id;

  const body = await parseJsonBody(request);
  if (body instanceof Response) return body;
  const parsed = parseAddEvalCasesBody(body.raw);
  if (!parsed.ok) {
    return Response.json(error('invalid_request', { reason: parsed.error }), { status: 400 });
  }

  const result = await addEvalCases(id, parsed.value.cases, parsed.value.expectedDatasetHash);
  if (result.kind !== 'ok') return datasetWriteFailureResponse(result);
  return Response.json(success({ dataset: result.dataset, cases: result.cases }));
});
