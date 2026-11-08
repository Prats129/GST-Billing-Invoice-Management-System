import type { WorkspaceSetup } from '@gst/contracts';
import {
  and,
  eq,
  isNull,
  customers,
  catalogItems,
  organizations,
} from '@gst/database';
import type { BusinessService } from './business.service.js';
import type { IdentitySession } from '../security/types.js';
import { issuanceBlockers } from '../invoicing/policy.js';

export async function workspaceSetup(
  service: BusinessService,
  session: IdentitySession,
  orgId: string,
): Promise<WorkspaceSetup> {
  const access = await service.organizations.access(
    session,
    orgId,
    'organization.read',
    service.db,
  );
  const profile = await service.profile(session, orgId);
  const permissions = access.permissions;
  const [customer, catalog] = await Promise.all([
    permissions.includes('customers.read')
      ? service.db
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.organizationId, orgId),
              isNull(customers.archivedAt),
            ),
          )
          .limit(1)
      : Promise.resolve(null),
    permissions.includes('catalog.read')
      ? service.db
          .select({ id: catalogItems.id })
          .from(catalogItems)
          .where(
            and(
              eq(catalogItems.organizationId, orgId),
              isNull(catalogItems.archivedAt),
            ),
          )
          .limit(1)
      : Promise.resolve(null),
  ]);
  const config = service.organizations.identity.config;
  const [organization] =
    access.isOwner &&
    config.DEPLOYMENT_EDITION === 'offline' &&
    config.OFFLINE_INSTALLATION_ID
      ? await service.db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, orgId))
      : [];
  const applicability = profile?.eInvoiceApplicability ?? 'unknown';
  const entitlement = await service.organizations.entitlements.describe(
    service.db,
    orgId,
  );
  return {
    checkedAt: new Date().toISOString(),
    businessConfigured: Boolean(profile),
    registrationConfirmed: profile?.registrationConfirmed ?? false,
    eInvoiceApplicability: applicability,
    issuanceBlockers: issuanceBlockers('invoice', applicability),
    customersPresent: customer === null ? null : customer.length > 0,
    catalogPresent: catalog === null ? null : catalog.length > 0,
    entitlement: {
      status: entitlement.status,
      businessWritesPaused: entitlement.businessWritesPaused ?? false,
    },
    offlineRegistration:
      organization && config.OFFLINE_INSTALLATION_ID
        ? {
            format: 'gst-offline-registration',
            version: 1,
            organizationId: orgId,
            installationId: config.OFFLINE_INSTALLATION_ID,
            name: organization.name,
          }
        : null,
  };
}
