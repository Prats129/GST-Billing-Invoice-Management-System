import { afterEach, expect, test, vi } from 'vitest';
import { securityRequest } from './security-api.js';
afterEach(() => vi.unstubAllGlobals());
test('unreadable and null success responses fail without repeating a billing write', async () => {
  for (const payload of ['<html>proxy response</html>', 'null']) {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(payload, { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      securityRequest('/organizations/org/invoices', 'csrf', 'POST', {
        draft: true,
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_FAILED' });
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});
