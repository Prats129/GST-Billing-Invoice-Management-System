import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import {
  and,
  eq,
  sql,
  gstRegistrations,
  catalogTaxRevisions,
  catalogTaxReviews,
  customers,
  catalogItems,
  users,
  roles,
  rolePermissions,
  memberships,
  membershipRoles,
  auditEvents,
} from '@gst/database';
import { createIsolatedTestDatabase } from '@gst/database/testing';
import { createApp } from '../app.js';
import { parseConfig } from '../config.js';
import { IdentityService } from '../security/identity.service.js';
import { OrganizationsService } from '../security/organizations.service.js';
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (!adminUrl)
  throw new Error(
    'TEST_DATABASE_ADMIN_URL required for isolated business integration tests',
  );
let isolated: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
let app: INestApplication;
let orgs: OrganizationsService;
const password = 'Business integration private password!';
const headers = { Host: 'localhost:3000', Origin: 'http://localhost:5173' };
const address = {
  line1: '12 Market Road',
  line2: '',
  city: 'Mumbai',
  stateCode: '27',
  postalCode: '400001',
};
const profile = {
  version: 0,
  legalName: 'Example business',
  address,
  gstin: '27AAPFU0939F1ZV',
  taxpayerType: 'regular',
  registrationConfirmed: false,
  eInvoiceApplicability: 'unknown',
};
const customer = { version: 0, code: 'C-001', name: 'Example buyer', address };
const item = {
  version: 0,
  code: 'P-001',
  name: 'Example product',
  kind: 'goods',
  unitCode: 'KGS',
  price: '99999999999999.9999',
  priceIncludesGst: true,
  tax: {
    hsnSac: '100630',
    category: 'taxable',
    gstPercent: '5',
    effectiveFrom: '2026-10-28',
  },
};
const http = () => request(app.getHttpServer());
async function setup() {
  const email = `${randomUUID()}@example.test`;
  const owner = await orgs.provisionOwner({
    organizationName: 'Business test',
    name: 'Owner',
    email,
    password,
  });
  const response = await http()
    .post('/api/v1/auth/login')
    .set(headers)
    .send({ email, password })
    .expect(201);
  const auth = {
    ...headers,
    Cookie: (response.headers['set-cookie'] as unknown as string[])[0]!.split(
      ';',
    )[0]!,
    'x-csrf-token': response.body.csrfToken as string,
  };
  return {
    ...owner,
    auth,
    path: `/api/v1/organizations/${owner.organizationId}`,
  };
}
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
afterAll(async () => {
  await app?.close();
  await isolated?.cleanup();
});
test('profile updates preserve registration history, enforce versions and reject unsupported setup', async () => {
  const own = await setup();
  expect(
    (await http().get(`${own.path}/business-profile`).set(own.auth).expect(200))
      .body.profile,
  ).toBeNull();
  const saved = await http()
    .put(`${own.path}/business-profile`)
    .set(own.auth)
    .send(profile)
    .expect(200);
  expect(saved.body).toMatchObject({
    version: 1,
    gstin: profile.gstin,
    registrationConfirmed: false,
  });
  await http()
    .put(`${own.path}/business-profile`)
    .set(own.auth)
    .send(profile)
    .expect(409);
  const changed = await http()
    .put(`${own.path}/business-profile`)
    .set(own.auth)
    .send({
      ...profile,
      version: 1,
      gstin: '27AAPFU0939F2ZU',
      registrationConfirmed: true,
    })
    .expect(200);
  expect(changed.body.registrationId).not.toBe(saved.body.registrationId);
  const regs = await isolated.database.db
    .select()
    .from(gstRegistrations)
    .where(eq(gstRegistrations.organizationId, own.organizationId));
  expect(regs).toHaveLength(2);
  expect(regs.filter((reg) => reg.active)).toHaveLength(1);
  await http()
    .put(`${own.path}/business-profile`)
    .set(own.auth)
    .send({ ...profile, version: 2, taxpayerType: 'composition' })
    .expect(400);
  await http()
    .put(`${own.path}/business-profile`)
    .set(own.auth)
    .send({ ...profile, version: 2, address: { ...address, stateCode: '29' } })
    .expect(400);
  const { 'x-csrf-token': removed, ...withoutCsrf } = own.auth;
  void removed;
  await http()
    .put(`${own.path}/business-profile`)
    .set(withoutCsrf)
    .send({ ...profile, version: 2 })
    .expect(403);
});
test('customers enforce tenant isolation, normalized uniqueness, archive/restore and concurrent version checks', async () => {
  const own = await setup();
  const other = await setup();
  const saved = (
    await http()
      .post(`${own.path}/customers`)
      .set(own.auth)
      .send(customer)
      .expect(201)
  ).body;
  await http()
    .post(`${own.path}/customers`)
    .set(own.auth)
    .send({ ...customer, code: 'c-001' })
    .expect(409);
  await http()
    .get(`${own.path}/customers/${saved.id}`)
    .set(other.auth)
    .expect(403);
  await http()
    .put(`${other.path}/customers/${saved.id}`)
    .set(other.auth)
    .send({ ...customer, version: 1 })
    .expect(404);
  await http()
    .put(`${other.path}/customers/${saved.id}/archive`)
    .set(other.auth)
    .send({ version: 1, archived: true })
    .expect(404);
  const attempts = await Promise.all(
    ['First editor', 'Second editor'].map((name) =>
      http()
        .put(`${own.path}/customers/${saved.id}`)
        .set(own.auth)
        .send({ ...customer, name, version: 1 }),
    ),
  );
  expect(attempts.map((result) => result.status).sort()).toEqual([200, 409]);
  await http()
    .put(`${own.path}/customers/${saved.id}/archive`)
    .set(own.auth)
    .send({ version: 2, archived: true })
    .expect(200);
  expect(
    (await http().get(`${own.path}/customers`).set(own.auth).expect(200)).body
      .items,
  ).toHaveLength(0);
  expect(
    (
      await http()
        .get(`${own.path}/customers?status=archived`)
        .set(own.auth)
        .expect(200)
    ).body.items,
  ).toHaveLength(1);
  await http()
    .put(`${own.path}/customers/${saved.id}`)
    .set(own.auth)
    .send({ ...customer, version: 3 })
    .expect(409);
  await http()
    .put(`${own.path}/customers/${saved.id}/archive`)
    .set(own.auth)
    .send({ version: 3, archived: false })
    .expect(200);
  expect(
    (
      await http()
        .get(`${own.path}/customers/${saved.id}`)
        .set(own.auth)
        .expect(200)
    ).body.version,
  ).toBe(4);
  await http()
    .delete(`${own.path}/customers/${saved.id}`)
    .set(own.auth)
    .expect(404);
});
test('catalog preserves exact prices, immutable classification/review history and invalidates review on semantic changes', async () => {
  const own = await setup();
  const other = await setup();
  let saved = (
    await http()
      .post(`${own.path}/catalog`)
      .set(own.auth)
      .send(item)
      .expect(201)
  ).body;
  expect(saved).toMatchObject({
    price: item.price,
    tax: { gstPercent: '5.00', revision: 1, verifiedAt: null },
  });
  await http()
    .get(`${other.path}/catalog/${saved.id}`)
    .set(other.auth)
    .expect(404);
  saved = (
    await http()
      .post(`${own.path}/catalog/${saved.id}/tax-review`)
      .set(own.auth)
      .send({
        version: 1,
        reference: 'Operator consulted current notification',
      })
      .expect(201)
  ).body;
  expect(saved.tax.verifiedAt).toBeTruthy();
  const firstTax = saved.tax;
  saved = (
    await http()
      .put(`${own.path}/catalog/${saved.id}`)
      .set(own.auth)
      .send({ ...item, version: 2, price: '0.1001' })
      .expect(200)
  ).body;
  expect(saved.tax.id).toBe(firstTax.id);
  expect(saved.price).toBe('0.1001');
  saved = (
    await http()
      .put(`${own.path}/catalog/${saved.id}`)
      .set(own.auth)
      .send({
        ...item,
        version: 3,
        name: 'Different product',
        tax: { ...item.tax, gstPercent: '12' },
      })
      .expect(200)
  ).body;
  expect(saved.tax).toMatchObject({
    revision: 2,
    verifiedAt: null,
    gstPercent: '12.00',
  });
  const history = (
    await http()
      .get(`${own.path}/catalog/${saved.id}/tax-history`)
      .set(own.auth)
      .expect(200)
  ).body;
  expect(history).toHaveLength(2);
  expect(history[1].verifiedAt).toBeTruthy();
  await http()
    .post(`${own.path}/catalog/${saved.id}/tax-review`)
    .set(own.auth)
    .send({ version: 2, reference: 'Stale review attempt' })
    .expect(409);
  await expect(
    isolated.database.db
      .update(catalogTaxRevisions)
      .set({ gstPercent: '18' })
      .where(eq(catalogTaxRevisions.id, firstTax.id)),
  ).rejects.toThrow();
  await expect(
    isolated.database.db
      .delete(catalogTaxReviews)
      .where(eq(catalogTaxReviews.revisionId, firstTax.id)),
  ).rejects.toThrow();
  await expect(
    isolated.database.db.insert(catalogTaxRevisions).values({
      organizationId: other.organizationId,
      itemId: saved.id,
      revision: 1,
      hsnSac: '100630',
      category: 'taxable',
      gstPercent: '5',
      effectiveFrom: '2026-10-28',
      createdBy: other.userId,
    }),
  ).rejects.toThrow();
  await http()
    .post(`${own.path}/catalog`)
    .set(own.auth)
    .send({ ...item, code: 'BAD', price: 0.1 })
    .expect(400);
  await http()
    .post(`${own.path}/catalog`)
    .set(own.auth)
    .send({
      ...item,
      code: 'BAD',
      tax: { ...item.tax, verifiedBy: own.userId },
    })
    .expect(400);
  await http()
    .put(`${own.path}/catalog/${saved.id}/archive`)
    .set(own.auth)
    .send({ version: 4, archived: true })
    .expect(200);
  await http()
    .post(`${own.path}/catalog/${saved.id}/tax-review`)
    .set(own.auth)
    .send({ version: 5, reference: 'Current notification' })
    .expect(409);
});
test('search escapes SQL wildcards, pagination is bounded and writes audit atomically', async () => {
  const own = await setup();
  await http()
    .post(`${own.path}/customers`)
    .set(own.auth)
    .send({ ...customer, name: '100% buyer' })
    .expect(201);
  await http()
    .post(`${own.path}/customers`)
    .set(own.auth)
    .send({ ...customer, code: 'C-002', name: 'Other buyer' })
    .expect(201);
  expect(
    (await http().get(`${own.path}/customers?q=%25`).set(own.auth).expect(200))
      .body.items,
  ).toHaveLength(1);
  await http().get(`${own.path}/customers?offset=-1`).set(own.auth).expect(400);
  await http()
    .get(`${own.path}/catalog?status=deleted`)
    .set(own.auth)
    .expect(400);
  await isolated.database.db.insert(customers).values(
    Array.from({ length: 51 }, (_, index) => ({
      organizationId: own.organizationId,
      code: `PAGE-${index}`,
      name: `Page buyer ${String(index).padStart(2, '0')}`,
      address,
    })),
  );
  const firstPage = (
    await http()
      .get(`${own.path}/customers?q=Page%20buyer`)
      .set(own.auth)
      .expect(200)
  ).body;
  const secondPage = (
    await http()
      .get(`${own.path}/customers?q=Page%20buyer&offset=50`)
      .set(own.auth)
      .expect(200)
  ).body;
  expect(firstPage.items).toHaveLength(50);
  expect(firstPage.hasMore).toBe(true);
  expect(secondPage.items).toHaveLength(1);
  expect(secondPage.hasMore).toBe(false);
  expect(
    firstPage.items.some(
      (row: { id: string }) => row.id === secondPage.items[0].id,
    ),
  ).toBe(false);
  const rows = await isolated.database.db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organizationId, own.organizationId),
        eq(auditEvents.action, 'customers.created'),
      ),
    );
  expect(rows).toHaveLength(2);
  // Failure of the audit insert rolls back the domain write in the same transaction.
  await isolated.database.db.execute(
    sql`create function public.fail_business_audit() returns trigger language plpgsql as $$ begin if NEW.action = 'customers.updated' then raise exception 'test audit unavailable'; end if; return NEW; end $$`,
  );
  await isolated.database.db.execute(
    sql`create trigger fail_business_audit before insert on public.audit_events for each row execute function public.fail_business_audit()`,
  );
  try {
    const [old] = await isolated.database.db
      .select()
      .from(customers)
      .where(eq(customers.organizationId, own.organizationId))
      .limit(1);
    await http()
      .put(`${own.path}/customers/${old!.id}`)
      .set(own.auth)
      .send({
        ...customer,
        code: old!.code,
        version: 1,
        name: 'Must roll back',
      })
      .expect(500);
    const [unchanged] = await isolated.database.db
      .select()
      .from(customers)
      .where(eq(customers.id, old!.id));
    expect(unchanged!.name).toBe(old!.name);
    expect(unchanged!.version).toBe(1);
  } finally {
    await isolated.database.db.execute(
      sql`drop trigger fail_business_audit on public.audit_events`,
    );
    await isolated.database.db.execute(
      sql`drop function public.fail_business_audit()`,
    );
  }
});
test('database rejects non-finite prices and catalog items without a classification', async () => {
  const own = await setup();
  const values = {
    organizationId: own.organizationId,
    code: 'DB-GUARD',
    name: 'Guarded item',
    kind: 'goods',
    unitCode: 'NOS',
    price: 'NaN',
  };
  await expect(
    isolated.database.db.insert(catalogItems).values(values),
  ).rejects.toThrow();
  await expect(
    isolated.database.db
      .insert(catalogItems)
      .values({ ...values, price: '1.0000' }),
  ).rejects.toThrow();
});
test('SaaS customer/catalog managers and tax reviewers must complete MFA', async () => {
  const config = parseConfig({
    NODE_ENV: 'test',
    DEPLOYMENT_EDITION: 'saas',
    DATABASE_URL: isolated.connectionString,
    AUTH_DATA_KEY: 'ab'.repeat(32),
  });
  const identity = new IdentityService(isolated.database, config);
  const service = new OrganizationsService(identity);
  const owner = await service.provisionOwner({
    email: `${randomUUID()}@example.test`,
    name: 'SaaS owner',
    organizationName: 'SaaS business',
    password,
  });
  const [ownerUser] = await isolated.database.db
    .select()
    .from(users)
    .where(eq(users.id, owner.userId));
  const email = `${randomUUID()}@example.test`;
  const [user] = await isolated.database.db
    .insert(users)
    .values({
      edition: 'saas',
      email,
      name: 'SaaS manager',
      passwordHash: ownerUser!.passwordHash,
    })
    .returning();
  const [membership] = await isolated.database.db
    .insert(memberships)
    .values({
      edition: 'saas',
      organizationId: owner.organizationId,
      userId: user!.id,
    })
    .returning();
  const [role] = await isolated.database.db
    .insert(roles)
    .values({ organizationId: owner.organizationId, name: 'Business manager' })
    .returning();
  await isolated.database.db.insert(membershipRoles).values({
    organizationId: owner.organizationId,
    membershipId: membership!.id,
    roleId: role!.id,
  });
  const session = await identity.login(email, password, 'test');
  for (const permissionKey of [
    'customers.manage',
    'catalog.manage',
    'catalog.tax.verify',
  ]) {
    await isolated.database.db
      .delete(rolePermissions)
      .where(eq(rolePermissions.roleId, role!.id));
    await isolated.database.db.insert(rolePermissions).values({
      organizationId: owner.organizationId,
      roleId: role!.id,
      permissionKey,
    });
    await expect(
      identity.full(session, isolated.database.db),
    ).rejects.toMatchObject({ code: 'MFA_REQUIRED' });
  }
});
test('new permissions require explicit grants and cannot be bypassed using organization access', async () => {
  const own = await setup();
  const login = await orgs.identity.login(
    (
      await orgs.identity.current(
        await orgs.identity.authenticate(own.auth.Cookie.split('=')[1]),
        orgs.db,
      )
    ).user.email,
    password,
    'test',
  );
  const role = await orgs.saveRole(login, own.organizationId, {
    name: 'Directory reader',
    permissions: ['organization.read', 'customers.read', 'catalog.read'],
    delegable: [],
  });
  const email = `${randomUUID()}@example.test`;
  await orgs.addMember(login, own.organizationId, {
    email,
    name: 'Reader',
    temporaryPassword: password,
    roleIds: [role.id],
  });
  const employee = await http()
    .post('/api/v1/auth/login')
    .set(headers)
    .send({ email, password })
    .expect(201);
  const employeeCookie = (
    employee.headers['set-cookie'] as unknown as string[]
  )[0]!.split(';')[0]!;
  const fresh = await http()
    .post('/api/v1/auth/password')
    .set({
      ...headers,
      Cookie: employeeCookie,
      'x-csrf-token': employee.body.csrfToken,
    })
    .send({ currentPassword: password, newPassword: `${password} changed` })
    .expect(201);
  const auth = {
    ...headers,
    Cookie: (fresh.headers['set-cookie'] as unknown as string[])[0]!.split(
      ';',
    )[0]!,
    'x-csrf-token': fresh.body.csrfToken,
  };
  await http().get(`${own.path}/customers`).set(auth).expect(200);
  await http().get(`${own.path}/catalog`).set(auth).expect(200);
  await http()
    .post(`${own.path}/customers`)
    .set(auth)
    .send(customer)
    .expect(403);
  await http()
    .put(`${own.path}/business-profile`)
    .set(auth)
    .send(profile)
    .expect(403);
  await http().post(`${own.path}/catalog`).set(auth).send(item).expect(403);
  const saved = (
    await http()
      .post(`${own.path}/catalog`)
      .set(own.auth)
      .send(item)
      .expect(201)
  ).body;
  await http()
    .post(`${own.path}/catalog/${saved.id}/tax-review`)
    .set(auth)
    .send({ version: 1, reference: 'Attempted escalation' })
    .expect(403);
});
