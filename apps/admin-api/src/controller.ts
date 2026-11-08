import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Req,
  Res,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiResponse } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { token, digest, hashPassword, csrfToken } from '@gst/security';
import * as c from '@gst/contracts/platform';
import type { PlatformAuth } from './auth.js';
import { lockPlatformSession } from './auth.js';
import type { PlatformService } from './service.js';
import { rows, transaction, audit } from './store.js';
import { fail } from './errors.js';
import { diagnosePlatform } from './diagnostics.js';
import type { Operations } from './operations.js';
const bodyContract = (schema: z.ZodType) =>
  ApiBody({
    schema: z.toJSONSchema(schema, {
      target: 'openapi-3.0',
      unrepresentable: 'any',
    }) as SchemaObject,
  });
const responseContract = (schema: z.ZodType) =>
  ApiResponse({
    status: 200,
    schema: z.toJSONSchema(schema, {
      target: 'openapi-3.0',
      unrepresentable: 'any',
    }) as SchemaObject,
  });
export const PLATFORM = Symbol('PLATFORM');
export interface Services {
  auth: PlatformAuth;
  service: PlatformService;
  operations: Operations;
}
@ApiTags('platform')
@Controller()
export class PlatformController {
  constructor(@Inject(PLATFORM) readonly services: Services) {}
  get cookie() {
    return this.services.auth.config.PLATFORM_TLS_KEY
      ? '__Host-gst_admin_session'
      : 'gst_admin_dev_session';
  }
  raw(req: Request) {
    const values = (req.headers.cookie ?? '')
      .split(';')
      .map((v) => v.trim())
      .filter((v) => v.startsWith(this.cookie + '='));
    return values.length === 1
      ? values[0]!.slice(this.cookie.length + 1)
      : undefined;
  }
  async auth(req: Request, mutate = false, full = true) {
    const a = this.services.auth;
    if (mutate && req.headers.origin !== a.config.PLATFORM_ORIGIN)
      fail('CSRF_INVALID', 403);
    const s = await a.session(this.raw(req), req.get('x-csrf-token'), mutate);
    if (full) await a.full(s);
    return s;
  }
  @Get('health') health() {
    return { status: 'ok', service: 'gst-platform' };
  }
  @Get('ready') async ready() {
    await this.services.auth.db.query('SELECT id FROM platform_owner LIMIT 0');
    return { status: 'ready' };
  }
  @bodyContract(c.platformLogin)
  @Post('auth/login')
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    if (req.headers.origin !== this.services.auth.config.PLATFORM_ORIGIN)
      fail('CSRF_INVALID', 403);
    const b = c.platformLogin.parse(body);
    const raw = await this.services.auth.login(
      b.email,
      b.password,
      req.socket.remoteAddress ?? 'unknown',
    );
    res.cookie(this.cookie, raw, {
      httpOnly: true,
      secure: Boolean(this.services.auth.config.PLATFORM_TLS_KEY),
      sameSite: 'strict',
      path: '/',
      maxAge: 12 * 3600000,
    });
    return this.services.auth.info(await this.services.auth.session(raw), raw);
  }
  @responseContract(c.platformSession)
  @Get('auth/session')
  async session(@Req() req: Request) {
    return this.services.auth.info(
      await this.auth(req, false, false),
      this.raw(req)!,
    );
  }
  @Post('auth/logout') async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const s = await this.auth(req, true, false);
    await this.services.auth.db.query(
      'DELETE FROM platform_sessions WHERE token_hash=$1',
      [s.token_hash],
    );
    res.clearCookie(this.cookie, {
      httpOnly: true,
      secure: Boolean(this.services.auth.config.PLATFORM_TLS_KEY),
      sameSite: 'strict',
      path: '/',
    });
    return { ok: true };
  }
  @Post('auth/mfa/setup') async setup(@Req() req: Request) {
    return this.services.auth.setup(await this.auth(req, true, false));
  }
  private proofResponse(
    res: Response,
    result: { raw: string; recoveryCodes: string[] },
  ) {
    res.cookie(this.cookie, result.raw, {
      httpOnly: true,
      secure: Boolean(this.services.auth.config.PLATFORM_TLS_KEY),
      sameSite: 'strict',
      path: '/',
      maxAge: 12 * 3600000,
    });
    return {
      recoveryCodes: result.recoveryCodes,
      csrfToken: csrfToken(result.raw),
    };
  }
  @bodyContract(c.platformCode)
  @Post('auth/mfa/enroll')
  async enroll(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    return this.proofResponse(
      res,
      await this.services.auth.verify(
        await this.auth(req, true, false),
        c.platformCode.parse(body).code,
        true,
      ),
    );
  }
  @bodyContract(c.platformCode)
  @Post('auth/mfa/verify')
  async verify(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    return this.proofResponse(
      res,
      await this.services.auth.verify(
        await this.auth(req, true, false),
        c.platformCode.parse(body).code,
      ),
    );
  }
  @bodyContract(c.platformProof)
  @Post('auth/confirm')
  async confirm(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const s = await this.auth(req, true),
      b = c.platformProof.parse(body);
    return this.proofResponse(
      res,
      await this.services.auth.reauthenticate(s, b.password, b.code),
    );
  }
  @bodyContract(c.platformPassword)
  @Post('auth/password')
  async password(@Req() req: Request, @Body() body: unknown) {
    await this.services.auth.changePassword(
      await this.auth(req, true),
      c.platformPassword.parse(body).password,
    );
    return { ok: true };
  }
  @Get('auth/sessions') async sessions(@Req() req: Request) {
    const s = await this.auth(req);
    return rows(
      this.services.auth.db,
      'SELECT token_hash=$1 AS current,expires_at,last_seen_at,mfa_verified FROM platform_sessions ORDER BY last_seen_at DESC LIMIT 50',
      [s.token_hash],
    );
  }
  @Post('auth/revoke-others') async revoke(@Req() req: Request) {
    const s = await this.auth(req, true);
    await this.services.auth.recent(s);
    await transaction(this.services.auth.db, async (tx) => {
      await lockPlatformSession(tx, s, true);
      await tx.query('DELETE FROM platform_sessions WHERE token_hash<>$1', [
        s.token_hash,
      ]);
      await audit(tx, s.owner_id, 'owner.sessions_revoked');
    });
    return { ok: true };
  }
  @Get('overview') async overview(@Req() req: Request) {
    await this.auth(req);
    return this.services.service.overview();
  }
  @responseContract(c.platformDirectory)
  @Get('organizations')
  async organizations(@Req() req: Request, @Query() q: Record<string, string>) {
    await this.auth(req);
    const b = z
      .object({
        q: z.string().max(80).default(''),
        edition: z.enum(['', 'saas', 'offline']).default(''),
        state: z.enum(['', 'pending', 'registered', 'archived']).default(''),
        offset: z.coerce.number().int().min(0).max(10000).default(0),
      })
      .parse(q);
    const list = await this.services.service.directory(
      b.q,
      b.edition,
      b.state,
      b.offset,
    );
    return { items: list.slice(0, 50), hasMore: list.length > 50 };
  }
  @responseContract(c.platformDetail)
  @Get('organizations/:id')
  async detail(@Req() req: Request, @Param('id') id: string) {
    await this.auth(req);
    return this.services.service.details(z.string().uuid().parse(id));
  }
  @bodyContract(c.platformOrganization)
  @Post('organizations')
  async create(@Req() req: Request, @Body() body: unknown) {
    const s = await this.auth(req, true);
    const b = c.platformOrganization.parse(body);
    let verified: { name: string } | undefined;
    if (b.edition === 'saas' && b.mode === 'link')
      verified = await this.services.operations.lookup(b.runtimeId!);
    return this.services.service.mutate(
      s,
      'organizations.create',
      b.requestKey,
      b,
      null,
      async (tx) => {
        const id = randomUUID(),
          runtime = b.runtimeId ?? randomUUID();
        await tx.query(
          'INSERT INTO platform_organizations(id,runtime_id,edition,installation_id,name,email,contact_name,phone,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            id,
            runtime,
            b.edition,
            b.installationId ?? null,
            verified?.name ?? b.name,
            b.email,
            b.contactName,
            b.phone,
            b.mode === 'create' ? 'pending' : 'registered',
          ],
        );
        if (b.mode === 'create') {
          await this.services.service.queue(tx, id, 'provision', {
            runtimeId: runtime,
            name: b.name,
            email: b.email,
            contactName: b.contactName || b.name.slice(0, 120),
            passwordHash: await hashPassword(token()),
          });
        }
        await audit(tx, s.owner_id, 'organization.registered', id, id);
        return { id };
      },
    );
  }
  @bodyContract(c.platformContact)
  @Put('organizations/:id')
  async contact(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const s = await this.auth(req, true),
      b = c.platformContact.parse(body);
    return this.services.service.mutate(
      s,
      'organizations.contact',
      b.requestKey,
      b,
      id,
      async (tx) => {
        const o = await this.services.service.organization(tx, id, true);
        if (o.version !== b.version || o.state === 'pending')
          fail('VERSION_CONFLICT');
        await tx.query(
          'UPDATE platform_organizations SET name=$2,email=$3,contact_name=$4,phone=$5,state=$6,version=version+1 WHERE id=$1',
          [id, b.name, b.email, b.contactName, b.phone, b.state],
        );
        return { ok: true };
      },
    );
  }
  @Post('organizations/:id/check') async checkHosted(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const s = await this.auth(req, true);
    const o = await this.services.service.organization(
      this.services.auth.db,
      id,
    );
    if (o.edition !== 'saas') fail('ONLINE_ONLY');
    const observed = await this.services.operations.lookup(o.runtime_id);
    await transaction(this.services.auth.db, async (tx) => {
      await tx.query(
        'INSERT INTO platform_observations(organization_id,value) VALUES($1,$2) ON CONFLICT(organization_id) DO UPDATE SET value=excluded.value,observed_at=now()',
        [id, observed],
      );
      if (observed.setupComplete)
        await tx.query(
          "UPDATE platform_organizations SET state='registered',version=version+1 WHERE id=$1 AND state='pending'",
          [id],
        );
      await audit(tx, s.owner_id, 'organization.checked', id, id);
    });
    return observed;
  }
  @bodyContract(c.platformKey)
  @Post('organizations/:id/setup-link')
  async link(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const s = await this.auth(req, true);
    await this.services.auth.recent(s);
    const b = c.platformKey.parse(body);
    const raw = token();
    let created = false;
    const result = await this.services.service.mutate(
      s,
      'setup.link',
      b.requestKey,
      b,
      id,
      async (tx) => {
        created = true;
        const o = await this.services.service.organization(tx, id, true);
        if (o.edition !== 'saas') fail('ONLINE_ONLY');
        return this.services.service.queue(tx, id, 'setup_link', {
          runtimeId: o.runtime_id,
          tokenHash: digest(raw),
        });
      },
    );
    if (!created)
      fail(
        'SETUP_LINK_REISSUE_REQUIRED',
        409,
        'Generate a new setup link; the previous secret cannot be recovered.',
      );
    const outcome = await this.services.operations.execute(result.operationId);
    if (!outcome || outcome.state !== 'completed')
      return { ...result, state: outcome?.state ?? 'pending' };
    return {
      ...result,
      url: this.services.operations.origin() + '/#/owner-setup/' + raw,
      expiresInHours: 24,
    };
  }
  @bodyContract(c.platformAgreement)
  @Post('organizations/:id/agreements')
  async agreement(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const s = await this.auth(req, true),
      b = c.platformAgreement.parse(body);
    return this.services.service.mutate(
      s,
      'agreement.create',
      b.requestKey,
      b,
      id,
      async (tx) => {
        const o = await this.services.service.organization(tx, id, true);
        if (
          (b.kind === 'perpetual' || b.kind === 'maintenance') &&
          o.edition !== 'offline'
        )
          fail('OFFLINE_ONLY');
        const agreementId = randomUUID();
        await tx.query(
          'INSERT INTO platform_agreements(id,organization_id,kind,starts_at,ends_at,due_date,total_paise,reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            agreementId,
            id,
            b.kind,
            b.startsAt,
            b.endsAt,
            b.dueDate,
            b.totalPaise,
            b.reference,
          ],
        );
        return { id: agreementId };
      },
    );
  }
  @bodyContract(c.platformReason)
  @Post('organizations/:id/agreements/:agreement/void')
  async voidAgreement(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('agreement') agreement: string,
    @Body() body: unknown,
  ) {
    const s = await this.auth(req, true),
      b = c.platformReason.parse(body);
    return this.services.service.mutate(
      s,
      'agreement.void',
      b.requestKey,
      { ...b, agreement },
      id,
      async (tx) => {
        await this.services.service.organization(tx, id);
        const [a] = await rows<{ version: number }>(
          tx,
          "SELECT version FROM platform_agreements WHERE id=$1 AND organization_id=$2 AND state='active' FOR UPDATE",
          [z.string().uuid().parse(agreement), id],
        );
        if (!a || a.version !== b.version) fail('VERSION_CONFLICT');
        const [paid] = await rows<{ value: string }>(
          tx,
          'SELECT coalesce((SELECT sum(amount_paise) FROM platform_receipts WHERE agreement_id=$1),0)-coalesce((SELECT sum(amount_paise) FROM platform_adjustments WHERE agreement_id=$1),0) AS value',
          [agreement],
        );
        if (BigInt(paid?.value ?? 0) !== 0n) fail('REVERSE_RECEIPTS_FIRST');
        await tx.query(
          "UPDATE platform_agreements SET state='void',version=version+1 WHERE id=$1",
          [agreement],
        );
        await audit(tx, s.owner_id, 'agreement.voided', id, agreement, {
          reason: b.reason,
        });
        return { ok: true };
      },
    );
  }
  @bodyContract(c.platformReceipt)
  @Post('organizations/:id/receipts')
  async receipt(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const s = await this.auth(req, true),
      b = c.platformReceipt.parse(body);
    return this.services.service.mutate(
      s,
      'receipt.create',
      b.requestKey,
      b,
      id,
      (tx) => this.services.service.receipt(tx, id, b),
    );
  }
  @bodyContract(c.platformAdjustment)
  @Post('organizations/:id/adjustments')
  async adjustment(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const s = await this.auth(req, true),
      b = c.platformAdjustment.parse(body);
    return this.services.service.mutate(
      s,
      'receipt.adjust',
      b.requestKey,
      b,
      id,
      (tx) => this.services.service.adjustment(tx, id, b),
    );
  }
  @bodyContract(c.platformLicenseRequest)
  @Post('organizations/:id/license-requests')
  async request(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const s = await this.auth(req, true),
      b = c.platformLicenseRequest.parse(body);
    return this.services.service.mutate(
      s,
      'license.request',
      b.requestKey,
      b,
      id,
      (tx) => this.services.service.licenseRequest(tx, id, b.claims),
    );
  }
  @bodyContract(c.platformGrantImport)
  @Post('organizations/:id/grants')
  async grant(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const s = await this.auth(req, true),
      b = c.platformGrantImport.parse(body);
    return this.services.service.mutate(
      s,
      'license.import',
      b.requestKey,
      b,
      id,
      (tx) => this.services.service.importGrants(tx, id, b.grants, b.requestId),
    );
  }
  @Get('organizations/:id/grants/:grant') async download(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('grant') grant: string,
  ) {
    await this.auth(req);
    return this.services.service.download(id, grant);
  }
  @bodyContract(c.platformApply)
  @Post('organizations/:id/apply')
  async apply(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const s = await this.auth(req, true);
    await this.services.auth.recent(s);
    const b = c.platformApply.parse(body);
    const envelope = await this.services.service.download(id, b.grantId);
    return this.services.service.mutate(
      s,
      'license.apply',
      b.requestKey,
      b,
      id,
      async (tx) => {
        const o = await this.services.service.organization(tx, id, true);
        if (o.edition !== 'saas') fail('ONLINE_ONLY');
        const head = await this.services.service.head(tx, id);
        if (!head || head.claims.entitlementId !== b.grantId)
          fail('LATEST_GRANT_REQUIRED');
        return this.services.service.queue(tx, id, 'install_grant', {
          runtimeId: o.runtime_id,
          envelope,
        });
      },
    );
  }
  @bodyContract(c.platformPause)
  @Post('organizations/:id/pause')
  async pause(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const s = await this.auth(req, true);
    await this.services.auth.recent(s);
    const b = c.platformPause.parse(body);
    return this.services.service.mutate(
      s,
      'writes.pause',
      b.requestKey,
      b,
      id,
      async (tx) => {
        const o = await this.services.service.organization(tx, id, true);
        if (o.edition !== 'saas') fail('ONLINE_ONLY');
        return this.services.service.queue(tx, id, 'pause', {
          runtimeId: o.runtime_id,
          paused: b.paused,
          reason: b.reason,
        });
      },
    );
  }
  @bodyContract(c.platformDelivery)
  @Post('organizations/:id/delivery')
  async delivery(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const s = await this.auth(req, true),
      b = c.platformDelivery.parse(body);
    return this.services.service.mutate(
      s,
      'license.delivery',
      b.requestKey,
      b,
      id,
      async (tx) => {
        const o = await this.services.service.organization(tx, id);
        if (o.edition !== 'offline') fail('OFFLINE_ONLY');
        await tx.query(
          'INSERT INTO platform_delivery(id,organization_id,grant_id,state,note) VALUES($1,$2,$3,$4,$5)',
          [randomUUID(), id, b.grantId, b.state, b.note],
        );
        return { ok: true };
      },
    );
  }
  @Get('operations/search')
  @responseContract(c.platformOperationPage)
  async searchOperations(@Req() req: Request, @Query() query: unknown) {
    await this.auth(req);
    const b = c.platformOperationQuery.parse(query);
    const items = await rows(
      this.services.auth.db,
      `SELECT id,organization_id,kind,state,attempts,error_code,result,created_at,completed_at FROM platform_operations
       WHERE ($1='' OR state=$1) AND ($2='' OR kind=$2) AND ($3='' OR organization_id::text=$3) AND ($4='' OR id::text LIKE '%'||$4||'%')
       ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET $5`,
      [
        b.state,
        b.kind,
        b.organizationId.toLowerCase(),
        b.q.toLowerCase(),
        b.offset,
      ],
    );
    return { items: items.slice(0, 50), hasMore: items.length > 50 };
  }
  @Get('operations/:id')
  @responseContract(c.platformOperationView)
  async operation(@Req() req: Request, @Param('id') id: string) {
    await this.auth(req);
    const [operation] = await rows(
      this.services.auth.db,
      'SELECT id,organization_id,kind,state,attempts,error_code,result,created_at,completed_at FROM platform_operations WHERE id=$1',
      [z.string().uuid().parse(id)],
    );
    if (!operation) fail('NOT_FOUND', 404);
    return operation;
  }
  @Get('operations') async operations(@Req() req: Request) {
    await this.auth(req);
    return rows(
      this.services.auth.db,
      'SELECT id,organization_id,kind,state,attempts,error_code,result,created_at,completed_at FROM platform_operations ORDER BY created_at DESC LIMIT 100',
    );
  }
  @Post('operations/:id/retry') async retry(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const s = await this.auth(req, true);
    await this.services.auth.recent(s);
    await transaction(this.services.auth.db, async (tx) => {
      await lockPlatformSession(tx, s, true);
      await tx.query(
        "UPDATE platform_operations SET state='pending',next_attempt_at=now() WHERE id=$1 AND state='retryable'",
        [z.string().uuid().parse(id)],
      );
      await audit(tx, s.owner_id, 'operation.retry', null, id);
    });
    return { ok: true };
  }
  @Get('diagnostics')
  @ApiOperation({ summary: 'Read-only operational prerequisite checks' })
  @responseContract(c.platformDiagnostics)
  async diagnostics(@Req() req: Request) {
    await this.auth(req);
    return diagnosePlatform(
      this.services.auth.db,
      this.services.operations,
      this.services.service.trust.size > 0,
    );
  }
  @Get('configuration')
  @ApiOperation({
    summary: 'Non-secret configured capabilities; no signing keys are loaded',
  })
  async capabilities(@Req() req: Request) {
    await this.auth(req);
    return {
      saasConnected: Boolean(this.services.operations.operator),
      trustConfigured: this.services.service.trust.size > 0,
    };
  }
}
