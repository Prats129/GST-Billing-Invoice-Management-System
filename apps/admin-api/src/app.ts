import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { platformReadResponse } from '@gst/contracts/platform';
import { map } from 'rxjs';
import type { ExecutionContext, CallHandler } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { PlatformController, PLATFORM } from './controller.js';
import type { Services } from './controller.js';
import type { PlatformConfig } from './config.js';
import { store } from './store.js';
import { PlatformAuth } from './auth.js';
import { PlatformService } from './service.js';
import { PlatformErrors } from './errors.js';
import { Operations } from './operations.js';
export async function createPlatformApp(
  config: PlatformConfig,
  supplied?: Services,
) {
  const db = supplied?.auth.db ?? store(config.PLATFORM_DATABASE_URL);
  const trust = config.PLATFORM_TRUST_FILE
    ? (JSON.parse(
        await readFile(config.PLATFORM_TRUST_FILE, 'utf8'),
      ) as unknown)
    : undefined;
  const auth = supplied?.auth ?? new PlatformAuth(db, config),
    service = supplied?.service ?? new PlatformService(db, trust),
    operations = supplied?.operations ?? new Operations(service, config);
  const services = { auth, service, operations };
  @Module({
    controllers: [PlatformController],
    providers: [
      { provide: PLATFORM, useValue: services },
      {
        provide: 'LIFECYCLE',
        useValue: {
          onApplicationShutdown: async () => {
            await operations.close();
            await db.end();
          },
        },
      },
    ],
  })
  class PlatformModule {}
  const app = await NestFactory.create<NestExpressApplication>(PlatformModule, {
    logger: false,
    bodyParser: false,
    ...(config.PLATFORM_TLS_KEY
      ? {
          httpsOptions: {
            key: await readFile(config.PLATFORM_TLS_KEY),
            cert: await readFile(config.PLATFORM_TLS_CERT!),
          },
        }
      : {}),
  });
  app.disable('x-powered-by');
  app.use(helmet({ referrerPolicy: { policy: 'no-referrer' } }));
  const hosts = new Set([
    new URL(config.PLATFORM_ORIGIN).host,
    config.PLATFORM_HOST + ':' + config.PLATFORM_PORT,
  ]);
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (
      !req.headers.host ||
      !hosts.has(req.headers.host) ||
      (req.headers.origin && req.headers.origin !== config.PLATFORM_ORIGIN)
    ) {
      res
        .status(403)
        .json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
      return;
    }
    next();
  });
  app.use(express.json({ limit: '1mb', strict: true }));
  app.setGlobalPrefix('api/platform/v1');
  app.useGlobalFilters(new PlatformErrors());
  app.useGlobalInterceptors({
    intercept: (context: ExecutionContext, next: CallHandler) =>
      next.handle().pipe(
        map((value: unknown) => {
          const req = context.switchToHttp().getRequest<Request>();
          if (req.method !== 'GET') return value;
          try {
            return platformReadResponse(
              req.url.replace(/^\/api\/platform\/v1\//, ''),
              JSON.parse(JSON.stringify(value)),
            );
          } catch {
            throw new Error('Platform response contract failed');
          }
        }),
      ),
  });
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('GST Platform Admin')
      .setVersion('1')
      .addCookieAuth('__Host-gst_admin_session')
      .build(),
  );
  SwaggerModule.setup('api/platform/openapi', app, document, {
    ui: false,
    raw: ['json'],
    jsonDocumentUrl: '/api/platform/openapi.json',
  });
  if (config.PLATFORM_WEB_ROOT) {
    if (!isAbsolute(config.PLATFORM_WEB_ROOT))
      throw new Error('Absolute admin web root required');
    app.useStaticAssets(config.PLATFORM_WEB_ROOT, { dotfiles: 'deny' });
  }
  const server = app.getHttpServer();
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { app, services };
}
