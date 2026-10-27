import 'reflect-metadata';
import request from 'supertest';
import { afterEach, expect, test, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { healthResponseSchema, readinessResponseSchema } from '@gst/contracts';
import { createApp } from './app.js';
import { parseConfig } from './config.js';

let app: INestApplication | undefined;
const ready = vi.fn<() => Promise<void>>();
const close = vi.fn<() => Promise<void>>().mockResolvedValue();
async function setup() {
  ready.mockReset().mockResolvedValue();
  close.mockClear();
  app = await createApp(
    parseConfig({ DATABASE_URL: 'postgresql://test:secret@127.0.0.1/test' }),
    { ready, close },
  );
  await app.init();
  return request(app.getHttpServer());
}
afterEach(async () => {
  await app?.close();
  app = undefined;
});
test('versioned liveness returns the shared contract and security headers', async () => {
  const api = await setup();
  const res = await api
    .get('/api/v1/health')
    .set('Host', 'localhost:3000')
    .expect(200);
  expect(healthResponseSchema.parse(res.body).status).toBe('ok');
  expect(res.headers['content-security-policy']).toBeDefined();
  expect(res.headers['x-powered-by']).toBeUndefined();
  expect(ready).not.toHaveBeenCalled();
});
test('readiness reports up and suppresses driver errors when unavailable', async () => {
  const api = await setup();
  const good = await api
    .get('/api/v1/health/ready')
    .set('Host', 'localhost:3000')
    .expect(200);
  expect(readinessResponseSchema.parse(good.body).database).toBe('up');
  ready.mockRejectedValue(new Error('postgresql://user:secret@host/db'));
  const bad = await api
    .get('/api/v1/health/ready')
    .set('Host', 'localhost:3000')
    .expect(503);
  expect(bad.body).toEqual({
    error: { statusCode: 503, message: 'Service unavailable' },
  });
});
test('rejects hostile Host and Origin; exposes OpenAPI and consistent 404', async () => {
  const api = await setup();
  await api.get('/api/v1/health').set('Host', 'evil.example').expect(403);
  await api
    .get('/api/v1/health')
    .set('Host', 'localhost:3000')
    .set('Origin', 'https://evil.example')
    .expect(403);
  const spec = await api
    .get('/api/openapi.json')
    .set('Host', 'localhost:3000')
    .expect(200);
  expect(spec.body.paths['/api/v1/health']).toBeDefined();
  const missing = await api
    .get('/api/v1/missing')
    .set('Host', 'localhost:3000')
    .expect(404);
  expect(missing.body.error.message).toBe('Not found');
});
test('shutdown closes the database', async () => {
  await setup();
  await app!.close();
  app = undefined;
  expect(close).toHaveBeenCalledOnce();
});
