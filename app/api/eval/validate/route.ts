import { success, error } from '@/lib/api/response';
import { withAuth } from '@/lib/api/route';
import { listDatasetNames } from '@/lib/eval/dataset';
import { validateDataset } from '@/lib/eval/validate';

export const GET = withAuth('validate_failed', async (req) => {
  const dataset = new URL(req.url).searchParams.get('dataset');
  if (!dataset || !listDatasetNames().includes(dataset)) {
    return Response.json(error('unknown_dataset'), { status: 400 });
  }

  try {
    const result = await validateDataset(dataset);
    return Response.json(success(result));
  } catch (e) {
    console.error('[eval/validate] error:', e);
    return Response.json(error('validate_failed'), { status: 500 });
  }
});
