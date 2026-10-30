import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { eq, organizationEntitlements } from '@gst/database';
import type { Permission, EntitlementInfo } from '@gst/contracts';
import type { Config } from '../config.js';
import type { Store } from '../security/types.js';
import { deny } from '../security/errors.js';
import {
  EntitlementError,
  entitlementStatus,
  loadEntitlementTrust,
  verifyEntitlement,
} from './entitlement.js';
import type { EntitlementTrust } from './entitlement.js';

export class EntitlementsService {
  readonly trust: EntitlementTrust | undefined;
  constructor(
    readonly config: Config,
    suppliedTrust?: EntitlementTrust,
  ) {
    this.trust = suppliedTrust;
    if (config.ENTITLEMENT_TRUST_FILE) {
      const path = config.ENTITLEMENT_TRUST_FILE;
      if (!isAbsolute(path) || statSync(path).size > 32768)
        throw new EntitlementError();
      this.trust = loadEntitlementTrust(JSON.parse(readFileSync(path, 'utf8')));
    }
  }
  async describe(tx: Store, orgId: string): Promise<EntitlementInfo> {
    if (!this.trust)
      return {
        status:
          this.config.NODE_ENV === 'production' ? 'missing' : 'development',
        kind: null,
        expiresAt: null,
      };
    const [row] = await tx
      .select()
      .from(organizationEntitlements)
      .where(eq(organizationEntitlements.organizationId, orgId));
    if (!row) return { status: 'missing', kind: null, expiresAt: null };
    try {
      const claims = verifyEntitlement(row.signedGrant, this.trust);
      return {
        status: entitlementStatus(claims, {
          organizationId: orgId,
          edition: this.config.DEPLOYMENT_EDITION,
          installationId:
            this.config.DEPLOYMENT_EDITION === 'offline'
              ? (this.config.OFFLINE_INSTALLATION_ID ?? null)
              : null,
          now: new Date(),
          highestSequence: row.highestSequence,
          lastObservedAt: row.lastObservedAt,
        }),
        kind: claims.kind,
        expiresAt: claims.expiresAt,
      };
    } catch {
      return { status: 'invalid', kind: null, expiresAt: null };
    }
  }
  async assertWritable(tx: Store, orgId: string, permission: Permission) {
    // Security administration remains available for revocation and recovery.
    // Read/preview/print access is still checked by existing RBAC independently.
    const businessWrite =
      permission === 'organization.manage' ||
      (/^(customers|catalog|invoices)\./.test(permission) &&
        !permission.endsWith('.read'));
    if (!businessWrite) return;
    if (!this.trust) {
      if (this.config.NODE_ENV === 'production') deny('ENTITLEMENT_READ_ONLY');
      return; // Explicitly unlicensed local development; never a production bypass.
    }
    const [row] = await tx
      .select()
      .from(organizationEntitlements)
      .where(eq(organizationEntitlements.organizationId, orgId));
    if (!row) deny('ENTITLEMENT_READ_ONLY');
    const now = new Date();
    try {
      const claims = verifyEntitlement(row.signedGrant, this.trust);
      if (
        entitlementStatus(claims, {
          organizationId: orgId,
          edition: this.config.DEPLOYMENT_EDITION,
          installationId:
            this.config.DEPLOYMENT_EDITION === 'offline'
              ? (this.config.OFFLINE_INSTALLATION_ID ?? null)
              : null,
          now,
          highestSequence: row.highestSequence,
          lastObservedAt: row.lastObservedAt,
        }) !== 'active'
      )
        deny('ENTITLEMENT_READ_ONLY');
    } catch {
      deny('ENTITLEMENT_READ_ONLY');
    }
    await tx
      .update(organizationEntitlements)
      .set({ lastObservedAt: now })
      .where(eq(organizationEntitlements.organizationId, orgId));
  }
}
