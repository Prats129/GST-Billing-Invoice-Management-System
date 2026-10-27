import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { Server } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { createDatabase } from '@gst/database';
import type { Database } from '@gst/database';
import type { Config } from './config.js';
import { ApiExceptionFilter } from './errors.js';
import { DATABASE, HealthController } from './health.js';
import { safeLogger } from './logging.js';

export async function createApp(
  config: Config,
  suppliedDatabase?: Pick<Database, 'ready' | 'close'>,
) {
  const database = suppliedDatabase ?? createDatabase(config.DATABASE_URL);
  @Module({
    controllers: [HealthController],
    providers: [
      { provide: DATABASE, useValue: database },
      {
        provide: 'DATABASE_LIFECYCLE',
        useValue: { onApplicationShutdown: () => database.close() },
      },
    ],
  })
  class AppModule {}
  const httpsOptions =
    config.TLS_KEY_PATH && config.TLS_CERT_PATH
      ? {
          key: readFileSync(config.TLS_KEY_PATH),
          cert: readFileSync(config.TLS_CERT_PATH),
          minVersion: 'TLSv1.2' as const,
        }
      : undefined;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: safeLogger,
    ...(httpsOptions ? { httpsOptions } : {}),
    bodyParser: false,
  });
  app.disable('x-powered-by');
  app.use(helmet());
  const allowedHosts = new Set(
    config.ALLOWED_HOSTS.split(',').map((v) => v.trim()),
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (
      !req.headers.host ||
      !allowedHosts.has(req.headers.host) ||
      (req.headers.origin && req.headers.origin !== config.APP_ORIGIN)
    ) {
      res
        .status(403)
        .json({ error: { statusCode: 403, message: 'Forbidden' } });
      return;
    }
    next();
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('GST Platform Foundation')
      .setDescription(
        'Phase 1 operations only; no billing or legal compliance claim.',
      )
      .setVersion('1')
      .build(),
  );
  // JSON OpenAPI avoids relaxing CSP to support a docs UI.
  SwaggerModule.setup('api', app, document, {
    ui: false,
    raw: ['json'],
    jsonDocumentUrl: '/api/openapi.json',
  });
  if (config.WEB_ROOT) {
    if (!isAbsolute(config.WEB_ROOT))
      throw new Error('WEB_ROOT must be absolute');
    app.useStaticAssets(config.WEB_ROOT, {
      index: 'index.html',
      dotfiles: 'deny',
    });
  }
  const server = app.getHttpServer() as Server;
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return app;
}
