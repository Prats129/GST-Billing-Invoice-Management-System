import { afterEach, expect, test, vi } from 'vitest';
import { fetchHealth, fetchReadiness } from './api.js';

afterEach(() => vi.unstubAllGlobals());
test('frontend calls the same-origin versioned API and validates its contract', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ status: 'ok', service: 'gst-api', apiVersion: '1' }),
      ),
    );
  vi.stubGlobal('fetch', fetch);
  const signal = new AbortController().signal;
  expect((await fetchHealth(signal)).status).toBe('ok');
  expect(fetch).toHaveBeenCalledWith(
    '/api/v1/health',
    expect.objectContaining({ signal, credentials: 'same-origin' }),
  );
});
test('rejects unavailable or incompatible API responses', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('{}', { status: 503 })),
  );
  await expect(fetchReadiness(new AbortController().signal)).rejects.toThrow(
    'Database unavailable',
  );
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('{"status":"unexpected"}')),
  );
  await expect(fetchHealth(new AbortController().signal)).rejects.toThrow();
});
