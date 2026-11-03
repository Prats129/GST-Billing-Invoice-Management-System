import {
  eq,
  organizationEntitlements,
  organizations,
  sql,
} from '@gst/database';
import type { Database } from '@gst/database';
import { z } from 'zod';
import {
  entitlementStatus,
  verifyEntitlement,
} from '../licensing/entitlement.js';
import type { EntitlementTrust } from '../licensing/entitlement.js';

export class UpdateEligibilityError extends Error {
  constructor() {
    super(
      'Offline update requires current maintenance for every organization.',
    );
  }
}

export interface UpdateOrganization {
  id: string;
  edition: string;
  entitlement: {
    signedGrant: unknown;
    highestSequence: number;
    lastObservedAt: Date;
  } | null;
}

// No development bypass, archived-organization exclusion or caller-selected tenant.
// This is a point-in-time prerequisite, never a durable installation permission.
export function assertUpdateEligibility(
  rows: readonly UpdateOrganization[],
  trust: EntitlementTrust,
  installationId: string,
  now: Date,
): void {
  try {
    z.string().uuid().parse(installationId);
    if (!rows.length || !Number.isFinite(now.getTime())) throw new Error();
    const seen = new Set<string>();
    for (const row of rows) {
      z.string().uuid().parse(row.id);
      if (seen.has(row.id) || row.edition !== 'offline' || !row.entitlement)
        throw new Error();
      seen.add(row.id);
      const grant = row.entitlement;
      if (!Number.isInteger(grant.highestSequence) || grant.highestSequence < 1)
        throw new Error();
      const claims = verifyEntitlement(grant.signedGrant, trust);
      if (
        claims.sequence !== grant.highestSequence ||
        entitlementStatus(claims, {
          organizationId: row.id,
          edition: 'offline',
          installationId,
          highestSequence: grant.highestSequence,
          lastObservedAt: grant.lastObservedAt,
          now,
        }) !== 'active' ||
        !claims.maintenanceUntil ||
        now.getTime() >= Date.parse(claims.maintenanceUntil)
      )
        throw new Error();
    }
  } catch {
    throw new UpdateEligibilityError();
  }
}

export async function checkOfflineUpdateEligibility(
  database: Database,
  trust: EntitlementTrust,
  installationId: string,
) {
  return database.db.transaction(
    async (tx) => {
      // Error rather than silently inspecting an RLS-filtered tenant subset.
      await tx.execute(sql`SET LOCAL row_security = off`);
      const rows = await tx
        .select({
          id: organizations.id,
          edition: organizations.edition,
          entitlement: {
            signedGrant: organizationEntitlements.signedGrant,
            highestSequence: organizationEntitlements.highestSequence,
            lastObservedAt: organizationEntitlements.lastObservedAt,
          },
        })
        .from(organizations)
        .leftJoin(
          organizationEntitlements,
          eq(organizationEntitlements.organizationId, organizations.id),
        );
      // Sample after reading: time spent querying must not extend maintenance.
      const now = new Date();
      assertUpdateEligibility(rows, trust, installationId, now);
      return { organizations: rows.length, checkedAt: now.toISOString() };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
