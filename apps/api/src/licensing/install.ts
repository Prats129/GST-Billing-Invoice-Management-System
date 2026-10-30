import {
  auditEvents,
  eq,
  organizationEntitlements,
  organizations,
} from '@gst/database';
import type { Database } from '@gst/database';
import { signedEntitlementSchema } from '@gst/contracts';
import type { Config } from '../config.js';
import {
  EntitlementError,
  entitlementStatus,
  verifyEntitlement,
} from './entitlement.js';
import type { EntitlementTrust } from './entitlement.js';

// Host/platform-operator only. Never route this through tenant RBAC or expose it
// as a tenant endpoint: the connection must have explicit grant-install rights.
export async function installEntitlement(
  database: Database,
  config: Config,
  trust: EntitlementTrust,
  value: unknown,
) {
  const grant = signedEntitlementSchema.parse(value);
  const claims = verifyEntitlement(grant, trust);
  return database.db.transaction(async (tx) => {
    const [org] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, claims.organizationId))
      .for('update');
    if (!org || org.edition !== config.DEPLOYMENT_EDITION)
      throw new EntitlementError();
    const [old] = await tx
      .select()
      .from(organizationEntitlements)
      .where(eq(organizationEntitlements.organizationId, org.id));
    const now = new Date();
    const status = entitlementStatus(claims, {
      organizationId: org.id,
      edition: config.DEPLOYMENT_EDITION,
      installationId:
        config.DEPLOYMENT_EDITION === 'offline'
          ? (config.OFFLINE_INSTALLATION_ID ?? null)
          : null,
      now,
      highestSequence: old?.highestSequence ?? 0,
      lastObservedAt: old?.lastObservedAt ?? new Date(0),
    });
    if (['wrong_binding', 'rollback', 'clock_rollback'].includes(status))
      throw new EntitlementError();
    if (old && claims.sequence === old.highestSequence) {
      if (
        JSON.stringify(signedEntitlementSchema.parse(old.signedGrant)) !==
        JSON.stringify(grant)
      )
        throw new EntitlementError();
      return { status, unchanged: true };
    }
    await tx
      .insert(organizationEntitlements)
      .values({
        organizationId: org.id,
        signedGrant: grant,
        highestSequence: claims.sequence,
        lastObservedAt: now,
      })
      .onConflictDoUpdate({
        target: organizationEntitlements.organizationId,
        set: {
          signedGrant: grant,
          highestSequence: claims.sequence,
          lastObservedAt: now,
          installedAt: now,
        },
      });
    await tx.insert(auditEvents).values({
      organizationId: org.id,
      actorId: null,
      action: 'entitlements.installed',
      targetId: claims.entitlementId,
      metadata: {
        kind: claims.kind,
        sequence: String(claims.sequence),
        status,
      },
    });
    return { status, unchanged: false };
  });
}
