import { success, error } from '@/lib/api/response';
import { parseJsonBody, parseUuidParam, withAuth } from '@/lib/api/route';
import { datasetWriteFailureResponse } from '@/lib/api/eval-datasets';
import {
  parseExpectedDatasetHashBody,
  parseUpdateEvalCaseBody,
} from '@/lib/validation';
import { deleteEvalCase, updateEvalCase } from '@/lib/db/eval-datasets';

// `caseId` is always the eval_cases row UUID — the business case_key only
// appears inside body payloads (as `case.id`).
type Ctx = { params: Promise<{ id: string; caseId: string }> };

export const PATCH = withAuth('Failed to update eval case', async (request, _user, { params }: Ctx) => {
  const id = await parseUuidParam(params, 'id', 'dataset id');
  if (id instanceof Response) return id;
  const caseId = await parseUuidParam(params, 'caseId', 'case id');
  if (caseId instanceof Response) return caseId;

  const body = await parseJsonBody(request);
  if (body instanceof Response) return body;
  const parsed = parseUpdateEvalCaseBody(body.raw);
  if (!parsed.ok) {
    return Response.json(error('invalid_request', { reason: parsed.error }), { status: 400 });
  }

  const result = await updateEvalCase(id, caseId, parsed.value.case, parsed.value.expectedDatasetHash);
  if (result.kind !== 'ok') return datasetWriteFailureResponse(result);
  return Response.json(success({ dataset: result.dataset, cases: result.cases }));
});

export const DELETE = withAuth('Failed to delete eval case', async (request, _user, { params }: Ctx) => {
  const id = await parseUuidParam(params, 'id', 'dataset id');
  if (id instanceof Response) return id;
  const caseId = await parseUuidParam(params, 'caseId', 'case id');
  if (caseId instanceof Response) return caseId;

  const body = await parseJsonBody(request);
  if (body instanceof Response) return body;
  const parsed = parseExpectedDatasetHashBody(body.raw);
  if (!parsed.ok) {
    return Response.json(error('invalid_request', { reason: parsed.error }), { status: 400 });
  }

  const result = await deleteEvalCase(id, caseId, parsed.value.expectedDatasetHash);
  if (result.kind !== 'ok') return datasetWriteFailureResponse(result);
  return Response.json(success({ dataset: result.dataset, cases: result.cases }));
});
