import { success, error } from '@/lib/api/response';
import { parseJsonBody, parseUuidParam, withAuth } from '@/lib/api/route';
import { datasetWriteFailureResponse } from '@/lib/api/eval-datasets';
import {
  parseExpectedRevisionBody,
  parseUpdateEvalDatasetBody,
} from '@/lib/validation';
import {
  deleteEvalDataset,
  getEvalDatasetDetail,
  updateEvalDatasetMeta,
} from '@/lib/db/eval-datasets';

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth('Failed to load eval dataset', async (_req, _user, { params }: Ctx) => {
  const id = await parseUuidParam(params, 'id', 'dataset id');
  if (id instanceof Response) return id;

  const dataset = await getEvalDatasetDetail(id);
  if (!dataset) return Response.json(error('dataset_not_found'), { status: 404 });
  return Response.json(success({ dataset }));
});

export const PATCH = withAuth('Failed to update eval dataset', async (request, _user, { params }: Ctx) => {
  const id = await parseUuidParam(params, 'id', 'dataset id');
  if (id instanceof Response) return id;

  const body = await parseJsonBody(request);
  if (body instanceof Response) return body;
  const parsed = parseUpdateEvalDatasetBody(body.raw);
  if (!parsed.ok) {
    return Response.json(error('invalid_request', { reason: parsed.error }), { status: 400 });
  }

  const { expectedRevision, ...patch } = parsed.value;
  const result = await updateEvalDatasetMeta(id, patch, expectedRevision);
  if (result.kind !== 'ok') return datasetWriteFailureResponse(result);
  return Response.json(success({ dataset: result.dataset, cases: result.cases }));
});

// Deleting a dataset cascades its cases; historical runs are preserved with
// dataset_id nulled and keep their snapshot name/hash (orphans stay comparable).
export const DELETE = withAuth('Failed to delete eval dataset', async (request, _user, { params }: Ctx) => {
  const id = await parseUuidParam(params, 'id', 'dataset id');
  if (id instanceof Response) return id;

  const body = await parseJsonBody(request);
  if (body instanceof Response) return body;
  const parsed = parseExpectedRevisionBody(body.raw);
  if (!parsed.ok) {
    return Response.json(error('invalid_request', { reason: parsed.error }), { status: 400 });
  }

  const result = await deleteEvalDataset(id, parsed.value.expectedRevision);
  if (result.kind !== 'ok') return datasetWriteFailureResponse(result);
  return Response.json(success({ deleted: true }));
});
