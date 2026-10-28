import {
  businessProfileViewSchema,
  customerViewSchema,
  catalogViewSchema,
  taxRevisionViewSchema,
} from '@gst/contracts';
import type {
  BusinessProfileInput,
  CustomerInput,
  CatalogInput,
  CatalogView,
  DirectoryQuery,
} from '@gst/contracts';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  isNotNull,
  or,
  sql,
  businessProfiles,
  gstRegistrations,
  customers,
  catalogItems,
  catalogTaxRevisions,
  catalogTaxReviews,
} from '@gst/database';
import type { Database, DatabaseTransaction } from '@gst/database';
import type { IdentitySession, Store } from '../security/types.js';
import type { OrganizationsService } from '../security/organizations.service.js';
import { deny } from '../security/errors.js';

const customerView = (row: typeof customers.$inferSelect) =>
  customerViewSchema.parse({
    ...row,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  });
const pattern = (query: string) => `%${query.replace(/[\\%_]/g, '\\$&')}%`;
const versionCheck = (expected: number, current: number) => {
  if (expected !== current) deny('VERSION_CONFLICT');
};

export class BusinessService {
  constructor(readonly organizations: OrganizationsService) {}
  get db(): Database['db'] {
    return this.organizations.db;
  }
  async profile(session: IdentitySession, orgId: string) {
    await this.organizations.access(
      session,
      orgId,
      'organization.read',
      this.db,
    );
    return this.readProfile(this.db, orgId);
  }
  private async readProfile(db: Store, orgId: string) {
    const [row] = await db
      .select({ profile: businessProfiles, registration: gstRegistrations })
      .from(businessProfiles)
      .innerJoin(
        gstRegistrations,
        and(
          eq(gstRegistrations.organizationId, businessProfiles.organizationId),
          eq(gstRegistrations.active, true),
        ),
      )
      .where(eq(businessProfiles.organizationId, orgId));
    if (!row) return null;
    const { profile, registration } = row;
    return businessProfileViewSchema.parse({
      ...profile,
      gstin: registration.gstin,
      taxpayerType: registration.taxpayerType,
      registrationConfirmed: Boolean(registration.confirmedAt),
      registrationConfirmedAt: registration.confirmedAt?.toISOString() ?? null,
      registrationId: registration.id,
      updatedAt: profile.updatedAt.toISOString(),
    });
  }
  async saveProfile(
    session: IdentitySession,
    orgId: string,
    data: BusinessProfileInput,
  ) {
    return this.organizations.write(
      session,
      orgId,
      'organization.manage',
      async (tx) => {
        const [old] = await tx
          .select()
          .from(businessProfiles)
          .where(eq(businessProfiles.organizationId, orgId));
        versionCheck(data.version, old?.version ?? 0);
        const [active] = await tx
          .select()
          .from(gstRegistrations)
          .where(
            and(
              eq(gstRegistrations.organizationId, orgId),
              eq(gstRegistrations.active, true),
            ),
          );
        const {
          version,
          gstin,
          taxpayerType,
          registrationConfirmed,
          ...profile
        } = data;
        if (old)
          await tx
            .update(businessProfiles)
            .set({ ...profile, version: version + 1, updatedAt: new Date() })
            .where(eq(businessProfiles.organizationId, orgId));
        else
          await tx
            .insert(businessProfiles)
            .values({ ...profile, organizationId: orgId });
        // Any identity/address change invalidates an old attestation unless reconfirmed.
        const confirmation = {
          confirmedAt: registrationConfirmed ? new Date() : null,
          confirmedBy: registrationConfirmed ? session.userId : null,
        };
        if (active?.gstin !== gstin) {
          if (active)
            await tx
              .update(gstRegistrations)
              .set({ active: false })
              .where(
                and(
                  eq(gstRegistrations.organizationId, orgId),
                  eq(gstRegistrations.id, active.id),
                ),
              );
          const [historical] = await tx
            .select()
            .from(gstRegistrations)
            .where(
              and(
                eq(gstRegistrations.organizationId, orgId),
                eq(gstRegistrations.gstin, gstin),
              ),
            );
          if (historical)
            await tx
              .update(gstRegistrations)
              .set({ active: true, ...confirmation })
              .where(
                and(
                  eq(gstRegistrations.organizationId, orgId),
                  eq(gstRegistrations.id, historical.id),
                ),
              );
          else
            await tx.insert(gstRegistrations).values({
              organizationId: orgId,
              gstin,
              taxpayerType,
              stateCode: data.address.stateCode,
              ...confirmation,
            });
        } else
          await tx
            .update(gstRegistrations)
            .set(confirmation)
            .where(
              and(
                eq(gstRegistrations.organizationId, orgId),
                eq(gstRegistrations.id, active.id),
              ),
            );
        await this.organizations.identity.audit(
          tx,
          session.userId,
          'business.profile_saved',
          orgId,
          orgId,
          {
            version: String(version + 1),
            registrationChanged: active?.gstin !== gstin,
            registrationConfirmed,
            eInvoiceApplicability: data.eInvoiceApplicability,
          },
        );
        return this.readProfile(tx, orgId);
      },
    );
  }
  async listCustomers(
    session: IdentitySession,
    orgId: string,
    query: DirectoryQuery,
  ) {
    await this.organizations.access(session, orgId, 'customers.read', this.db);
    const rows = await this.db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, orgId),
          query.status === 'active'
            ? isNull(customers.archivedAt)
            : query.status === 'archived'
              ? isNotNull(customers.archivedAt)
              : undefined,
          query.q
            ? or(
                ilike(customers.name, pattern(query.q)),
                ilike(customers.code, pattern(query.q)),
                ilike(customers.gstin, pattern(query.q)),
              )
            : undefined,
        ),
      )
      .orderBy(asc(customers.name), asc(customers.id))
      .limit(51)
      .offset(query.offset);
    return {
      items: rows.slice(0, 50).map(customerView),
      hasMore: rows.length > 50,
    };
  }
  async customer(session: IdentitySession, orgId: string, id: string) {
    await this.organizations.access(session, orgId, 'customers.read', this.db);
    const [row] = await this.db
      .select()
      .from(customers)
      .where(and(eq(customers.organizationId, orgId), eq(customers.id, id)));
    return customerView(row ?? deny('NOT_FOUND'));
  }
  async saveCustomer(
    session: IdentitySession,
    orgId: string,
    data: CustomerInput,
    id?: string,
  ) {
    return this.organizations.write(
      session,
      orgId,
      'customers.manage',
      async (tx) => {
        const [old] = id
          ? await tx
              .select()
              .from(customers)
              .where(
                and(eq(customers.organizationId, orgId), eq(customers.id, id)),
              )
          : [];
        if (id && !old) deny('NOT_FOUND');
        if (old?.archivedAt) deny('CONFLICT');
        versionCheck(data.version, old?.version ?? 0);
        const values = {
          ...data,
          version: data.version + 1,
          updatedAt: new Date(),
        };
        const [row] = id
          ? await tx
              .update(customers)
              .set(values)
              .where(
                and(eq(customers.organizationId, orgId), eq(customers.id, id)),
              )
              .returning()
          : await tx
              .insert(customers)
              .values({ ...values, organizationId: orgId })
              .returning();
        await this.organizations.identity.audit(
          tx,
          session.userId,
          id ? 'customers.updated' : 'customers.created',
          row!.id,
          orgId,
          { version: String(row!.version) },
        );
        return customerView(row!);
      },
    );
  }
  private async taxRows(
    db: Store,
    orgId: string,
    ids: string[],
    history = false,
  ) {
    if (!ids.length) return [];
    const rows = await db
      .select({ tax: catalogTaxRevisions, review: catalogTaxReviews })
      .from(catalogTaxRevisions)
      .leftJoin(
        catalogTaxReviews,
        and(
          eq(
            catalogTaxReviews.organizationId,
            catalogTaxRevisions.organizationId,
          ),
          eq(catalogTaxReviews.revisionId, catalogTaxRevisions.id),
        ),
      )
      .where(
        and(
          eq(catalogTaxRevisions.organizationId, orgId),
          inArray(catalogTaxRevisions.itemId, ids),
          history
            ? undefined
            : sql`${catalogTaxRevisions.revision} = (select max(r.revision) from catalog_tax_revisions r where r.organization_id = ${catalogTaxRevisions.organizationId} and r.item_id = ${catalogTaxRevisions.itemId})`,
        ),
      )
      .orderBy(desc(catalogTaxRevisions.revision))
      .limit(history ? 100 : 50);
    return rows.map(({ tax, review }) => ({
      itemId: tax.itemId,
      tax: taxRevisionViewSchema.parse({
        ...tax,
        verifiedBy: review?.verifiedBy ?? null,
        verifiedAt: review?.verifiedAt.toISOString() ?? null,
        reference: review?.reference ?? null,
      }),
    }));
  }
  private async catalogViews(
    db: Store,
    orgId: string,
    rows: (typeof catalogItems.$inferSelect)[],
  ): Promise<CatalogView[]> {
    const taxes = await this.taxRows(
      db,
      orgId,
      rows.map((row) => row.id),
    );
    return rows.map((row) =>
      catalogViewSchema.parse({
        ...row,
        tax: taxes.find((tax) => tax.itemId === row.id)?.tax,
        archivedAt: row.archivedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
      }),
    );
  }
  async listCatalog(
    session: IdentitySession,
    orgId: string,
    query: DirectoryQuery,
  ) {
    return this.db.transaction(
      async (tx) => {
        await this.organizations.access(session, orgId, 'catalog.read', tx);
        const rows = await tx
          .select()
          .from(catalogItems)
          .where(
            and(
              eq(catalogItems.organizationId, orgId),
              query.status === 'active'
                ? isNull(catalogItems.archivedAt)
                : query.status === 'archived'
                  ? isNotNull(catalogItems.archivedAt)
                  : undefined,
              query.q
                ? or(
                    ilike(catalogItems.name, pattern(query.q)),
                    ilike(catalogItems.code, pattern(query.q)),
                  )
                : undefined,
            ),
          )
          .orderBy(asc(catalogItems.name), asc(catalogItems.id))
          .limit(51)
          .offset(query.offset);
        return {
          items: await this.catalogViews(tx, orgId, rows.slice(0, 50)),
          hasMore: rows.length > 50,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
  async catalogItem(session: IdentitySession, orgId: string, id: string) {
    return this.db.transaction(
      async (tx) => {
        await this.organizations.access(session, orgId, 'catalog.read', tx);
        return this.readCatalog(tx, orgId, id);
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
  private async readCatalog(db: Store, orgId: string, id: string) {
    const [row] = await db
      .select()
      .from(catalogItems)
      .where(
        and(eq(catalogItems.organizationId, orgId), eq(catalogItems.id, id)),
      );
    if (!row) deny('NOT_FOUND');
    return (await this.catalogViews(db, orgId, [row]))[0]!;
  }
  async saveCatalog(
    session: IdentitySession,
    orgId: string,
    data: CatalogInput,
    id?: string,
  ) {
    return this.organizations.write(
      session,
      orgId,
      'catalog.manage',
      async (tx) => {
        const old = id ? await this.readCatalog(tx, orgId, id) : undefined;
        if (old?.archivedAt) deny('CONFLICT');
        versionCheck(data.version, old?.version ?? 0);
        const { tax, ...fields } = data;
        const values = {
          ...fields,
          version: data.version + 1,
          updatedAt: new Date(),
        };
        const [row] = id
          ? await tx
              .update(catalogItems)
              .set(values)
              .where(
                and(
                  eq(catalogItems.organizationId, orgId),
                  eq(catalogItems.id, id),
                ),
              )
              .returning()
          : await tx
              .insert(catalogItems)
              .values({ ...values, organizationId: orgId })
              .returning();
        const taxChanged =
          !old ||
          old.kind !== data.kind ||
          old.name !== data.name ||
          old.description !== data.description ||
          Object.entries(tax).some(
            ([key, value]) => old.tax[key as keyof typeof tax] !== value,
          );
        if (taxChanged)
          await tx.insert(catalogTaxRevisions).values({
            ...tax,
            itemId: row!.id,
            organizationId: orgId,
            revision: (old?.tax.revision ?? 0) + 1,
            createdBy: session.userId,
          });
        await this.organizations.identity.audit(
          tx,
          session.userId,
          id ? 'catalog.updated' : 'catalog.created',
          row!.id,
          orgId,
          { version: String(row!.version), classificationChanged: taxChanged },
        );
        return this.readCatalog(tx, orgId, row!.id);
      },
    );
  }
  async reviewTax(
    session: IdentitySession,
    orgId: string,
    id: string,
    version: number,
    reference: string,
  ) {
    return this.organizations.write(
      session,
      orgId,
      'catalog.tax.verify',
      async (tx) => {
        const item = await this.readCatalog(tx, orgId, id);
        versionCheck(version, item.version);
        if (item.archivedAt || item.tax.verifiedAt) deny('CONFLICT');
        await tx.insert(catalogTaxReviews).values({
          organizationId: orgId,
          revisionId: item.tax.id,
          reference,
          verifiedBy: session.userId,
        });
        await tx
          .update(catalogItems)
          .set({ version: version + 1, updatedAt: new Date() })
          .where(
            and(
              eq(catalogItems.organizationId, orgId),
              eq(catalogItems.id, id),
            ),
          );
        await this.organizations.identity.audit(
          tx,
          session.userId,
          'catalog.tax_reviewed',
          id,
          orgId,
          { revisionId: item.tax.id },
        );
        return this.readCatalog(tx, orgId, id);
      },
    );
  }
  async taxHistory(session: IdentitySession, orgId: string, id: string) {
    await this.organizations.access(session, orgId, 'catalog.read', this.db);
    await this.readCatalog(this.db, orgId, id);
    return (await this.taxRows(this.db, orgId, [id], true)).map(
      (row) => row.tax,
    );
  }
  async archive(
    session: IdentitySession,
    orgId: string,
    id: string,
    kind: 'customers' | 'catalog',
    version: number,
    archived: boolean,
  ) {
    return this.organizations.write(
      session,
      orgId,
      kind === 'customers' ? 'customers.manage' : 'catalog.manage',
      async (tx: DatabaseTransaction) => {
        const table = kind === 'customers' ? customers : catalogItems;
        const [row] = await tx
          .select({ version: table.version, archivedAt: table.archivedAt })
          .from(table)
          .where(and(eq(table.organizationId, orgId), eq(table.id, id)));
        if (!row) deny('NOT_FOUND');
        versionCheck(version, row.version);
        if (Boolean(row.archivedAt) === archived) deny('CONFLICT');
        await tx
          .update(table)
          .set({
            archivedAt: archived ? new Date() : null,
            version: version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(table.organizationId, orgId), eq(table.id, id)));
        await this.organizations.identity.audit(
          tx,
          session.userId,
          `${kind}.${archived ? 'archived' : 'restored'}`,
          id,
          orgId,
        );
        return { ok: true };
      },
    );
  }
}
