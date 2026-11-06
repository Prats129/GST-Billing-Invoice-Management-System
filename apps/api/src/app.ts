import 'reflect-metadata';
import { isAbsolute } from 'node:path';
import type { Server } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import express from 'express';
import { createDatabase } from '@gst/database';
import type { Database } from '@gst/database';
import type { Config } from './config.js';
import { loadServerTls, monitorServerTls } from './tls.js';
import { ApiExceptionFilter } from './errors.js';
import { DATABASE, HealthController } from './health.js';
import { safeLogger } from './logging.js';
import {
  IdentityController,
  OrganizationsController,
  SECURITY,
} from './security/controllers.js';
import { OwnerSetupController } from './security/owner-setup.controller.js';
import { IdentityService } from './security/identity.service.js';
import { OrganizationsService } from './security/organizations.service.js';
import {
  BUSINESS,
  BusinessController,
} from './business/business.controller.js';
import { BusinessService } from './business/business.service.js';
import {
  INVOICING,
  InvoicingController,
} from './invoicing/invoicing.controller.js';
import { InvoicingService } from './invoicing/invoicing.service.js';

export async function createApp(
  config: Config,
  suppliedDatabase?: Pick<Database, 'ready' | 'close'> &
    Partial<Pick<Database, 'db'>>,
) {
  // Validate HTTPS before constructing database/authentication resources.
  const tls = loadServerTls(config);
  let stopTlsMonitor: (() => void) | undefined;
  const database = suppliedDatabase ?? createDatabase(config.DATABASE_URL);
  const identity = database.db
    ? new IdentityService(database as Database, config)
    : undefined;
  const security = identity
    ? { identity, organizations: new OrganizationsService(identity) }
    : null;
  @Module({
    controllers: [
      HealthController,
      IdentityController,
      OwnerSetupController,
      OrganizationsController,
      BusinessController,
      InvoicingController,
    ],
    providers: [
      { provide: DATABASE, useValue: database },
      { provide: SECURITY, useValue: security },
      {
        provide: INVOICING,
        useValue: security
          ? new InvoicingService(security.organizations)
          : null,
      },
      {
        provide: BUSINESS,
        useValue: security ? new BusinessService(security.organizations) : null,
      },
      {
        provide: 'DATABASE_LIFECYCLE',
        useValue: { onApplicationShutdown: () => database.close() },
      },
      {
        provide: 'TLS_LIFECYCLE',
        useValue: {
          onApplicationBootstrap: () => {
            if (tls) stopTlsMonitor = monitorServerTls(tls.certificates);
          },
          onApplicationShutdown: () => stopTlsMonitor?.(),
        },
      },
    ],
  })
  class AppModule {}
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: safeLogger,
    ...(tls ? { httpsOptions: tls.httpsOptions } : {}),
    bodyParser: false,
  });
  app.disable('x-powered-by');
  app.use(helmet());
  const allowedHosts = new Set(
    config.ALLOWED_HOSTS.split(',').map((v) => v.trim()),
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Express routes are case-insensitive; cache protection must match them too.
    if (/^\/api(?:\/|$)/i.test(req.path))
      res.setHeader('Cache-Control', 'no-store');
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
  // Bounded 100-line invoice bodies need more room than identity forms. Keep
  // the tighter parser on all other routes.
  app.use(
    '/api/v1/organizations/:orgId/invoices',
    express.json({ limit: '256kb', strict: true }),
  );
  app.use(
    '/api/v1/organizations/:orgId/business-profile',
    express.json({ limit: '128kb', strict: true }),
  );
  app.use(express.json({ limit: '16kb', strict: true }));
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('GST Platform API')
      .setDescription(
        'Identity, tenant authorization, master data and ordinary invoice drafts/calculation/issuance/printing. E-invoicing and issued correction/cancellation remain gated.',
      )
      .setVersion('1')
      .addCookieAuth('__Host-gst_session')
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
