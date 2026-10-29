import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import {
  and,
  eq,
  sql,
  invoices,
  invoiceSeries,
  invoiceSnapshots,
  invoiceLines,
  invoiceTaxComponents,
  auditEvents,
  catalogItems,
  customers,
  roles,
  rolePermissions,
  membershipRoles,
  memberships,
} from '@gst/database';
import { createIsolatedTestDatabase } from '@gst/database/testing';
import { invoiceDraftSchema } from '@gst/contracts';
import type { InvoicePreview } from '@gst/contracts';
import { createApp } from '../app.js';
import { parseConfig } from '../config.js';
import { IdentityService } from '../security/identity.service.js';
import { OrganizationsService } from '../security/organizations.service.js';
import * as policy from './policy.js';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (!adminUrl)
  throw new Error(
    'TEST_DATABASE_ADMIN_URL required for disposable invoice test databases',
  );
let isolated: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
let app: INestApplication;
let orgs: OrganizationsService;
const password = 'Invoice integration private password!';
const headers = { Host: 'localhost:3000', Origin: 'http://localhost:5173' };
const address = {
  line1: '12 Market Road',
  line2: '',
  city: 'Mumbai',
  stateCode: '27',
  postalCode: '400001',
};
const http = () => request(app.getHttpServer());
beforeAll(async () => {
  isolated = await createIsolatedTestDatabase(adminUrl);
  const config = parseConfig({
    NODE_ENV: 'test',
    DATABASE_URL: isolated.connectionString,
    AUTH_DATA_KEY: 'ab'.repeat(32),
  });
  orgs = new OrganizationsService(
    new IdentityService(isolated.database, config),
  );
  app = await createApp(config, {
    ...isolated.database,
    close: async () => {},
  });
  await app.init();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await app?.close();
  await isolated?.cleanup();
});
async function setup() {
  const email = `${randomUUID()}@example.test`;
  const owner = await orgs.provisionOwner({
    organizationName: 'Invoice test',
    name: 'Owner',
    email,
    password,
  });
  const login = await http()
    .post('/api/v1/auth/login')
    .set(headers)
    .send({ email, password })
    .expect(201);
  const auth = {
    ...headers,
    Cookie: (login.headers['set-cookie'] as unknown as string[])[0]!.split(
      ';',
    )[0]!,
    'x-csrf-token': login.body.csrfToken as string,
  };
  const base = `/api/v1/organizations/${owner.organizationId}`;
  await http()
    .put(`${base}/business-profile`)
    .set(auth)
    .send({
      version: 0,
      legalName: 'Synthetic seller',
      address,
      gstin: '27AAPFU0939F1ZV',
      taxpayerType: 'regular',
      registrationConfirmed: true,
      eInvoiceApplicability: 'not_required',
    })
    .expect(200);
  const buyer = await http()
    .post(`${base}/customers`)
    .set(auth)
    .send({ version: 0, code: 'C1', name: 'Synthetic buyer', address })
    .expect(201);
  const item = await http()
    .post(`${base}/catalog`)
    .set(auth)
    .send({
      version: 0,
      code: 'P1',
      name: 'Synthetic item',
      kind: 'goods',
      unitCode: 'KGS',
      price: '100',
      priceIncludesGst: false,
      tax: {
        hsnSac: '100630',
        category: 'taxable',
        gstPercent: '18',
        effectiveFrom: '2026-10-29',
      },
    })
    .expect(201);
  await http()
    .post(`${base}/catalog/${item.body.id}/tax-review`)
    .set(auth)
    .send({
      version: item.body.version,
      reference: 'Synthetic test fixture, not statutory rate',
    })
    .expect(201);
  const draft = invoiceDraftSchema.parse({
    version: 0,
    customerId: buyer.body.id,
    issueDate: '2026-10-29',
    supplyDate: '2026-10-29',
    deliveryAddress: address,
    ordinarySupplyConfirmed: true,
    lines: [{ id: 'line-1', catalogItemId: item.body.id, quantity: '2.5' }],
  });
  return {
    ...owner,
    auth,
    base,
    path: `${base}/invoices`,
    draft,
    itemId: item.body.id as string,
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;
async function create(own: Setup, draft = own.draft, key = randomUUID()) {
  return (
    await http()
      .post(own.path)
      .set(own.auth)
      .send({ ...draft, requestKey: key })
      .expect(201)
  ).body;
}
async function preview(own: Setup, id: string): Promise<InvoicePreview> {
  return (
    await http().post(`${own.path}/${id}/preview`).set(own.auth).expect(201)
  ).body;
}
async function finalizeSynthetic(own: Setup, id: string, version = 1) {
  const p = await preview(own, id);
  // Tests ONLY: exercise dormant transaction machinery, never expose a release
  // bypass in the application/config. Production HTTP gate is tested separately.
  vi.spyOn(policy, 'assertCalculationReleased').mockImplementation(() => {});
  const data = { version, requestKey: randomUUID(), previewDigest: p.digest };
  const response = await http()
    .post(`${own.path}/${id}/finalize`)
    .set(own.auth)
    .send(data)
    .expect(201);
  return { record: response.body, data };
}
test('server calculation, persisted drafts, create retries, stale versions and HTTP validation', async () => {
  const own = await setup();
  const key = randomUUID();
  const p = await http()
    .post(`${own.path}/preview`)
    .set(own.auth)
    .send(own.draft)
    .expect(201);
  expect(p.body.print.totals).toMatchObject({
    supplyValue: '250.00',
    cgst: '22.50',
    sgst: '22.50',
    total: '295.00',
  });
  expect(p.body.print.number).toBeNull();
  expect(p.body.issuanceBlockers.length).toBeGreaterThan(0);
  const row = await create(own, own.draft, key);
  expect((await create(own, own.draft, key)).id).toBe(row.id);
  await http()
    .post(own.path)
    .set(own.auth)
    .send({ ...own.draft, notes: 'changed', requestKey: key })
    .expect(409);
  await http()
    .post(own.path)
    .set(own.auth)
    .send({ ...own.draft, requestKey: randomUUID(), totals: { total: '1' } })
    .expect(400);
  const updated = { ...own.draft, version: 1, notes: 'saved note' };
  const saves = await Promise.all([
    http().put(`${own.path}/${row.id}`).set(own.auth).send(updated),
    http().put(`${own.path}/${row.id}`).set(own.auth).send(updated),
  ]);
  expect(saves.map((r) => r.status).sort()).toEqual([200, 409]);
  const loaded = await http()
    .get(`${own.path}/${row.id}`)
    .set(own.auth)
    .expect(200);
  expect(loaded.body.draft.notes).toBe('saved note');
  expect(
    (await http().get(own.path).set(own.auth).expect(200)).body.items,
  ).toHaveLength(1);
  expect(
    await isolated.database.db
      .select()
      .from(invoiceSeries)
      .where(eq(invoiceSeries.organizationId, own.organizationId)),
  ).toHaveLength(0);
});
test('customer registration mismatch explains the required correction without blocking a different delivery state', async () => {
  const own = await setup();
  await isolated.database.db
    .update(customers)
    .set({ gstin: '08AAPFU0939F1ZV' })
    .where(eq(customers.id, own.draft.customerId));
  for (const path of [own.path, `${own.path}/preview`]) {
    const response = await http()
      .post(path)
      .set(own.auth)
      .send(
        path === own.path
          ? { ...own.draft, requestKey: randomUUID() }
          : own.draft,
      )
      .expect(400);
    expect(response.body.error.code).toBe('CUSTOMER_REGISTRATION_MISMATCH');
    expect(response.body.error.message).toContain(
      'saved billing-address state',
    );
  }
  expect(
    await isolated.database.db
      .select()
      .from(invoices)
      .where(eq(invoices.organizationId, own.organizationId)),
  ).toHaveLength(0);
  await isolated.database.db
    .update(customers)
    .set({ gstin: '27AAPFU0939F1ZV' })
    .where(eq(customers.id, own.draft.customerId));
  const row = await create(own, {
    ...own.draft,
    deliveryAddress: {
      ...address,
      stateCode: '07',
      city: 'Delhi',
      postalCode: '110001',
    },
  });
  expect(row.status).toBe('draft');
});

test('tenant access, CSRF, master-data archive and unreviewed classification fail safely', async () => {
  const own = await setup();
  const other = await setup();
  const row = await create(own);
  await http().get(`${own.path}/${row.id}`).set(other.auth).expect(403);
  await http().get(`${other.path}/${row.id}`).set(other.auth).expect(404);
  await http()
    .post(`${own.path}/preview`)
    .set({ ...own.auth, 'x-csrf-token': 'bad' })
    .send(own.draft)
    .expect(403);
  await http()
    .post(`${own.path}/preview`)
    .set(own.auth)
    .send({ ...own.draft, customerId: other.draft.customerId })
    .expect(404);
  await http()
    .post(`${own.path}/preview`)
    .set(own.auth)
    .send({
      ...own.draft,
      lines: [{ ...own.draft.lines[0], catalogItemId: other.itemId }],
    })
    .expect(404);
  await isolated.database.db
    .update(catalogItems)
    .set({ archivedAt: new Date() })
    .where(eq(catalogItems.id, own.itemId));
  const blocked = await http()
    .post(`${own.path}/preview`)
    .set(own.auth)
    .send(own.draft)
    .expect(409);
  expect(blocked.body.error.code).toBe('ARCHIVED_BILLING_RECORD');
  await expect(
    isolated.database.db.insert(invoices).values({
      organizationId: own.organizationId,
      registrationId: (
        await isolated.database.db
          .select()
          .from(invoices)
          .where(eq(invoices.id, row.id))
      )[0]!.registrationId,
      customerId: other.draft.customerId,
      customerName: 'forged',
      issueDate: '2026-10-29',
      draft: own.draft,
      createKey: randomUUID(),
      createDigest: 'a'.repeat(64),
    }),
  ).rejects.toThrow();
});
test('permission revocation immediately blocks reads and price overrides use current grants', async () => {
  const own = await setup();
  const row = await create(own);
  const [role] = await isolated.database.db
    .insert(roles)
    .values({ organizationId: own.organizationId, name: 'Invoice clerk' })
    .returning();
  await isolated.database.db.insert(rolePermissions).values(
    ['organization.read', 'invoices.read', 'invoices.manage'].map(
      (permissionKey) => ({
        organizationId: own.organizationId,
        roleId: role!.id,
        permissionKey,
      }),
    ),
  );
  // Switch the synthetic owner to non-owner after creating a second active owner.
  const email = `${randomUUID()}@example.test`;
  const existingSession = await orgs.identity.authenticate(
    own.auth.Cookie.split('=')[1],
  );
  const added = await orgs.addMember(existingSession, own.organizationId, {
    email,
    name: 'Second owner',
    temporaryPassword: password,
    roleIds: [],
  });
  await isolated.database.db
    .update(memberships)
    .set({ isOwner: true })
    .where(eq(memberships.id, added.id));
  await isolated.database.db.insert(membershipRoles).values({
    organizationId: own.organizationId,
    membershipId: own.membershipId,
    roleId: role!.id,
  });
  await isolated.database.db
    .update(memberships)
    .set({ isOwner: false })
    .where(eq(memberships.id, own.membershipId));
  await http().get(`${own.path}/${row.id}`).set(own.auth).expect(200);
  const response = await http()
    .post(`${own.path}/preview`)
    .set(own.auth)
    .send({
      ...own.draft,
      lines: [
        {
          ...own.draft.lines[0],
          priceOverride: { unitPrice: '1', reason: 'Customer negotiation' },
        },
      ],
    })
    .expect(400);
  expect(response.body.error.code).toBe('PERMISSION_DENIED');
  await isolated.database.db
    .delete(rolePermissions)
    .where(
      and(
        eq(rolePermissions.roleId, role!.id),
        eq(rolePermissions.permissionKey, 'invoices.read'),
      ),
    );
  await http().get(`${own.path}/${row.id}`).set(own.auth).expect(403);
});
test('real release gate, changed preview and e-invoice gates allocate no numbers', async () => {
  const own = await setup();
  const row = await create(own);
  const p = await preview(own, row.id);
  const data = {
    version: 1,
    requestKey: randomUUID(),
    previewDigest: p.digest,
  };
  const blocked = await http()
    .post(`${own.path}/${row.id}/finalize`)
    .set(own.auth)
    .send(data)
    .expect(409);
  expect(blocked.body.error.code).toBe('ISSUANCE_BLOCKED');
  await isolated.database.db
    .update(catalogItems)
    .set({ price: '200' })
    .where(eq(catalogItems.id, own.itemId));
  const changed = await http()
    .post(`${own.path}/${row.id}/finalize`)
    .set(own.auth)
    .send(data)
    .expect(409);
  expect(changed.body.error.code).toBe('BILLING_REVIEW_REQUIRED');
  await isolated.database.db.execute(
    sql`update business_profiles set e_invoice_applicability='required' where organization_id=${own.organizationId}`,
  );
  const current = await preview(own, row.id);
  const irp = await http()
    .post(`${own.path}/${row.id}/finalize`)
    .set(own.auth)
    .send({ ...data, previewDigest: current.digest })
    .expect(409);
  expect(irp.body.error.code).toBe('EINVOICE_BLOCKED');
  expect(
    await isolated.database.db
      .select()
      .from(invoiceSeries)
      .where(eq(invoiceSeries.organizationId, own.organizationId)),
  ).toHaveLength(0);
});
test('synthetic release transaction assigns numbers once, retries safely and stores immutable historical values', async () => {
  const own = await setup();
  const row = await create(own);
  const { record, data } = await finalizeSynthetic(own, row.id);
  expect(record.number).toBe('INV/2627/000001');
  expect(record.status).toBe('finalized');
  const retry = await http()
    .post(`${own.path}/${row.id}/finalize`)
    .set(own.auth)
    .send(data)
    .expect(201);
  expect(retry.body.number).toBe(record.number);
  await http()
    .post(`${own.path}/${row.id}/finalize`)
    .set(own.auth)
    .send({ ...data, requestKey: randomUUID() })
    .expect(409);
  await http()
    .put(`${own.path}/${row.id}`)
    .set(own.auth)
    .send({ ...own.draft, version: 2 })
    .expect(409);
  await isolated.database.db
    .update(catalogItems)
    .set({ price: '999', name: 'Changed catalog' })
    .where(eq(catalogItems.id, own.itemId));
  await isolated.database.db
    .update(customers)
    .set({ name: 'Changed customer', archivedAt: new Date() })
    .where(eq(customers.id, own.draft.customerId));
  const copy = (
    await http().get(`${own.path}/${row.id}`).set(own.auth).expect(200)
  ).body;
  expect(copy.snapshot.totals.total).toBe('295.00');
  expect(copy.snapshot.recipient.name).toBe('Synthetic buyer');
  expect(copy.snapshotDigest).toBe(record.snapshotDigest);
  for (const operation of [
    isolated.database.db
      .update(invoices)
      .set({ customerName: 'tamper' })
      .where(eq(invoices.id, row.id)),
    isolated.database.db.delete(invoices).where(eq(invoices.id, row.id)),
    isolated.database.db
      .update(invoiceSnapshots)
      .set({ digest: '0'.repeat(64) })
      .where(eq(invoiceSnapshots.invoiceId, row.id)),
    isolated.database.db
      .delete(invoiceLines)
      .where(eq(invoiceLines.invoiceId, row.id)),
    isolated.database.db
      .delete(invoiceTaxComponents)
      .where(eq(invoiceTaxComponents.invoiceId, row.id)),
    isolated.database.db
      .update(invoiceSeries)
      .set({ nextCounter: 1 })
      .where(eq(invoiceSeries.organizationId, own.organizationId)),
  ])
    await expect(operation).rejects.toThrow();
});
test('synthetic concurrent finalization is consecutive and transaction rollback reuses uncommitted allocation', async () => {
  const own = await setup();
  const a = await create(own);
  const b = await create(own);
  const pa = await preview(own, a.id);
  const pb = await preview(own, b.id);
  vi.spyOn(policy, 'assertCalculationReleased').mockImplementation(() => {});
  const responses = await Promise.all(
    [a, b].map((row, i) =>
      http()
        .post(`${own.path}/${row.id}/finalize`)
        .set(own.auth)
        .send({
          version: 1,
          requestKey: randomUUID(),
          previewDigest: [pa, pb][i]!.digest,
        }),
    ),
  );
  expect(responses.map((r) => r.status)).toEqual([201, 201]);
  expect(responses.map((r) => r.body.number).sort()).toEqual([
    'INV/2627/000001',
    'INV/2627/000002',
  ]);
  const c = await create(own);
  const pc = await preview(own, c.id);
  await isolated.database.db.execute(
    sql`create function public.fail_test_finalization() returns trigger language plpgsql as $$ begin if NEW.action='invoices.finalized' then raise exception 'test rollback'; end if; return NEW; end $$`,
  );
  await isolated.database.db.execute(
    sql`create trigger fail_test_audit before insert on audit_events for each row execute function public.fail_test_finalization()`,
  );
  try {
    await http()
      .post(`${own.path}/${c.id}/finalize`)
      .set(own.auth)
      .send({ version: 1, requestKey: randomUUID(), previewDigest: pc.digest })
      .expect(500);
  } finally {
    await isolated.database.db.execute(
      sql`drop trigger fail_test_audit on audit_events`,
    );
    await isolated.database.db.execute(
      sql`drop function public.fail_test_finalization()`,
    );
  }
  expect(
    (
      await isolated.database.db
        .select()
        .from(invoiceSeries)
        .where(eq(invoiceSeries.organizationId, own.organizationId))
    )[0]!.nextCounter,
  ).toBe(3);
  expect(
    await isolated.database.db
      .select()
      .from(invoiceSnapshots)
      .where(eq(invoiceSnapshots.invoiceId, c.id)),
  ).toHaveLength(0);
  const finalized = await finalizeSynthetic(own, c.id);
  expect(finalized.record.number).toBe('INV/2627/000003');
  expect(
    await isolated.database.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, c.id),
          eq(auditEvents.action, 'invoices.finalized'),
        ),
      ),
  ).toHaveLength(1);
});
test('synthetic full credit preserves original values despite archives and prevents duplicate reversals', async () => {
  const own = await setup();
  const draft = await create(own);
  const original = await finalizeSynthetic(own, draft.id);
  await isolated.database.db
    .update(catalogItems)
    .set({ price: '9999', archivedAt: new Date() })
    .where(eq(catalogItems.id, own.itemId));
  const body = {
    requestKey: randomUUID(),
    issueDate: '2026-10-29',
    reason: 'Full return of original goods',
  };
  const credit = (
    await http()
      .post(`${own.path}/${draft.id}/full-credit`)
      .set(own.auth)
      .send(body)
      .expect(201)
  ).body;
  expect(
    (
      await http()
        .post(`${own.path}/${draft.id}/full-credit`)
        .set(own.auth)
        .send(body)
        .expect(201)
    ).body.id,
  ).toBe(credit.id);
  await http()
    .post(`${own.path}/${draft.id}/full-credit`)
    .set(own.auth)
    .send({ ...body, requestKey: randomUUID() })
    .expect(409);
  const finalized = await finalizeSynthetic(own, credit.id);
  expect(finalized.record.number).toBe('CN/2627/000001');
  expect(finalized.record.snapshot.totals).toEqual(
    original.record.snapshot.totals,
  );
  expect(finalized.record.snapshot.originalNumber).toBe(original.record.number);
  await http()
    .post(`${own.path}/${credit.id}/full-credit`)
    .set(own.auth)
    .send({ ...body, requestKey: randomUUID() })
    .expect(409);
});

test('reviewed baseline and authorized override provenance are enforced by the HTTP adapter', async () => {
  const own = await setup();
  const withOverrides = {
    ...own.draft,
    lines: [
      {
        ...own.draft.lines[0],
        priceOverride: { unitPrice: '80', reason: 'Negotiated price' },
        taxOverride: {
          hsnSac: '100630',
          category: 'taxable',
          gstPercent: '12',
          effectiveFrom: '2026-10-29',
          reason: 'Reviewed exception',
          sourceReference: 'Synthetic source reference',
        },
        placeOfSupplyOverride: {
          stateCode: '29',
          reason: 'Reviewed delivery location',
        },
      },
    ],
  };
  const p = await http()
    .post(`${own.path}/preview`)
    .set(own.auth)
    .send(withOverrides)
    .expect(201);
  expect(p.body.print.totals).toMatchObject({
    supplyValue: '200.00',
    igst: '24.00',
    total: '224.00',
  });
  const draft = await create(own, invoiceDraftSchema.parse(withOverrides));
  const final = await finalizeSynthetic(own, draft.id);
  const [snapshot] = await isolated.database.db
    .select()
    .from(invoiceSnapshots)
    .where(eq(invoiceSnapshots.invoiceId, final.record.id));
  const payload = snapshot!.payload as {
    calculation: { overrides: { actorId: string; reason: string }[] };
  };
  expect(payload.calculation.overrides).toHaveLength(3);
  expect(
    payload.calculation.overrides.every(
      (o) => o.actorId === own.userId && o.reason.length >= 5,
    ),
  ).toBe(true);
  const item = (
    await http()
      .get(`${own.base}/catalog/${own.itemId}`)
      .set(own.auth)
      .expect(200)
  ).body;
  const {
    id: _id,
    archivedAt: _archivedAt,
    updatedAt: _updatedAt,
    ...input
  } = item;
  void _id;
  void _archivedAt;
  void _updatedAt;
  // HTTP input permits only classification fields, not the server review proof.
  input.tax = {
    hsnSac: item.tax.hsnSac,
    category: 'taxable',
    gstPercent: '15',
    effectiveFrom: '2026-10-29',
  };
  await http()
    .put(`${own.base}/catalog/${own.itemId}`)
    .set(own.auth)
    .send(input)
    .expect(200);
  const blocked = await http()
    .post(`${own.path}/preview`)
    .set(own.auth)
    .send(withOverrides)
    .expect(400);
  expect(blocked.body.error.code).toBe('TAX_NOT_REVIEWED');
});

test('deferred guards reject missing snapshots and mismatched normalized financial rows', async () => {
  const own = await setup();
  const row = await create(own);
  await expect(
    isolated.database.db
      .update(invoices)
      .set({
        status: 'finalized',
        version: 2,
        financialYear: '2627',
        number: 'INV/2627/000001',
        finalizedAt: new Date(),
        finalizeKey: randomUUID(),
        finalizeDigest: 'a'.repeat(64),
      })
      .where(eq(invoices.id, row.id)),
  ).rejects.toThrow();
  const p = await preview(own, row.id);
  vi.spyOn(policy, 'assertCalculationReleased').mockImplementation(() => {});
  await isolated.database.db.execute(
    sql`create function public.corrupt_test_line() returns trigger language plpgsql as $$ begin NEW.supply_value=NEW.supply_value+1; NEW.total=NEW.total+1; return NEW; end $$`,
  );
  await isolated.database.db.execute(
    sql`create trigger corrupt_test_line before insert on invoice_lines for each row execute function public.corrupt_test_line()`,
  );
  try {
    await http()
      .post(`${own.path}/${row.id}/finalize`)
      .set(own.auth)
      .send({ version: 1, requestKey: randomUUID(), previewDigest: p.digest })
      .expect(409);
  } finally {
    await isolated.database.db.execute(
      sql`drop trigger corrupt_test_line on invoice_lines`,
    );
    await isolated.database.db.execute(
      sql`drop function public.corrupt_test_line()`,
    );
  }
  expect(
    await isolated.database.db
      .select()
      .from(invoiceSeries)
      .where(eq(invoiceSeries.organizationId, own.organizationId)),
  ).toHaveLength(0);
  expect(
    await isolated.database.db
      .select()
      .from(invoiceSnapshots)
      .where(eq(invoiceSnapshots.invoiceId, row.id)),
  ).toHaveLength(0);
});

test('partial credits and debit notes are versioned, historical, idempotent and capped on finalization', async () => {
  const own = await setup();
  const row = await create(own);
  await finalizeSynthetic(own, row.id);
  const body = {
    version: 0,
    requestKey: randomUUID(),
    documentType: 'credit_note',
    issueDate: '2026-10-29',
    reason: 'Partial goods return',
    lines: [{ lineId: 'line-1', supplyValue: '50.00' }],
  };
  const credit = (
    await http()
      .post(`${own.path}/${row.id}/corrections`)
      .set(own.auth)
      .send(body)
      .expect(201)
  ).body;
  expect(
    (
      await http()
        .post(`${own.path}/${row.id}/corrections`)
        .set(own.auth)
        .send(body)
        .expect(201)
    ).body.id,
  ).toBe(credit.id);
  const edited = (
    await http()
      .put(`${own.path}/${credit.id}/correction`)
      .set(own.auth)
      .send({ ...body, version: 1, reason: 'Partial return after discussion' })
      .expect(200)
  ).body;
  await http()
    .put(`${own.path}/${credit.id}/correction`)
    .set(own.auth)
    .send({ ...body, version: 1 })
    .expect(409);
  const result = await finalizeSynthetic(own, credit.id, edited.version);
  expect(result.record.snapshot.totals.total).toBe('59.00');
  expect(result.record.snapshot.valueAdjustment).toBe(true);
  const debitBody = {
    ...body,
    requestKey: randomUUID(),
    documentType: 'debit_note',
    reason: 'Additional agreed supply value',
    lines: [{ lineId: 'line-1', supplyValue: '10.00' }],
  };
  const debit = (
    await http()
      .post(`${own.path}/${row.id}/corrections`)
      .set(own.auth)
      .send(debitBody)
      .expect(201)
  ).body;
  const debited = await finalizeSynthetic(own, debit.id);
  expect(debited.record.number).toBe('DN/2627/000001');
  expect(debited.record.snapshot.totals.total).toBe('11.80');
  await http()
    .post(`${own.path}/${row.id}/corrections`)
    .set(own.auth)
    .send({
      ...body,
      requestKey: randomUUID(),
      lines: [{ lineId: 'line-1', supplyValue: '210.01' }],
    })
    .expect(400);
  const remaining = (
    await http()
      .post(`${own.path}/${row.id}/full-credit`)
      .set(own.auth)
      .send({
        requestKey: randomUUID(),
        issueDate: '2026-10-29',
        reason: 'Return remaining supply',
      })
      .expect(201)
  ).body;
  const final = await finalizeSynthetic(own, remaining.id);
  expect(final.record.snapshot.totals.total).toBe('247.80');
});

test('concurrent credits revalidate capacity and roll back the losing number allocation', async () => {
  const own = await setup();
  const original = await create(own);
  await finalizeSynthetic(own, original.id);
  const createCredit = async () =>
    (
      await http()
        .post(`${own.path}/${original.id}/corrections`)
        .set(own.auth)
        .send({
          version: 0,
          requestKey: randomUUID(),
          documentType: 'credit_note',
          issueDate: '2026-10-29',
          reason: 'Concurrent credit attempt',
          lines: [{ lineId: 'line-1', supplyValue: '200' }],
        })
        .expect(201)
    ).body;
  const a = await createCredit();
  const b = await createCredit();
  const pa = await preview(own, a.id);
  const pb = await preview(own, b.id);
  const responses = await Promise.all(
    [a, b].map((r, i) =>
      http()
        .post(`${own.path}/${r.id}/finalize`)
        .set(own.auth)
        .send({
          version: 1,
          requestKey: randomUUID(),
          previewDigest: [pa, pb][i]!.digest,
        }),
    ),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
  const [series] = await isolated.database.db
    .select()
    .from(invoiceSeries)
    .where(
      and(
        eq(invoiceSeries.organizationId, own.organizationId),
        eq(invoiceSeries.documentType, 'credit_note'),
      ),
    );
  expect(series!.nextCounter).toBe(2);
});

test('cancellation is append-only, blocks further edits, preserves snapshots/numbers and enforces the real gate', async () => {
  const own = await setup();
  const draft = await create(own);
  const body = {
    version: 1,
    requestKey: randomUUID(),
    reason: 'Draft entered in error',
    noSupplyConfirmed: true,
    notReportedConfirmed: true,
  };
  const cancelled = (
    await http()
      .post(`${own.path}/${draft.id}/cancel`)
      .set(own.auth)
      .send(body)
      .expect(201)
  ).body;
  expect(cancelled.status).toBe('cancelled');
  expect(cancelled.number).toBeNull();
  await http()
    .post(`${own.path}/${draft.id}/cancel`)
    .set(own.auth)
    .send(body)
    .expect(201);
  await http()
    .put(`${own.path}/${draft.id}`)
    .set(own.auth)
    .send({ ...own.draft, version: 1 })
    .expect(409);
  await http()
    .post(`${own.path}/${draft.id}/preview`)
    .set(own.auth)
    .expect(409);
  const original = await create(own);
  const issued = await finalizeSynthetic(own, original.id);
  vi.restoreAllMocks();
  const issuedBody = {
    ...body,
    version: issued.record.version,
    requestKey: randomUUID(),
    reason: 'No supply and document not reported',
  };
  expect(
    (
      await http()
        .post(`${own.path}/${original.id}/cancel`)
        .set(own.auth)
        .send(issuedBody)
        .expect(409)
    ).body.error.code,
  ).toBe('ISSUANCE_BLOCKED');
  vi.spyOn(policy, 'assertCalculationReleased').mockImplementation(() => {});
  const result = (
    await http()
      .post(`${own.path}/${original.id}/cancel`)
      .set(own.auth)
      .send(issuedBody)
      .expect(201)
  ).body;
  expect(result.status).toBe('cancelled');
  expect(result.number).toBe(issued.record.number);
  expect(result.snapshotDigest).toBe(issued.record.snapshotDigest);
  expect(result.snapshot.cancellation.reason).toBe(issuedBody.reason);
  await http()
    .post(`${own.path}/${original.id}/corrections`)
    .set(own.auth)
    .send({
      version: 0,
      requestKey: randomUUID(),
      documentType: 'debit_note',
      issueDate: '2026-10-29',
      reason: 'Invalid cancelled original',
      lines: [{ lineId: 'line-1', supplyValue: '1' }],
    })
    .expect(409);
  await expect(
    isolated.database.db.execute(
      sql`delete from invoice_cancellations where invoice_id=${original.id}`,
    ),
  ).rejects.toThrow();
});

test('logos are bounded, tenant-scoped business data frozen into issued print snapshots', async () => {
  const own = await setup();
  const get = () => http().get(`${own.base}/business-profile`).set(own.auth);
  const profile = (await get().expect(200)).body.profile;
  const {
    registrationId: _registrationId,
    registrationConfirmedAt: _confirmedAt,
    updatedAt: _updated,
    ...input
  } = profile;
  void _registrationId;
  void _confirmedAt;
  void _updated;
  const logo =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  await http()
    .put(`${own.base}/business-profile`)
    .set(own.auth)
    .send({ ...input, logoDataUrl: 'data:image/svg+xml,<svg/>' })
    .expect(400);
  await http()
    .put(`${own.base}/business-profile`)
    .set(own.auth)
    .send({ ...input, logoDataUrl: logo })
    .expect(200);
  const row = await create(own);
  const issued = await finalizeSynthetic(own, row.id);
  expect(issued.record.snapshot.supplier.logoDataUrl).toBe(logo);
  const current = (await get().expect(200)).body.profile;
  await http()
    .put(`${own.base}/business-profile`)
    .set(own.auth)
    .send({ ...input, version: current.version, logoDataUrl: '' })
    .expect(200);
  const copy = (
    await http().get(`${own.path}/${row.id}`).set(own.auth).expect(200)
  ).body;
  expect(copy.snapshot.supplier.logoDataUrl).toBe(logo);
});
