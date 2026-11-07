import { afterEach, expect, test, vi } from 'vitest';
import { api, onIdentityRequired, PlatformApiError, setCsrf } from './api.js';
const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
afterEach(() => {
  vi.unstubAllGlobals();
  setCsrf('');
});
test('only an explicit identity rejection can retry once, retaining payload/key and using refreshed CSRF', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      response(403, { error: { code: 'REAUTH_REQUIRED' } }),
    )
    .mockResolvedValueOnce(response(201, { ok: true }));
  vi.stubGlobal('fetch', fetch);
  setCsrf('original');
  const confirm = vi.fn(async () => {
    setCsrf('confirmed');
  });
  const remove = onIdentityRequired(confirm);
  try {
    const body = {
      requestKey: 'same-submission-key',
      paused: true,
      reason: 'Requested pause',
    };
    await expect(api('organizations/org/pause', body)).resolves.toEqual({
      ok: true,
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]![1].body).toBe(fetch.mock.calls[1]![1].body);
    expect(fetch.mock.calls[1]![1].headers['x-csrf-token']).toBe('confirmed');
  } finally {
    remove();
  }
});
test('network/commit failures never repeat a mutation or request identity verification', async () => {
  const confirm = vi.fn(async () => {}),
    remove = onIdentityRequired(confirm);
  const fetch = vi.fn().mockRejectedValue(new TypeError('Network unavailable'));
  vi.stubGlobal('fetch', fetch);
  try {
    await expect(
      api('organizations/org/receipts', { amountPaise: '100' }),
    ).rejects.toMatchObject({ code: 'NETWORK_UNAVAILABLE' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  } finally {
    remove();
  }
});
test('unreadable or null success responses never report a saved mutation or retry it', async () => {
  for (const payload of ['<html>proxy response</html>', 'null']) {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(payload, { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      api('organizations/org/receipts', { amountPaise: '100' }),
    ).rejects.toMatchObject({ code: 'REQUEST_FAILED' });
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});
test('cancelling identity verification never repeats the blocked action', async () => {
  const remove = onIdentityRequired(async () => {
    throw new PlatformApiError(0, 'CANCELLED', 'Cancelled');
  });
  const fetch = vi
    .fn()
    .mockResolvedValue(response(403, { error: { code: 'REAUTH_REQUIRED' } }));
  vi.stubGlobal('fetch', fetch);
  try {
    await expect(
      api('organizations/org/pause', { paused: true }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    remove();
  }
});
test('invalid proof keeps the authenticated session; genuine session expiry is reported', async () => {
  const window = new EventTarget(),
    expired = vi.fn();
  window.addEventListener('platform-session-expired', expired);
  vi.stubGlobal('window', window);
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        response(401, { error: { code: 'INVALID_CREDENTIALS' } }),
      )
      .mockResolvedValueOnce(
        response(401, { error: { code: 'UNAUTHENTICATED' } }),
      ),
  );
  await expect(
    api('auth/confirm', { password: 'wrong', code: '000000' }),
  ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  expect(expired).not.toHaveBeenCalled();
  await expect(api('overview')).rejects.toMatchObject({
    code: 'UNAUTHENTICATED',
  });
  expect(expired).toHaveBeenCalledTimes(1);
});
