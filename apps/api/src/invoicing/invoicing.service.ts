import {
  calculateInvoice,
  CALCULATION_RULE_VERSION,
  calculateValueCorrection,
  CORRECTION_POLICY_VERSION,
} from '@gst/billing-engine';
import type { CalculationResult } from '@gst/billing-engine';
import {
  businessProfileViewSchema,
  invoiceDraftSchema,
  taxRevisionViewSchema,
  correctionInputSchema,
} from '@gst/contracts';
import type {
  InvoiceDraft,
  InvoiceRecord,
  InvoicePreview,
  InvoicePrintData,
  FinalizeInvoice,
  CalculationInput,
  CalculationAuthority,
  CorrectionInput,
  CancelInvoice,
} from '@gst/contracts';
import {
  and,
  eq,
  desc,
  inArray,
  businessProfiles,
  gstRegistrations,
  customers,
  catalogItems,
  catalogTaxRevisions,
  catalogTaxReviews,
  invoices,
  invoiceSeries,
  invoiceSnapshots,
  invoiceLines,
  invoiceTaxComponents,
  invoiceCancellations,
  isNull,
} from '@gst/database';
import type { Database, DatabaseTransaction } from '@gst/database';
import type {
  IdentitySession,
  TenantAccess,
  Store,
} from '../security/types.js';
import type { OrganizationsService } from '../security/organizations.service.js';
import { deny } from '../security/errors.js';
import {
  checksum,
  financialYear,
  indianToday,
  assertCalculationReleased,
  issuanceBlockers,
} from './policy.js';

interface Snapshot {
  correctionBasis?: {
    originalSnapshotDigest: string;
    priorDocuments: { invoiceId: string; snapshotDigest: string }[];
  };
  correction?: CorrectionInput;
  correctionPolicyVersion?: string;
  schemaVersion: 1;
  input: CalculationInput;
  calculation: CalculationResult;
  print: InvoicePrintData;
}
const scope = (orgId: string, id: string) =>
  and(eq(invoices.organizationId, orgId), eq(invoices.id, id));
const versionCheck = (expected: number, actual: number) => {
  if (expected !== actual) deny('VERSION_CONFLICT');
};
export class InvoicingService {
  constructor(readonly organizations: OrganizationsService) {}
  get db(): Database['db'] {
    return this.organizations.db;
  }
  private async row(db: Store, orgId: string, id: string) {
    const [row] = await db.select().from(invoices).where(scope(orgId, id));
    return row ?? deny('NOT_FOUND');
  }
  private async snapshot(
    db: Store,
    orgId: string,
    id: string,
  ): Promise<Snapshot> {
    const [row] = await db
      .select()
      .from(invoiceSnapshots)
      .where(
        and(
          eq(invoiceSnapshots.organizationId, orgId),
          eq(invoiceSnapshots.invoiceId, id),
        ),
      );
    if (!row || checksum(row.payload) !== row.digest) deny('CONFLICT');
    return row.payload as Snapshot;
  }
  private async view(
    db: Store,
    row: typeof invoices.$inferSelect,
  ): Promise<InvoiceRecord> {
    const snapshot =
      row.status === 'finalized'
        ? await this.snapshot(db, row.organizationId, row.id)
        : null;
    const cancellation = await this.cancelled(db, row.organizationId, row.id);
    const draft = invoiceDraftSchema.parse(row.draft);
    const referenceSnapshot = row.originalId
      ? await this.snapshot(db, row.organizationId, row.originalId)
      : snapshot;
    const items = referenceSnapshot
      ? []
      : await db
          .select({
            id: catalogItems.id,
            name: catalogItems.name,
            description: catalogItems.description,
          })
          .from(catalogItems)
          .where(
            and(
              eq(catalogItems.organizationId, row.organizationId),
              inArray(catalogItems.id, [
                ...new Set(draft.lines.map((l) => l.catalogItemId)),
              ]),
            ),
          );
    const lineDescriptions = Object.fromEntries(
      draft.lines.map((l) => [
        l.id,
        referenceSnapshot?.print.lines.find((v) => v.id === l.id)
          ?.description ??
          items.find((v) => v.id === l.catalogItemId)?.name ??
          'Catalog item',
      ]),
    );
    return {
      id: row.id,
      version: row.version,
      status: cancellation
        ? 'cancelled'
        : (row.status as InvoiceRecord['status']),
      documentType: row.documentType as InvoiceRecord['documentType'],
      number: row.number,
      customerName: row.customerName,
      issueDate: row.issueDate,
      updatedAt: row.updatedAt.toISOString(),
      draft,
      lineDescriptions,
      originalId: row.originalId,
      correctionReason: row.correctionReason,
      snapshot: snapshot
        ? {
            ...snapshot.print,
            ...(cancellation
              ? {
                  cancellation: {
                    reason: cancellation.reason,
                    createdAt: cancellation.createdAt.toISOString(),
                  },
                }
              : {}),
          }
        : null,
      correction: row.correction
        ? correctionInputSchema.parse(row.correction)
        : null,
      cancellation: cancellation
        ? {
            reason: cancellation.reason,
            createdAt: cancellation.createdAt.toISOString(),
          }
        : null,
      snapshotDigest: snapshot ? checksum(snapshot) : null,
    };
  }
  async list(session: IdentitySession, orgId: string, offset: number) {
    await this.organizations.access(session, orgId, 'invoices.read', this.db);
    const entries = await this.db
      .select({ row: invoices, cancellation: invoiceCancellations })
      .from(invoices)
      .leftJoin(
        invoiceCancellations,
        and(
          eq(invoiceCancellations.organizationId, invoices.organizationId),
          eq(invoiceCancellations.invoiceId, invoices.id),
        ),
      )
      .where(eq(invoices.organizationId, orgId))
      .orderBy(desc(invoices.issueDate), desc(invoices.id))
      .limit(51)
      .offset(offset);
    return {
      items: entries.slice(0, 50).map(({ row: r, cancellation }) => ({
        id: r.id,
        version: r.version,
        status: cancellation ? 'cancelled' : r.status,
        documentType: r.documentType,
        number: r.number,
        customerName: r.customerName,
        issueDate: r.issueDate,
        updatedAt: r.updatedAt.toISOString(),
      })),
      hasMore: entries.length > 50,
    };
  }
  async get(session: IdentitySession, orgId: string, id: string) {
    return this.db.transaction(
      async (tx) => {
        await this.organizations.access(session, orgId, 'invoices.read', tx);
        return this.view(tx, await this.row(tx, orgId, id));
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
  private async profile(db: Store, orgId: string) {
    const [entry] = await db
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
    if (!entry?.registration.confirmedAt) deny('BILLING_SETUP_REQUIRED');
    const { profile, registration } = entry;
    return businessProfileViewSchema.parse({
      ...profile,
      gstin: registration.gstin,
      taxpayerType: registration.taxpayerType,
      registrationConfirmed: true,
      registrationConfirmedAt: registration.confirmedAt!.toISOString(),
      registrationId: registration.id,
      updatedAt: profile.updatedAt.toISOString(),
    });
  }
  private async prepare(
    tx: Store,
    orgId: string,
    draft: InvoiceDraft | undefined,
    session: IdentitySession,
    access: TenantAccess,
  ) {
    if (!draft) deny('INVALID_INPUT');
    if (draft.issueDate > indianToday() || draft.supplyDate > draft.issueDate)
      deny('INVALID_INPUT');
    const profile = await this.profile(tx, orgId);
    const [customer] = await tx
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, orgId),
          eq(customers.id, draft.customerId),
        ),
      );
    if (!customer) deny('NOT_FOUND');
    if (customer.archivedAt) deny('ARCHIVED_BILLING_RECORD');
    // Registration state is an explicit recipient fact, not a GSTIN-prefix guess.
    if (
      customer.gstin &&
      customer.gstin.slice(0, 2) !== customer.address.stateCode
    )
      deny('CUSTOMER_REGISTRATION_MISMATCH');
    const lines: CalculationInput['lines'] = [];
    const descriptions = new Map<string, string>();
    const itemIds = [...new Set(draft.lines.map((l) => l.catalogItemId))];
    const items = await tx
      .select()
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.organizationId, orgId),
          inArray(catalogItems.id, itemIds),
        ),
      );
    if (items.length !== itemIds.length) deny('NOT_FOUND');
    const histories = await tx
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
          inArray(catalogTaxRevisions.itemId, itemIds),
        ),
      )
      .orderBy(desc(catalogTaxRevisions.revision))
      .limit(10001);
    if (histories.length > 10000) deny('CONFLICT');
    const byItem = new Map(items.map((item) => [item.id, item]));
    const historyByItem = new Map<string, typeof histories>();
    for (const entry of histories) {
      const group = historyByItem.get(entry.tax.itemId) ?? [];
      group.push(entry);
      historyByItem.set(entry.tax.itemId, group);
    }
    for (const line of draft.lines) {
      const { catalogItemId, ...requested } = line;
      const item = byItem.get(catalogItemId);
      if (!item) deny('NOT_FOUND');
      if (item.archivedAt) deny('ARCHIVED_BILLING_RECORD');
      const history = historyByItem.get(item.id) ?? [];
      if (history.length > 100) deny('CONFLICT'); // Never silently truncate relevant history.
      lines.push({
        ...requested,
        kind: item.kind as 'goods' | 'service',
        unitCode: item.unitCode,
        catalogUnitPrice: item.price,
        priceIncludesGst: item.priceIncludesGst,
        taxRevisions: history.map(({ tax, review }) =>
          taxRevisionViewSchema.parse({
            ...tax,
            verifiedAt: review?.verifiedAt.toISOString() ?? null,
            verifiedBy: review?.verifiedBy ?? null,
            reference: review?.reference ?? null,
          }),
        ),
        supply:
          item.kind === 'service'
            ? {
                kind: 'general_service',
                specialRuleApplies: false,
                suppliedThroughEcommerce: false,
              }
            : !customer.gstin
              ? {
                  kind: 'goods_unregistered',
                  invoiceAddressState: customer.address.stateCode,
                  deliveryAddressState: draft.deliveryAddress.stateCode,
                }
              : draft.goodsTreatment === 'movement'
                ? {
                    kind: 'goods_movement',
                    deliveryState: draft.deliveryAddress.stateCode,
                  }
                : {
                    kind: 'goods_no_movement',
                    goodsLocationState: draft.deliveryAddress.stateCode,
                  },
      });
      descriptions.set(
        line.id,
        [item.name, item.description].filter(Boolean).join(' — '),
      );
    }
    const input: CalculationInput = {
      ruleVersion: CALCULATION_RULE_VERSION,
      supplyDate: draft.supplyDate,
      context: {
        supplierState: profile.address.stateCode,
        supplierTaxpayerType: 'regular',
        supplierRegistrationConfirmed: true,
        recipient: customer.gstin
          ? { kind: 'registered', locationState: customer.address.stateCode }
          : {
              kind: 'unregistered',
              addressOnRecordState: customer.address.stateCode,
            },
        supplyScenario: 'ordinary_domestic_forward_charge',
        valuation: 'unrelated_sole_consideration',
        independentSupplies: true,
      },
      lines,
      invoiceDiscount: draft.invoiceDiscount,
    };
    const authority: CalculationAuthority = {
      actorId: session.userId,
      permissions: access.permissions.filter(
        (p): p is CalculationAuthority['permissions'][number] =>
          p === 'price.override' ||
          p === 'tax.override' ||
          p === 'place_of_supply.override',
      ),
    };
    const calculation = calculateInvoice(input, authority);
    const print: InvoicePrintData = {
      rendererVersion: 'a4.v1',
      title: 'Tax invoice',
      number: null,
      issueDate: draft.issueDate,
      supplyDate: draft.supplyDate,
      supplier: {
        logoDataUrl: profile.logoDataUrl,
        name: profile.legalName,
        gstin: profile.gstin,
        address: profile.address,
        email: profile.email,
        phone: profile.phone,
      },
      recipient: {
        name: customer.name,
        gstin: customer.gstin,
        address: customer.address,
      },
      deliveryAddress: draft.deliveryAddress,
      placeOfSupplyState: calculation.placeOfSupplyState,
      originalNumber: null,
      originalDate: null,
      correctionReason: '',
      lines: calculation.lines.map((l) => ({
        id: l.id,
        description: descriptions.get(l.id)!,
        hsnSac: l.hsnSac,
        quantity: l.quantity,
        unit: l.unitCode,
        unitPrice: l.appliedUnitPrice,
        priceIncludesGst: l.priceIncludesGst,
        discount: l.pricedLineDiscount,
        supplyValue: l.supplyValue,
        gstPercent: l.gstPercent,
        taxes: l.taxComponents,
        total: l.total,
      })),
      totals: calculation.totals,
      bank: {
        name: profile.bankName,
        accountName: profile.bankAccountName,
        accountNumber: profile.bankAccountNumber,
        ifsc: profile.bankIfsc,
      },
      notes: draft.notes,
      terms: draft.terms,
    };
    return {
      profile,
      customer,
      snapshot: {
        schemaVersion: 1,
        input,
        calculation,
        print,
      } satisfies Snapshot,
    };
  }
  private async prepared(
    tx: Store,
    orgId: string,
    row: typeof invoices.$inferSelect,
    session: IdentitySession,
    access: TenantAccess,
  ) {
    const draft = invoiceDraftSchema.parse(row.draft);
    if (await this.cancelled(tx, orgId, row.id)) deny('CONFLICT');
    if (!row.originalId) return this.prepare(tx, orgId, draft, session, access);
    const original = await this.row(tx, orgId, row.originalId);
    if (await this.cancelled(tx, orgId, original.id)) deny('CONFLICT');
    if (original.status !== 'finalized' || original.documentType !== 'invoice')
      deny('CORRECTION_UNSUPPORTED');
    const profile = await this.profile(tx, orgId);
    if (profile.registrationId !== row.registrationId)
      deny('BILLING_SETUP_REQUIRED');
    const originalSnapshot = await this.snapshot(tx, orgId, original.id);
    const snapshot = structuredClone(originalSnapshot);
    const prior = await this.priorCorrections(tx, orgId, original.id);
    if (!row.correction && prior.length) deny('CONFLICT');
    if (row.correction) {
      const correction = correctionInputSchema.parse(row.correction);
      if (
        correction.issueDate < original.issueDate ||
        correction.issueDate > indianToday()
      )
        deny('INVALID_INPUT');
      snapshot.calculation = calculateValueCorrection(
        originalSnapshot.calculation,
        correction,
        prior,
      );
      snapshot.correction = correction;
      snapshot.correctionBasis = {
        originalSnapshotDigest: checksum(originalSnapshot),
        priorDocuments: prior
          .map((p) => ({
            invoiceId: p.invoiceId,
            snapshotDigest: p.snapshotDigest,
          }))
          .sort((a, b) => (a.invoiceId < b.invoiceId ? -1 : 1)),
      };
      snapshot.correctionPolicyVersion = CORRECTION_POLICY_VERSION;
      snapshot.print.lines = snapshot.calculation.lines.map((line) => ({
        id: line.id,
        description: originalSnapshot.print.lines.find((l) => l.id === line.id)!
          .description,
        hsnSac: line.hsnSac,
        quantity: line.quantity,
        unit: line.unitCode,
        unitPrice: line.appliedUnitPrice,
        priceIncludesGst: false,
        discount: '0.00',
        supplyValue: line.supplyValue,
        gstPercent: line.gstPercent,
        taxes: line.taxComponents,
        total: line.total,
      }));
      snapshot.print.totals = snapshot.calculation.totals;
      snapshot.print.valueAdjustment = true;
    }
    snapshot.print = {
      ...snapshot.print,
      title: row.documentType === 'debit_note' ? 'Debit note' : 'Credit note',
      number: null,
      issueDate: draft.issueDate,
      originalNumber: original.number,
      originalDate: original.issueDate,
      correctionReason: row.correctionReason,
    };
    return { profile, customer: { name: original.customerName }, snapshot };
  }
  private digest(prepared: Awaited<ReturnType<InvoicingService['prepared']>>) {
    return checksum({
      snapshot: prepared.snapshot,
      profileVersion: prepared.profile.version,
      registrationId: prepared.profile.registrationId,
      eInvoiceApplicability: prepared.profile.eInvoiceApplicability,
    });
  }
  async preview(
    session: IdentitySession,
    orgId: string,
    draft: InvoiceDraft | undefined,
    id?: string,
  ): Promise<InvoicePreview> {
    return this.organizations.write(
      session,
      orgId,
      'invoices.read',
      async (tx, access) => {
        const row = id ? await this.row(tx, orgId, id) : undefined;
        if (row?.status === 'finalized') deny('CONFLICT');
        const prepared = row
          ? await this.prepared(tx, orgId, row, session, access)
          : await this.prepare(tx, orgId, draft, session, access);
        return {
          digest: this.digest(prepared),
          print: prepared.snapshot.print,
          issuanceBlockers: issuanceBlockers(
            row?.documentType ?? 'invoice',
            prepared.profile.eInvoiceApplicability,
          ),
        };
      },
    );
  }
  async save(
    session: IdentitySession,
    orgId: string,
    draft: InvoiceDraft,
    id?: string,
    requestKey?: string,
  ) {
    return this.organizations.write(
      session,
      orgId,
      'invoices.manage',
      async (tx, access) => {
        const createDigest = checksum(draft);
        if (!id) {
          if (!requestKey || draft.version !== 0) deny('INVALID_INPUT');
          const [existing] = await tx
            .select()
            .from(invoices)
            .where(
              and(
                eq(invoices.organizationId, orgId),
                eq(invoices.createKey, requestKey),
              ),
            );
          if (existing) {
            if (existing.createDigest !== createDigest) deny('CONFLICT');
            return this.view(tx, existing);
          }
        }
        const old = id ? await this.row(tx, orgId, id) : undefined;
        if (old && (await this.cancelled(tx, orgId, old.id))) deny('CONFLICT');
        if (old && (old.status !== 'draft' || old.originalId)) deny('CONFLICT');
        versionCheck(draft.version, old?.version ?? 0);
        const prepared = await this.prepare(tx, orgId, draft, session, access);
        const values = {
          draft,
          customerId: draft.customerId,
          customerName: prepared.customer.name,
          registrationId: prepared.profile.registrationId,
          issueDate: draft.issueDate,
          version: draft.version + 1,
          updatedAt: new Date(),
        };
        const [row] = id
          ? await tx
              .update(invoices)
              .set(values)
              .where(scope(orgId, id))
              .returning()
          : await tx
              .insert(invoices)
              .values({
                ...values,
                organizationId: orgId,
                createKey: requestKey!,
                createDigest,
              })
              .returning();
        await this.organizations.identity.audit(
          tx,
          session.userId,
          id ? 'invoices.draft_updated' : 'invoices.draft_created',
          row!.id,
          orgId,
          { version: String(row!.version) },
        );
        return this.view(tx, row!);
      },
    );
  }
  async finalize(
    session: IdentitySession,
    orgId: string,
    id: string,
    data: FinalizeInvoice,
  ) {
    return this.organizations.write(
      session,
      orgId,
      'invoices.finalize',
      async (tx, access) => {
        const row = await this.row(tx, orgId, id);
        if (await this.cancelled(tx, orgId, id)) deny('CONFLICT');
        const requestDigest = checksum({ id, ...data });
        if (row.status === 'finalized') {
          if (
            row.finalizeKey !== data.requestKey ||
            row.finalizeDigest !== requestDigest
          )
            deny('CONFLICT');
          return this.view(tx, row);
        }
        versionCheck(data.version, row.version);
        if (row.originalId && !access.permissions.includes('invoices.correct'))
          deny('FORBIDDEN');
        const prepared = await this.prepared(tx, orgId, row, session, access);
        if (
          row.registrationId !== prepared.profile.registrationId ||
          this.digest(prepared) !== data.previewDigest
        )
          deny('BILLING_REVIEW_REQUIRED');
        if (prepared.profile.eInvoiceApplicability !== 'not_required')
          deny('EINVOICE_BLOCKED');
        assertCalculationReleased(row.documentType);
        const fy = financialYear(row.issueDate);
        const seriesScope = and(
          eq(invoiceSeries.organizationId, orgId),
          eq(invoiceSeries.registrationId, row.registrationId),
          eq(invoiceSeries.financialYear, fy),
          eq(invoiceSeries.documentType, row.documentType),
        );
        await tx
          .insert(invoiceSeries)
          .values({
            organizationId: orgId,
            registrationId: row.registrationId,
            financialYear: fy,
            documentType: row.documentType,
          })
          .onConflictDoNothing();
        const [series] = await tx
          .select()
          .from(invoiceSeries)
          .where(seriesScope)
          .for('update');
        if (!series || series.nextCounter > 999999) deny('CONFLICT');
        const number = `${row.documentType === 'invoice' ? 'INV' : row.documentType === 'debit_note' ? 'DN' : 'CN'}/${fy}/${String(series.nextCounter).padStart(6, '0')}`;
        await tx
          .update(invoiceSeries)
          .set({ nextCounter: series.nextCounter + 1 })
          .where(seriesScope);
        prepared.snapshot.print.number = number;
        const snapshot = prepared.snapshot;
        await this.persistFinancials(tx, orgId, row, snapshot);
        const [finalized] = await tx
          .update(invoices)
          .set({
            status: 'finalized',
            version: row.version + 1,
            financialYear: fy,
            number,
            finalizedAt: new Date(),
            updatedAt: new Date(),
            finalizeKey: data.requestKey,
            finalizeDigest: requestDigest,
          })
          .where(scope(orgId, id))
          .returning();
        await this.organizations.identity.audit(
          tx,
          session.userId,
          'invoices.finalized',
          id,
          orgId,
          {
            number,
            documentType: row.documentType,
            snapshotDigest: checksum(snapshot),
          },
        );
        return this.view(tx, finalized!);
      },
    );
  }
  private async persistFinancials(
    tx: DatabaseTransaction,
    orgId: string,
    row: typeof invoices.$inferSelect,
    snapshot: Snapshot,
  ) {
    const draft = invoiceDraftSchema.parse(row.draft);
    await tx.insert(invoiceSnapshots).values({
      organizationId: orgId,
      invoiceId: row.id,
      digest: checksum(snapshot),
      payload: snapshot,
    });
    for (const l of snapshot.calculation.lines) {
      await tx.insert(invoiceLines).values({
        organizationId: orgId,
        invoiceId: row.id,
        lineId: l.id,
        catalogItemId: draft.lines.find((v) => v.id === l.id)!.catalogItemId,
        description: snapshot.print.lines.find((v) => v.id === l.id)!
          .description,
        hsnSac: l.hsnSac,
        quantity: l.quantity,
        supplyValue: l.supplyValue,
        taxTotal: l.taxTotal,
        total: l.total,
      });
      if (l.taxComponents.length)
        await tx.insert(invoiceTaxComponents).values(
          l.taxComponents.map((c) => ({
            organizationId: orgId,
            invoiceId: row.id,
            lineId: l.id,
            ...c,
          })),
        );
    }
  }
  private async cancelled(db: Store, orgId: string, id: string) {
    const [row] = await db
      .select()
      .from(invoiceCancellations)
      .where(
        and(
          eq(invoiceCancellations.organizationId, orgId),
          eq(invoiceCancellations.invoiceId, id),
        ),
      );
    return row;
  }
  private async priorCorrections(db: Store, orgId: string, originalId: string) {
    const rows = await db
      .select({ row: invoices })
      .from(invoices)
      .leftJoin(
        invoiceCancellations,
        and(
          eq(invoiceCancellations.organizationId, invoices.organizationId),
          eq(invoiceCancellations.invoiceId, invoices.id),
        ),
      )
      .where(
        and(
          eq(invoices.organizationId, orgId),
          eq(invoices.originalId, originalId),
          eq(invoices.status, 'finalized'),
          isNull(invoiceCancellations.invoiceId),
        ),
      )
      .limit(1001);
    if (rows.length > 1000) deny('CONFLICT');
    return Promise.all(
      rows.map(async ({ row }) => {
        const snapshot = await this.snapshot(db, orgId, row.id);
        return {
          invoiceId: row.id,
          snapshotDigest: checksum(snapshot),
          documentType: row.documentType as 'credit_note' | 'debit_note',
          calculation: snapshot.calculation,
        };
      }),
    );
  }
  private async correctionWrite(
    tx: DatabaseTransaction,
    session: IdentitySession,
    orgId: string,
    originalId: string,
    data: CorrectionInput,
    id?: string,
    digest = checksum({ originalId, ...data }),
  ) {
    const original = await this.row(tx, orgId, originalId);
    if (
      original.status !== 'finalized' ||
      original.documentType !== 'invoice' ||
      (await this.cancelled(tx, orgId, original.id))
    )
      deny('CORRECTION_UNSUPPORTED');
    if (data.issueDate < original.issueDate || data.issueDate > indianToday())
      deny('INVALID_INPUT');
    if (!id) {
      if (data.version !== 0) deny('INVALID_INPUT');
      const [existing] = await tx
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.organizationId, orgId),
            eq(invoices.createKey, data.requestKey),
          ),
        );
      if (existing) {
        if (existing.createDigest !== digest) deny('CONFLICT');
        return this.view(tx, existing);
      }
    }
    const old = id ? await this.row(tx, orgId, id) : undefined;
    if (
      old &&
      (old.status !== 'draft' ||
        old.originalId !== originalId ||
        old.documentType !== data.documentType ||
        old.createKey !== data.requestKey ||
        (await this.cancelled(tx, orgId, id!)))
    )
      deny('CONFLICT');
    versionCheck(data.version, old?.version ?? 0);
    const baseline = await this.snapshot(tx, orgId, original.id);
    calculateValueCorrection(
      baseline.calculation,
      data,
      await this.priorCorrections(tx, orgId, original.id),
    );
    const draft = invoiceDraftSchema.parse({
      ...invoiceDraftSchema.parse(original.draft),
      version: 0,
      issueDate: data.issueDate,
    });
    const values = {
      draft,
      correction: data,
      correctionReason: data.reason,
      issueDate: data.issueDate,
      version: (old?.version ?? 0) + 1,
      updatedAt: new Date(),
    };
    const [row] = id
      ? await tx
          .update(invoices)
          .set(values)
          .where(scope(orgId, id))
          .returning()
      : await tx
          .insert(invoices)
          .values({
            ...values,
            organizationId: orgId,
            registrationId: original.registrationId,
            customerId: original.customerId,
            customerName: original.customerName,
            documentType: data.documentType,
            originalId,
            createKey: data.requestKey,
            createDigest: digest,
          })
          .returning();
    await this.organizations.identity.audit(
      tx,
      session.userId,
      id
        ? 'invoices.correction_draft_updated'
        : 'invoices.correction_draft_created',
      row!.id,
      orgId,
      {
        originalId,
        reason: data.reason,
        documentType: data.documentType,
        version: String(row!.version),
      },
    );
    return this.view(tx, row!);
  }
  async correction(
    session: IdentitySession,
    orgId: string,
    originalId: string,
    data: CorrectionInput,
    id?: string,
  ) {
    return this.organizations.write(session, orgId, 'invoices.correct', (tx) =>
      this.correctionWrite(tx, session, orgId, originalId, data, id),
    );
  }
  async updateCorrection(
    session: IdentitySession,
    orgId: string,
    id: string,
    data: CorrectionInput,
  ) {
    return this.organizations.write(
      session,
      orgId,
      'invoices.correct',
      async (tx) => {
        const row = await this.row(tx, orgId, id);
        if (!row.originalId) deny('CORRECTION_UNSUPPORTED');
        return this.correctionWrite(
          tx,
          session,
          orgId,
          row.originalId,
          data,
          id,
        );
      },
    );
  }
  async reverse(
    session: IdentitySession,
    orgId: string,
    id: string,
    data: { requestKey: string; issueDate: string; reason: string },
  ) {
    return this.organizations.write(
      session,
      orgId,
      'invoices.correct',
      async (tx) => {
        const digest = checksum({ id, ...data });
        const [existing] = await tx
          .select()
          .from(invoices)
          .where(
            and(
              eq(invoices.organizationId, orgId),
              eq(invoices.createKey, data.requestKey),
            ),
          );
        if (existing) {
          if (existing.createDigest !== digest) deny('CONFLICT');
          return this.view(tx, existing);
        }
        const pending = await tx
          .select({ id: invoices.id })
          .from(invoices)
          .leftJoin(
            invoiceCancellations,
            and(
              eq(invoiceCancellations.organizationId, invoices.organizationId),
              eq(invoiceCancellations.invoiceId, invoices.id),
            ),
          )
          .where(
            and(
              eq(invoices.organizationId, orgId),
              eq(invoices.originalId, id),
              eq(invoices.documentType, 'credit_note'),
              eq(invoices.status, 'draft'),
              isNull(invoiceCancellations.invoiceId),
            ),
          )
          .limit(1);
        if (pending.length) deny('CONFLICT');
        const baseline = await this.snapshot(tx, orgId, id);
        const prior = await this.priorCorrections(tx, orgId, id);
        const lines = baseline.calculation.lines
          .map((line) => {
            let value = BigInt(line.supplyValue.replace('.', ''));
            for (const document of prior) {
              const previous = document.calculation.lines.find(
                (l) => l.id === line.id,
              );
              if (previous)
                value +=
                  (document.documentType === 'debit_note' ? 1n : -1n) *
                  BigInt(previous.supplyValue.replace('.', ''));
            }
            if (value < 0n) deny('CONFLICT');
            return {
              lineId: line.id,
              supplyValue:
                (value / 100n).toString() +
                '.' +
                (value % 100n).toString().padStart(2, '0'),
            };
          })
          .filter((l) => l.supplyValue !== '0.00');
        if (!lines.length) deny('CONFLICT');
        return this.correctionWrite(
          tx,
          session,
          orgId,
          id,
          { ...data, version: 0, documentType: 'credit_note', lines },
          undefined,
          digest,
        );
      },
    );
  }
  async cancel(
    session: IdentitySession,
    orgId: string,
    id: string,
    data: CancelInvoice,
  ) {
    return this.organizations.write(
      session,
      orgId,
      'invoices.cancel',
      async (tx, access) => {
        const row = await this.row(tx, orgId, id);
        const digest = checksum({ id, ...data });
        const existing = await this.cancelled(tx, orgId, id);
        if (existing) {
          if (
            existing.requestKey !== data.requestKey ||
            existing.requestDigest !== digest
          )
            deny('CONFLICT');
          return this.view(tx, row);
        }
        versionCheck(data.version, row.version);
        if (row.status === 'finalized') {
          if (row.originalId) deny('CORRECTION_UNSUPPORTED');
          if (!access.permissions.includes('invoices.finalize'))
            deny('FORBIDDEN');
          const profile = await this.profile(tx, orgId);
          if (profile.eInvoiceApplicability !== 'not_required')
            deny('EINVOICE_BLOCKED');
          assertCalculationReleased(row.documentType, 'cancel');
        }
        const children = await tx
          .select({ id: invoices.id })
          .from(invoices)
          .leftJoin(
            invoiceCancellations,
            and(
              eq(invoiceCancellations.organizationId, invoices.organizationId),
              eq(invoiceCancellations.invoiceId, invoices.id),
            ),
          )
          .where(
            and(
              eq(invoices.organizationId, orgId),
              eq(invoices.originalId, id),
              isNull(invoiceCancellations.invoiceId),
            ),
          )
          .limit(1);
        if (children.length) deny('CONFLICT');
        await tx.insert(invoiceCancellations).values({
          organizationId: orgId,
          invoiceId: id,
          requestKey: data.requestKey,
          requestDigest: digest,
          reason: data.reason,
          actorId: session.userId,
        });
        await this.organizations.identity.audit(
          tx,
          session.userId,
          'invoices.cancelled',
          id,
          orgId,
          {
            reason: data.reason,
            wasIssued: row.status === 'finalized',
            noSupplyConfirmed: true,
            notReportedConfirmed: true,
          },
        );
        return this.view(tx, row);
      },
    );
  }
}
