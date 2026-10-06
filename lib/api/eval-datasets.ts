import { error } from '@/lib/api/response';
import type { EvalDatasetWriteResult } from '@/lib/db/eval-datasets';

type WriteFailure = Exclude<EvalDatasetWriteResult, { kind: 'ok' }>;

/**
 * Maps non-ok dataset write results onto the API's status/message contract:
 * 404 missing resources, 409 name/case_key conflicts, a stale
 * `expectedRevision` (`dataset_changed`, data carries the current revision +
 * hash so the client can rebase), and the cap. Conflict payloads follow the
 * import contract: `{ duplicateCaseKeys, limit, existingCount, incomingCount }`.
 */
export function datasetWriteFailureResponse(failure: WriteFailure): Response {
  switch (failure.kind) {
    case 'not_found':
      return Response.json(error('dataset_not_found'), { status: 404 });
    case 'case_not_found':
      return Response.json(error('case_not_found'), { status: 404 });
    case 'duplicate_name':
      return Response.json(error('dataset_name_conflict'), { status: 409 });
    case 'dataset_changed':
      return Response.json(
        error('dataset_changed', {
          currentRevision: failure.currentRevision,
          currentHash: failure.currentHash,
        }),
        { status: 409 },
      );
    case 'case_key_conflict':
      return Response.json(
        error('duplicate_case_keys', {
          duplicateCaseKeys: failure.duplicateCaseKeys,
          limit: failure.limit,
          existingCount: failure.existingCount,
          incomingCount: failure.incomingCount,
        }),
        { status: 409 },
      );
    case 'limit_exceeded':
      return Response.json(
        error('goldset_limit_exceeded', {
          duplicateCaseKeys: failure.duplicateCaseKeys,
          limit: failure.limit,
          existingCount: failure.existingCount,
          incomingCount: failure.incomingCount,
        }),
        { status: 409 },
      );
  }
}
