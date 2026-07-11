import { expect, test } from '@playwright/test';

const DUPLICATE_EMAIL = 'e2e-duplicate@knowflow.test';
const DUPLICATE_PASSWORD = 'playwright-duplicate-pass';

test.describe('POST /api/auth/register', () => {
  test('returns a safe 409 envelope for a case-insensitive duplicate email', async ({ request }) => {
    // Bootstrap this test's own fixture. A virgin database returns 201; a
    // repeated local/CI run returns 409. Either way, the uppercase request
    // below now has a guaranteed lowercase predecessor and cannot self-heal.
    const bootstrap = await request.post('/api/auth/register', {
      data: {
        email: DUPLICATE_EMAIL,
        password: DUPLICATE_PASSWORD,
      },
    });
    expect([201, 409]).toContain(bootstrap.status());

    const response = await request.post('/api/auth/register', {
      data: {
        email: DUPLICATE_EMAIL.toUpperCase(),
        password: DUPLICATE_PASSWORD,
      },
    });

    expect(response.status()).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: false,
      error: 'Email already registered',
      data: { code: 'EMAIL_TAKEN' },
    });
    expect(body.requestId).toEqual(expect.any(String));

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('23505');
    expect(serialized).not.toContain('users_email_unique');
    expect(serialized).not.toContain('duplicate key');
  });
});
