import { expect, test } from '@playwright/test';

// Keep in sync with MAX_UPLOAD_FILE_BYTES in lib/validation.ts (25MB).
const OVERSIZED_FILE_BYTES = 26 * 1024 * 1024;

test.describe('POST /api/files/upload', () => {
  test('rejects a file over the size limit with 413', async ({ request }) => {
    const createKb = await request.post('/api/knowledge-bases', {
      data: { name: `upload-limit-e2e-${Date.now()}` },
    });
    expect(createKb.status()).toBe(201);
    const kbId = (await createKb.json()).data.knowledgeBase.id as string;

    try {
      const response = await request.post('/api/files/upload', {
        multipart: {
          knowledgeBaseId: kbId,
          file: {
            name: 'oversized.txt',
            mimeType: 'text/plain',
            buffer: Buffer.alloc(OVERSIZED_FILE_BYTES, 'a'),
          },
        },
      });

      expect(response.status()).toBe(413);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.error).toContain('25MB');
    } finally {
      await request.delete(`/api/knowledge-bases/${kbId}`);
    }
  });
});
