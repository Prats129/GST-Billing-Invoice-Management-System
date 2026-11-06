import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger';
import {
  changePasswordSchema,
  appearanceSchema,
  loginSchema,
  memberInputSchema,
  memberUpdateSchema,
  mfaCodeSchema,
  ownerUpdateSchema,
  resetPasswordSchema,
  roleInputSchema,
  sessionInfoSchema,
} from '@gst/contracts';
import { z } from 'zod';
import type { Request, Response } from 'express';
import type { IdentityService } from './identity.service.js';
import type { OrganizationsService } from './organizations.service.js';
import { deny } from './errors.js';

export const SECURITY = Symbol('SECURITY');
export interface SecurityServices {
  identity: IdentityService;
  organizations: OrganizationsService;
}
export function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : deny('INVALID_INPUT');
}
export const uuid = (value: string) => input(z.string().uuid(), value);
export const contractBody = (schema: z.ZodType) =>
  ApiBody({
    schema: z.toJSONSchema(schema, {
      target: 'openapi-3.0',
      io: 'input',
      unrepresentable: 'any',
    }) as SchemaObject,
  });
export const contractResponse = (schema: z.ZodType, status = 200) =>
  ApiResponse({
    status,
    schema: z.toJSONSchema(schema, {
      target: 'openapi-3.0',
      unrepresentable: 'any',
    }) as SchemaObject,
  });
const proofSchema = z
  .object({
    password: z.string().min(1).max(128),
    code: z.string().trim().min(6).max(64),
  })
  .strict();
const offsetValue = (value: string | undefined) =>
  input(z.coerce.number().int().min(0).max(10000).default(0), value);
export function cookieName(identity: IdentityService) {
  return identity.config.TLS_KEY_PATH
    ? '__Host-gst_session'
    : 'gst_dev_session';
}
export function trustedCookieName(identity: IdentityService) {
  return identity.config.TLS_KEY_PATH
    ? '__Host-gst_trusted_device'
    : 'gst_dev_trusted_device';
}
export function readCookie(request: Request, name: string): string | undefined {
  const values = (request.headers.cookie ?? '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v.startsWith(`${name}=`));
  return values.length === 1 ? values[0]!.slice(name.length + 1) : undefined;
}
export class SecurityController {
  constructor(readonly services: SecurityServices | null) {}
  get security() {
    return this.services ?? deny('SECURITY_UNAVAILABLE');
  }
  get identity() {
    return this.security.identity;
  }
  async authenticated(req: Request, mutate = false) {
    const session = await this.identity.authenticate(
      readCookie(req, cookieName(this.identity)),
    );
    if (mutate) {
      if (req.headers.origin !== this.identity.config.APP_ORIGIN)
        deny('CSRF_INVALID');
      this.identity.verifyCsrf(session, req.get('x-csrf-token'));
      await this.identity.throttle(`mutation:${session.userId}`, 240);
    }
    return session;
  }
  setCookie(res: Response, raw: string) {
    res.cookie(cookieName(this.identity), raw, {
      httpOnly: true,
      secure: Boolean(this.identity.config.TLS_KEY_PATH),
      sameSite: 'strict',
      path: '/',
      maxAge: this.identity.config.SESSION_ABSOLUTE_MINUTES * 60000,
    });
    res.setHeader('Cache-Control', 'no-store');
  }
  clearCookie(res: Response) {
    res.clearCookie(cookieName(this.identity), {
      httpOnly: true,
      secure: Boolean(this.identity.config.TLS_KEY_PATH),
      sameSite: 'strict',
      path: '/',
    });
  }
  setTrustedCookie(
    res: Response,
    remembered: { token: string; expiresAt: Date },
  ) {
    res.cookie(trustedCookieName(this.identity), remembered.token, {
      httpOnly: true,
      secure: Boolean(this.identity.config.TLS_KEY_PATH),
      sameSite: 'strict',
      path: '/',
      expires: remembered.expiresAt,
    });
  }
  clearTrustedCookie(res: Response) {
    res.clearCookie(trustedCookieName(this.identity), {
      httpOnly: true,
      secure: Boolean(this.identity.config.TLS_KEY_PATH),
      sameSite: 'strict',
      path: '/',
    });
  }
}

@ApiTags('identity')
@ApiCookieAuth()
@ApiHeader({
  name: 'x-csrf-token',
  required: false,
  description:
    'Required with exact Origin on authenticated mutations. Obtain from GET /auth/session.',
})
@Controller('auth')
export class IdentityController extends SecurityController {
  constructor(@Inject(SECURITY) services: SecurityServices | null) {
    super(services);
  }
  @Post('login')
  @ApiOperation({
    summary:
      'Password authentication; fresh opaque cookie, MFA may still be required',
    security: [],
  })
  @contractBody(loginSchema)
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (req.headers.origin !== this.identity.config.APP_ORIGIN)
      deny('CSRF_INVALID');
    const data = input(loginSchema, body);
    const session = await this.identity.login(
      data.email,
      data.password,
      req.socket.remoteAddress ?? 'unknown',
      readCookie(req, cookieName(this.identity)),
      readCookie(req, trustedCookieName(this.identity)),
    );
    this.setCookie(res, session.token);
    if (session.remembered) this.setTrustedCookie(res, session.remembered);
    else this.clearTrustedCookie(res);
    return this.identity.sessionInfo(session);
  }
  @Get('session')
  @ApiResponse({
    status: 200,
    schema: z.toJSONSchema(sessionInfoSchema, {
      target: 'openapi-3.0',
    }) as SchemaObject,
  })
  async session(@Req() req: Request) {
    return this.identity.sessionInfo(await this.authenticated(req));
  }
  @Put('appearance')
  @ApiOperation({
    summary: 'Save appearance preferences for the signed-in user',
  })
  @contractBody(appearanceSchema)
  @contractResponse(appearanceSchema)
  async appearance(@Body() body: unknown, @Req() req: Request) {
    return this.identity.updateAppearance(
      await this.authenticated(req, true),
      input(appearanceSchema, body),
    );
  }
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.identity.revoke(await this.authenticated(req, true));
    this.clearCookie(res);
    return { ok: true };
  }
  @Post('logout-all')
  async logoutAll(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.identity.revoke(await this.authenticated(req, true), true);
    this.clearCookie(res);
    this.clearTrustedCookie(res);
    return { ok: true };
  }
  @Get('sessions')
  async sessions(@Req() req: Request) {
    return this.identity.listSessions(await this.authenticated(req));
  }
  @Get('trusted-devices')
  async trustedDevices(@Req() req: Request) {
    return this.identity.listTrustedDevices(await this.authenticated(req));
  }
  @Delete('trusted-devices/:id')
  async forgetDevice(@Param('id') id: string, @Req() req: Request) {
    await this.identity.forgetDevice(
      await this.authenticated(req, true),
      uuid(id),
    );
    return { ok: true };
  }
  @Delete('sessions/:id')
  async revokeSession(@Param('id') id: string, @Req() req: Request) {
    await this.identity.revoke(
      await this.authenticated(req, true),
      false,
      uuid(id),
    );
    return { ok: true };
  }
  @Post('password')
  @contractBody(changePasswordSchema)
  async password(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = input(changePasswordSchema, body);
    const session = await this.authenticated(req, true);
    const fresh = await this.identity.changePassword(
      session,
      data.currentPassword,
      data.newPassword,
      data.code,
    );
    this.setCookie(res, fresh.token);
    this.clearTrustedCookie(res);
    return this.identity.sessionInfo(fresh);
  }
  @Post('mfa/enroll')
  @contractBody(z.object({ password: z.string().min(1).max(128) }).strict())
  async enroll(@Body() body: unknown, @Req() req: Request) {
    const data = input(
      z.object({ password: z.string().min(1).max(128) }).strict(),
      body,
    );
    return this.identity.enrollMfa(
      await this.authenticated(req, true),
      data.password,
    );
  }
  @Post('mfa/confirm')
  @contractBody(mfaCodeSchema)
  async confirm(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.mfa(body, req, res, true);
  }
  @Post('mfa/verify')
  @contractBody(mfaCodeSchema)
  async verify(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.mfa(body, req, res, false);
  }
  @Post('mfa/disable')
  @contractBody(proofSchema)
  async disable(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.manage(body, req, res, true);
  }
  @Post('mfa/recovery-codes')
  @contractBody(proofSchema)
  async recoveryCodes(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.manage(body, req, res, false);
  }
  private async manage(
    body: unknown,
    req: Request,
    res: Response,
    disable: boolean,
  ) {
    const data = input(
      z
        .object({
          password: z.string().min(1).max(128),
          code: z.string().trim().min(6).max(64),
        })
        .strict(),
      body,
    );
    const result = await this.identity.manageMfa(
      await this.authenticated(req, true),
      data.password,
      data.code,
      disable,
    );
    this.setCookie(res, result.session.token);
    this.clearTrustedCookie(res);
    return {
      ...(await this.identity.sessionInfo(result.session)),
      recoveryCodes: result.recoveryCodes,
    };
  }
  private async mfa(
    body: unknown,
    req: Request,
    res: Response,
    confirm: boolean,
  ) {
    const data = input(mfaCodeSchema, body);
    const result = await this.identity.verifyMfa(
      await this.authenticated(req, true),
      data.code,
      confirm,
      data.rememberDevice,
      readCookie(req, trustedCookieName(this.identity)),
    );
    this.setCookie(res, result.session.token);
    if (result.remembered) this.setTrustedCookie(res, result.remembered);
    return {
      ...(await this.identity.sessionInfo(result.session)),
      recoveryCodes: result.recoveryCodes,
    };
  }
}

@ApiTags('organizations and authorization')
@ApiCookieAuth()
@ApiHeader({
  name: 'x-csrf-token',
  required: false,
  description: 'Required on mutations, with exact Origin.',
})
@Controller('organizations')
export class OrganizationsController extends SecurityController {
  constructor(@Inject(SECURITY) services: SecurityServices | null) {
    super(services);
  }
  @Get()
  async list(@Req() req: Request) {
    return this.security.organizations.list(await this.authenticated(req));
  }
  @Get('invitations')
  async invitations(@Req() req: Request) {
    return this.security.organizations.invitations(
      await this.authenticated(req),
    );
  }
  @Post('invitations/:id/accept')
  async accept(@Param('id') id: string, @Req() req: Request) {
    return this.security.organizations.acceptInvitation(
      await this.authenticated(req, true),
      uuid(id),
    );
  }
  @Get(':orgId')
  async details(@Param('orgId') orgId: string, @Req() req: Request) {
    return this.security.organizations.details(
      await this.authenticated(req),
      uuid(orgId),
    );
  }
  @Get(':orgId/roles')
  async roles(
    @Param('orgId') orgId: string,
    @Query('offset') offset: string | undefined,
    @Req() req: Request,
  ) {
    return this.security.organizations.listRoles(
      await this.authenticated(req),
      uuid(orgId),
      offsetValue(offset),
    );
  }
  @Post(':orgId/roles')
  @contractBody(roleInputSchema)
  async createRole(
    @Param('orgId') orgId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.security.organizations.saveRole(
      await this.authenticated(req, true),
      uuid(orgId),
      input(roleInputSchema, body),
    );
  }
  @Put(':orgId/roles/:id')
  @contractBody(roleInputSchema)
  async updateRole(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.security.organizations.saveRole(
      await this.authenticated(req, true),
      uuid(orgId),
      input(roleInputSchema, body),
      uuid(id),
    );
  }
  @Delete(':orgId/roles/:id')
  async deleteRole(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.security.organizations.deleteRole(
      await this.authenticated(req, true),
      uuid(orgId),
      uuid(id),
    );
  }
  @Get(':orgId/members')
  async members(
    @Param('orgId') orgId: string,
    @Query('offset') offset: string | undefined,
    @Req() req: Request,
  ) {
    return this.security.organizations.listMembers(
      await this.authenticated(req),
      uuid(orgId),
      offsetValue(offset),
    );
  }
  @Post(':orgId/members')
  @contractBody(memberInputSchema)
  async addMember(
    @Param('orgId') orgId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.security.organizations.addMember(
      await this.authenticated(req, true),
      uuid(orgId),
      input(memberInputSchema, body),
    );
  }
  @Put(':orgId/members/:id')
  @contractBody(memberUpdateSchema)
  async updateMember(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.security.organizations.updateMember(
      await this.authenticated(req, true),
      uuid(orgId),
      uuid(id),
      input(memberUpdateSchema, body),
    );
  }
  @Put(':orgId/members/:id/owner')
  @contractBody(ownerUpdateSchema)
  async owner(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.security.organizations.setOwner(
      await this.authenticated(req, true),
      uuid(orgId),
      uuid(id),
      input(ownerUpdateSchema, body).isOwner,
    );
  }
  @Post(':orgId/members/:id/password')
  @contractBody(resetPasswordSchema)
  async reset(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.security.organizations.resetPassword(
      await this.authenticated(req, true),
      uuid(orgId),
      uuid(id),
      input(resetPasswordSchema, body).temporaryPassword,
    );
  }
  @Delete(':orgId/members/:id')
  async removeMember(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.security.organizations.removeMember(
      await this.authenticated(req, true),
      uuid(orgId),
      uuid(id),
    );
  }
  @Get(':orgId/audit')
  async audit(
    @Param('orgId') orgId: string,
    @Query('offset') offset: string | undefined,
    @Req() req: Request,
  ) {
    return this.security.organizations.auditLog(
      await this.authenticated(req),
      uuid(orgId),
      offsetValue(offset),
    );
  }
}
