import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { passwordSchema } from '@gst/contracts';
import {
  and,
  eq,
  gt,
  isNull,
  ownerSetupTokens,
  organizations,
  users,
  memberships,
  sessions,
} from '@gst/database';
import { digest } from './crypto.js';
import {
  SECURITY,
  SecurityController,
  input as parseInput,
} from './controllers.js';
import type { SecurityServices } from './controllers.js';
import { deny } from './errors.js';
const setupSchema = z
  .object({
    token: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
    password: passwordSchema.optional(),
  })
  .strict();
@Controller('owner-setup')
export class OwnerSetupController extends SecurityController {
  constructor(@Inject(SECURITY) services: SecurityServices | null) {
    super(services);
  }
  private async checkRequest(req: Request) {
    if (this.identity.config.DEPLOYMENT_EDITION !== 'saas') deny('NOT_FOUND');
    if (req.headers.origin !== this.identity.config.APP_ORIGIN)
      deny('CSRF_INVALID');
    await this.identity.throttle('owner-setup:' + req.socket.remoteAddress, 30);
  }
  @Post('check') async check(@Req() req: Request, @Body() body: unknown) {
    await this.checkRequest(req);
    const b = parseInput(setupSchema, body);
    const [s] = await this.identity.db
      .select({ token: ownerSetupTokens, user: users })
      .from(ownerSetupTokens)
      .innerJoin(users, eq(users.id, ownerSetupTokens.userId))
      .where(
        and(
          eq(ownerSetupTokens.tokenHash, digest(b.token)),
          gt(ownerSetupTokens.expiresAt, new Date()),
          isNull(ownerSetupTokens.acceptedAt),
        ),
      );
    if (!s) deny('NOT_FOUND');
    return {
      newAccount: Boolean(
        s.token.initialPasswordHash &&
        s.token.initialPasswordHash === s.user.passwordHash,
      ),
    };
  }
  @Post('complete') async complete(@Req() req: Request, @Body() body: unknown) {
    await this.checkRequest(req);
    const b = parseInput(setupSchema, body);
    const [found] = await this.identity.db
      .select()
      .from(ownerSetupTokens)
      .where(eq(ownerSetupTokens.tokenHash, digest(b.token)));
    if (!found) deny('NOT_FOUND');
    return this.identity.db.transaction(async (tx) => {
      await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, found.organizationId))
        .for('update');
      const [s] = await tx
        .select()
        .from(ownerSetupTokens)
        .where(
          and(
            eq(ownerSetupTokens.organizationId, found.organizationId),
            eq(ownerSetupTokens.tokenHash, digest(b.token)),
            gt(ownerSetupTokens.expiresAt, new Date()),
            isNull(ownerSetupTokens.acceptedAt),
          ),
        )
        .for('update');
      if (!s) deny('NOT_FOUND');
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, s.userId))
        .for('update');
      if (!user || user.status !== 'active') deny('FORBIDDEN');
      if (
        s.initialPasswordHash &&
        user.passwordHash === s.initialPasswordHash
      ) {
        if (!b.password) deny('INVALID_INPUT');
        const { hashPassword } = await import('./crypto.js');
        await tx
          .update(users)
          .set({
            passwordHash: await hashPassword(b.password),
            mustChangePassword: false,
          })
          .where(eq(users.id, user.id));
        await tx.delete(sessions).where(eq(sessions.userId, user.id));
      } else {
        const session = await this.authenticated(req, true);
        await this.identity.full(session, tx);
        if (session.userId !== s.userId) deny('FORBIDDEN');
      }
      await tx
        .update(ownerSetupTokens)
        .set({ acceptedAt: new Date(), initialPasswordHash: null })
        .where(eq(ownerSetupTokens.organizationId, s.organizationId));
      await tx
        .update(memberships)
        .set({ acceptedAt: new Date() })
        .where(
          and(
            eq(memberships.organizationId, s.organizationId),
            eq(memberships.userId, s.userId),
          ),
        );
      await this.identity.audit(
        tx,
        user.id,
        'organization.owner_setup_completed',
        s.organizationId,
        s.organizationId,
      );
      return { ok: true };
    });
  }
}
