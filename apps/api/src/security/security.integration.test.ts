import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import {
  and,
  auditEvents,
  authThrottle,
  eq,
  memberships,
  membershipRoles,
  mfaCredentials,
  organizations,
  roles,
  rolePermissions,
  sessions,
  trustedDevices,
  sql,
  users,
} from '@gst/database';
import { createIsolatedTestDatabase } from '@gst/database/testing';
import { createApp } from '../app.js';
import { parseConfig } from '../config.js';
import { IdentityService } from './identity.service.js';
import { OrganizationsService } from './organizations.service.js';
import { createTotp, digest, hashPassword } from './crypto.js';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (!adminUrl)
  throw new Error(
    'TEST_DATABASE_ADMIN_URL required for isolated security integration',
  );
let isolated: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
let app: INestApplication;
let saasApp: INestApplication;
let identity: IdentityService;
let organizationService: OrganizationsService;
let saasIdentity: IdentityService;
let saasOrganizations: OrganizationsService;
const password = 'Phase two test password 2026!';
const origin = 'http://localhost:5173';
type Client = ReturnType<typeof request>;
const http = (target = app): Client => request(target.getHttpServer());
const requestHeaders = { Host: 'localhost:3000', Origin: origin };
async function owner(
  label: string = randomUUID(),
  service = organizationService,
) {
  return service.provisionOwner({
    organizationName: `Org ${label}`,
    email: `${label}@example.test`,
    name: 'Owner',
    password,
  });
}
async function login(email: string, target = app) {
  const response = await http(target)
    .post('/api/v1/auth/login')
    .set(requestHeaders)
    .send({ email, password })
    .expect(201);
  return {
    cookie: (response.headers['set-cookie'] as unknown as string[])[0]!.split(
      ';',
    )[0]!,
    csrf: response.body.csrfToken as string,
    body: response.body,
  };
}
function authHeaders(auth: { cookie: string; csrf: string }) {
  return { ...requestHeaders, Cookie: auth.cookie, 'x-csrf-token': auth.csrf };
}
beforeAll(async () => {
  isolated = await createIsolatedTestDatabase(adminUrl);
  const config = parseConfig({
    NODE_ENV: 'test',
    DATABASE_URL: isolated.connectionString,
    AUTH_DATA_KEY: 'ab'.repeat(32),
  });
  identity = new IdentityService(isolated.database, config);
  organizationService = new OrganizationsService(identity);
  app = await createApp(config, {
    ...isolated.database,
    close: async () => {},
  });
  await app.init();
  const saasConfig = { ...config, DEPLOYMENT_EDITION: 'saas' as const };
  saasIdentity = new IdentityService(isolated.database, saasConfig);
  saasOrganizations = new OrganizationsService(saasIdentity);
  // Both applications share this test pool; individual app close must not close it.
  saasApp = await createApp(saasConfig, {
    ...isolated.database,
    close: async () => {},
  });
  await saasApp.init();
}, 30000);
beforeEach(async () => {
  await isolated.database.db.delete(authThrottle);
});
function responseCookie(response: request.Response, name: string) {
  return (response.headers['set-cookie'] as unknown as string[])
    .find((value) => value.startsWith(name + '='))!
    .split(';')[0]!;
}
function responseAuth(response: request.Response) {
  return {
    cookie: responseCookie(response, 'gst_dev_session'),
    csrf: response.body.csrfToken as string,
  };
}
async function rememberedOwner(rememberDevice = true) {
  const label = randomUUID();
  const org = await owner(label, saasOrganizations);
  const email = `${label}@example.test`;
  const auth = await login(email, saasApp);
  const enrollment = await http(saasApp)
    .post('/api/v1/auth/mfa/enroll')
    .set(authHeaders(auth))
    .send({ password })
    .expect(201);
  const confirmed = await http(saasApp)
    .post('/api/v1/auth/mfa/confirm')
    .set(authHeaders(auth))
    .send({
      code: createTotp(enrollment.body.secret).generate(),
      rememberDevice,
    })
    .expect(201);
  return {
    org,
    email,
    confirmed,
    auth: responseAuth(confirmed),
    cookie: rememberDevice
      ? responseCookie(confirmed, 'gst_dev_trusted_device')
      : '',
  };
}
test('remembered browsers require password, isolate users, rotate tokens and keep a fixed expiry', async () => {
  const fixture = await rememberedOwner();
  const cookieHeader = (
    fixture.confirmed.headers['set-cookie'] as unknown as string[]
  ).find((value) => value.startsWith('gst_dev_trusted_device='))!;
  expect(cookieHeader).toContain('HttpOnly');
  expect(cookieHeader).toContain('SameSite=Strict');
  expect(cookieHeader).not.toContain('Domain=');
  const [stored] = await isolated.database.db
    .select()
    .from(trustedDevices)
    .where(eq(trustedDevices.userId, fixture.org.userId));
  expect(stored!.tokenHash).toBe(digest(fixture.cookie.split('=')[1]!));
  expect(stored!.expiresAt.getTime() - stored!.createdAt.getTime()).toBeCloseTo(
    30 * 86400000,
    -3,
  );
  await http(saasApp)
    .post('/api/v1/auth/login')
    .set({ ...requestHeaders, Cookie: fixture.cookie })
    .send({ email: fixture.email, password: 'wrong' })
    .expect(401);
  await http(saasApp)
    .get('/api/v1/auth/session')
    .set({ ...requestHeaders, Cookie: fixture.cookie })
    .expect(401);
  const otherLabel = randomUUID();
  await owner(otherLabel, saasOrganizations);
  const other = await http(saasApp)
    .post('/api/v1/auth/login')
    .set({ ...requestHeaders, Cookie: fixture.cookie })
    .send({ email: `${otherLabel}@example.test`, password })
    .expect(201);
  expect(other.body.mfaRequired).toBe(true);
  const concurrent = await Promise.all(
    [0, 1].map(() =>
      http(saasApp)
        .post('/api/v1/auth/login')
        .set({ ...requestHeaders, Cookie: fixture.cookie })
        .send({ email: fixture.email, password })
        .expect(201),
    ),
  );
  expect(concurrent.filter((result) => !result.body.mfaRequired)).toHaveLength(
    1,
  );
  const recalled = concurrent.find((result) => !result.body.mfaRequired)!;
  const rotated = responseCookie(recalled, 'gst_dev_trusted_device');
  expect(rotated).not.toBe(fixture.cookie);
  const [after] = await isolated.database.db
    .select()
    .from(trustedDevices)
    .where(eq(trustedDevices.userId, fixture.org.userId));
  expect(after!.expiresAt).toEqual(stored!.expiresAt);
  expect(recalled.text).not.toContain(after!.tokenHash);
  const list = await http(saasApp)
    .get('/api/v1/auth/trusted-devices')
    .set(authHeaders(responseAuth(recalled)))
    .expect(200);
  expect(list.body).toHaveLength(1);
  expect(list.text).not.toContain('credentialHash');
  expect(list.text).not.toContain(rotated.split('=')[1]!);
});
test('remembering is opt-in; expiry, tampering and per-device revocation require MFA again', async () => {
  const optOut = await rememberedOwner(false);
  expect((await login(optOut.email, saasApp)).body.mfaRequired).toBe(true);
  expect(
    await isolated.database.db
      .select()
      .from(trustedDevices)
      .where(eq(trustedDevices.userId, optOut.org.userId)),
  ).toHaveLength(0);
  const fixture = await rememberedOwner();
  const [device] = await isolated.database.db
    .select()
    .from(trustedDevices)
    .where(eq(trustedDevices.userId, fixture.org.userId));
  await http(saasApp)
    .delete(`/api/v1/auth/trusted-devices/${device!.id}`)
    .set({ ...authHeaders(fixture.auth), 'x-csrf-token': 'invalid' })
    .expect(403);
  await isolated.database.db
    .update(trustedDevices)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(trustedDevices.id, device!.id));
  const expired = await http(saasApp)
    .post('/api/v1/auth/login')
    .set({ ...requestHeaders, Cookie: fixture.cookie })
    .send({ email: fixture.email, password })
    .expect(201);
  expect(expired.body.mfaRequired).toBe(true);
  await isolated.database.db
    .update(trustedDevices)
    .set({ expiresAt: new Date(Date.now() + 100000) })
    .where(eq(trustedDevices.id, device!.id));
  await http(saasApp)
    .delete(`/api/v1/auth/trusted-devices/${device!.id}`)
    .set(authHeaders(fixture.auth))
    .expect(200);
  const revoked = await http(saasApp)
    .post('/api/v1/auth/login')
    .set({ ...requestHeaders, Cookie: fixture.cookie })
    .send({ email: fixture.email, password })
    .expect(201);
  expect(revoked.body.mfaRequired).toBe(true);
  const tampered = await http(saasApp)
    .post('/api/v1/auth/login')
    .set({
      ...requestHeaders,
      Cookie: 'gst_dev_trusted_device=' + 'x'.repeat(43),
    })
    .send({ email: fixture.email, password })
    .expect(201);
  expect(tampered.body.mfaRequired).toBe(true);
});
test('fresh MFA protects password changes and all-device signout revokes remembered access', async () => {
  const fixture = await rememberedOwner();
  const recalled = await http(saasApp)
    .post('/api/v1/auth/login')
    .set({ ...requestHeaders, Cookie: fixture.cookie })
    .send({ email: fixture.email, password })
    .expect(201);
  const auth = responseAuth(recalled),
    cookie = responseCookie(recalled, 'gst_dev_trusted_device');
  const newPassword = password + ' replaced';
  await http(saasApp)
    .post('/api/v1/auth/password')
    .set(authHeaders(auth))
    .send({ currentPassword: password, newPassword })
    .expect(403);
  await http(saasApp)
    .post('/api/v1/auth/password')
    .set(authHeaders(auth))
    .send({ currentPassword: password, newPassword, code: 'invalid-code' })
    .expect(401);
  await http(saasApp)
    .post('/api/v1/auth/password')
    .set(authHeaders(auth))
    .send({
      currentPassword: password,
      newPassword,
      code: fixture.confirmed.body.recoveryCodes[0],
    })
    .expect(201);
  const later = await http(saasApp)
    .post('/api/v1/auth/login')
    .set({ ...requestHeaders, Cookie: cookie })
    .send({ email: fixture.email, password: newPassword })
    .expect(201);
  expect(later.body.mfaRequired).toBe(true);
  const second = await rememberedOwner();
  await http(saasApp)
    .post('/api/v1/auth/logout-all')
    .set(authHeaders(second.auth))
    .expect(201);
  const afterSignout = await http(saasApp)
    .post('/api/v1/auth/login')
    .set({ ...requestHeaders, Cookie: second.cookie })
    .send({ email: second.email, password })
    .expect(201);
  expect(afterSignout.body.mfaRequired).toBe(true);
});
test('MFA recovery rotation invalidates trust, and the browser limit is enforced', async () => {
  const fixture = await rememberedOwner();
  for (let i = 0; i < 10; i++) {
    await isolated.database.db.delete(authThrottle);
    const auth = await login(fixture.email, saasApp);
    await http(saasApp)
      .post('/api/v1/auth/mfa/verify')
      .set(authHeaders(auth))
      .send({
        code: fixture.confirmed.body.recoveryCodes[i],
        rememberDevice: true,
      })
      .expect(201);
  }
  expect(
    await isolated.database.db
      .select()
      .from(trustedDevices)
      .where(eq(trustedDevices.userId, fixture.org.userId)),
  ).toHaveLength(10);
  const earlier = await http(saasApp)
    .post('/api/v1/auth/login')
    .set({ ...requestHeaders, Cookie: fixture.cookie })
    .send({ email: fixture.email, password })
    .expect(201);
  expect(earlier.body.mfaRequired).toBe(true);
  const rotated = await rememberedOwner();
  await http(saasApp)
    .post('/api/v1/auth/mfa/recovery-codes')
    .set(authHeaders(rotated.auth))
    .send({ password, code: rotated.confirmed.body.recoveryCodes[0] })
    .expect(201);
  const afterRotation = await http(saasApp)
    .post('/api/v1/auth/login')
    .set({ ...requestHeaders, Cookie: rotated.cookie })
    .send({ email: rotated.email, password })
    .expect(201);
  expect(afterRotation.body.mfaRequired).toBe(true);
  // Re-enrollment/recovery changes the bound secret; stale records cannot bypass MFA.
  await isolated.database.db
    .update(mfaCredentials)
    .set({ secret: null })
    .where(eq(mfaCredentials.userId, fixture.org.userId));
  const unenrolled = await login(fixture.email, saasApp);
  expect(unenrolled.body.mfaRequired).toBe(true);
  expect(unenrolled.body.mfaEnabled).toBe(false);
}, 60000);
test('SaaS staff can choose MFA; access administrators and owners cannot disable it', async () => {
  const label = randomUUID(),
    org = await owner(label, saasOrganizations);
  const [staff] = await isolated.database.db
    .insert(users)
    .values({
      edition: 'saas',
      email: `${randomUUID()}@example.test`,
      name: 'Staff',
      passwordHash: await hashPassword(password),
    })
    .returning();
  const [member] = await isolated.database.db
    .insert(memberships)
    .values({
      edition: 'saas',
      organizationId: org.organizationId,
      userId: staff!.id,
    })
    .returning();
  const [role] = await isolated.database.db
    .insert(roles)
    .values({ organizationId: org.organizationId, name: 'Billing staff' })
    .returning();
  await isolated.database.db.insert(membershipRoles).values({
    organizationId: org.organizationId,
    membershipId: member!.id,
    roleId: role!.id,
  });
  await isolated.database.db.insert(rolePermissions).values(
    ['invoices.read', 'invoices.manage', 'customers.manage'].map(
      (permissionKey) => ({
        organizationId: org.organizationId,
        roleId: role!.id,
        permissionKey,
      }),
    ),
  );
  const staffAuth = await login(staff!.email, saasApp);
  expect(staffAuth.body.mfaMandatory).toBe(false);
  expect(staffAuth.body.mfaRequired).toBe(false);
  const enrollment = await http(saasApp)
    .post('/api/v1/auth/mfa/enroll')
    .set(authHeaders(staffAuth))
    .send({ password })
    .expect(201);
  const confirmed = await http(saasApp)
    .post('/api/v1/auth/mfa/confirm')
    .set(authHeaders(staffAuth))
    .send({
      code: createTotp(enrollment.body.secret).generate(),
      rememberDevice: true,
    })
    .expect(201);
  expect((await login(staff!.email, saasApp)).body.mfaRequired).toBe(true);
  const disabled = await http(saasApp)
    .post('/api/v1/auth/mfa/disable')
    .set(authHeaders(responseAuth(confirmed)))
    .send({ password, code: confirmed.body.recoveryCodes[0] })
    .expect(201);
  expect(disabled.body.mfaEnabled).toBe(false);
  expect(
    await isolated.database.db
      .select()
      .from(trustedDevices)
      .where(eq(trustedDevices.userId, staff!.id)),
  ).toHaveLength(0);
  await isolated.database.db.insert(rolePermissions).values({
    organizationId: org.organizationId,
    roleId: role!.id,
    permissionKey: 'members.manage',
  });
  const promoted = await http(saasApp)
    .get('/api/v1/auth/session')
    .set(authHeaders(responseAuth(disabled)))
    .expect(200);
  expect(promoted.body.mfaMandatory).toBe(true);
  expect(promoted.body.mfaRequired).toBe(true);
  await http(saasApp)
    .get('/api/v1/organizations')
    .set(authHeaders(responseAuth(disabled)))
    .expect(403);
  expect(
    (await login(`${label}@example.test`, saasApp)).body.mfaMandatory,
  ).toBe(true);
});

test('appearance is persistent, strictly validated and scoped to the fully authenticated user', async () => {
  const first = `${randomUUID()}@example.test`,
    second = `${randomUUID()}@example.test`;
  for (const email of [first, second])
    await organizationService.provisionOwner({
      email,
      name: 'Theme user',
      organizationName: email,
      password,
    });
  const auth = await login(first),
    other = await login(second);
  expect(auth.body.appearance).toEqual({ mode: 'system', accent: 'teal' });
  const endpoint = '/api/v1/auth/appearance';
  await http()
    .put(endpoint)
    .set(requestHeaders)
    .send({ mode: 'dark', accent: 'blue' })
    .expect(401);
  await http()
    .put(endpoint)
    .set({ ...authHeaders(auth), 'x-csrf-token': 'invalid' })
    .send({ mode: 'dark', accent: 'blue' })
    .expect(403);
  for (const invalid of [
    { mode: 'invalid', accent: 'blue' },
    { mode: 'dark', accent: '#000' },
    { mode: 'dark', accent: 'blue', userId: other.body.user.id },
    { mode: 'dark' },
  ])
    await http().put(endpoint).set(authHeaders(auth)).send(invalid).expect(400);
  await http()
    .put(endpoint)
    .set(authHeaders(auth))
    .send({ mode: 'dark', accent: 'blue' })
    .expect(200, { mode: 'dark', accent: 'blue' });
  expect((await login(first)).body.appearance).toEqual({
    mode: 'dark',
    accent: 'blue',
  });
  expect(
    (
      await http()
        .get('/api/v1/auth/session')
        .set(authHeaders(other))
        .expect(200)
    ).body.appearance,
  ).toEqual({ mode: 'system', accent: 'teal' });
  const [stored] = await isolated.database.db
    .select()
    .from(users)
    .where(eq(users.id, auth.body.user.id));
  expect(stored).toMatchObject({ themeMode: 'dark', themeAccent: 'blue' });
  await isolated.database.db
    .update(users)
    .set({ mustChangePassword: true })
    .where(eq(users.id, auth.body.user.id));
  await http()
    .put(endpoint)
    .set(authHeaders(auth))
    .send({ mode: 'light', accent: 'teal' })
    .expect(403);
});
afterAll(async () => {
  await saasApp?.close();
  await app?.close();
  await isolated?.cleanup();
});

test('real HTTP login, hashed opaque storage, CSRF, logout and no-store', async () => {
  const email = `${randomUUID()}@example.test`;
  await organizationService.provisionOwner({
    email,
    name: 'Owner',
    organizationName: 'Session organization',
    password,
  });
  await http()
    .get('/api/v1/organizations')
    .set('Host', 'localhost:3000')
    .expect(401);
  await http()
    .post('/api/v1/auth/login')
    .set('Host', 'localhost:3000')
    .send({ email, password })
    .expect(403);
  const auth = await login(email);
  const raw = auth.cookie.split('=')[1]!;
  const [stored] = await isolated.database.db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, digest(raw)));
  expect(stored?.tokenHash).not.toBe(raw);
  expect(stored?.csrfHash).not.toBe(auth.csrf);
  for (const path of ['/api/v1/auth/session', '/API/V1/auth/session']) {
    const info = await http().get(path).set(authHeaders(auth)).expect(200);
    expect(info.headers['cache-control']).toBe('no-store');
    expect(info.body.csrfToken).toBe(auth.csrf);
    expect(info.text).not.toContain('passwordHash');
  }
  const unauthenticated = await http()
    .get('/API/v1/auth/session')
    .set('Host', 'localhost:3000')
    .expect(401);
  expect(unauthenticated.headers['cache-control']).toBe('no-store');
  await http()
    .post('/api/v1/auth/logout')
    .set({ ...requestHeaders, Cookie: auth.cookie })
    .expect(403);
  await http().post('/api/v1/auth/logout').set(authHeaders(auth)).expect(201);
  await http().get('/api/v1/auth/session').set(authHeaders(auth)).expect(401);
});
test('tenant isolation blocks guessed organization, role and membership references', async () => {
  const aLabel = randomUUID();
  const bLabel = randomUUID();
  const a = await owner(aLabel);
  const b = await owner(bLabel);
  const auth = await login(`${aLabel}@example.test`);
  const headers = authHeaders(auth);
  await http()
    .get(`/api/v1/organizations/${b.organizationId}`)
    .set(headers)
    .expect(403);
  const [foreignRole] = await isolated.database.db
    .select()
    .from(roles)
    .where(eq(roles.organizationId, b.organizationId));
  await http()
    .post(`/api/v1/organizations/${a.organizationId}/members`)
    .set(headers)
    .send({
      email: `${randomUUID()}@example.test`,
      name: 'Employee',
      temporaryPassword: password,
      roleIds: [foreignRole!.id],
    })
    .expect(403);
  await expect(
    isolated.database.db.insert(membershipRoles).values({
      organizationId: a.organizationId,
      membershipId: a.membershipId,
      roleId: foreignRole!.id,
    }),
  ).rejects.toThrow();
  await expect(
    isolated.database.db.insert(membershipRoles).values({
      organizationId: a.organizationId,
      membershipId: b.membershipId,
      roleId: foreignRole!.id,
    }),
  ).rejects.toThrow();
  await http()
    .put(`/api/v1/organizations/${a.organizationId}/members/${b.membershipId}`)
    .set(headers)
    .send({ status: 'suspended' })
    .expect(403);
});
test('multiple roles union permissions; role management does not grant delegation; revocation is immediate', async () => {
  const label = randomUUID();
  const org = await owner(label);
  const ownerAuth = await login(`${label}@example.test`);
  const ownerSession = await identity.authenticate(
    ownerAuth.cookie.split('=')[1],
  );
  const r1 = await organizationService.saveRole(
    ownerSession,
    org.organizationId,
    {
      name: 'Role administrator',
      permissions: ['organization.read', 'roles.read', 'roles.manage'],
      delegable: [],
    },
  );
  const r2 = await organizationService.saveRole(
    ownerSession,
    org.organizationId,
    { name: 'Member reader', permissions: ['members.read'], delegable: [] },
  );
  const email = `${randomUUID()}@example.test`;
  const member = await organizationService.addMember(
    ownerSession,
    org.organizationId,
    {
      email,
      name: 'Employee',
      temporaryPassword: password,
      roleIds: [r1.id!, r2.id!],
    },
  );
  const [membership] = await isolated.database.db
    .select()
    .from(memberships)
    .where(eq(memberships.id, member.id));
  await isolated.database.db
    .update(users)
    .set({ mustChangePassword: false })
    .where(eq(users.id, membership!.userId));
  const auth = await login(email);
  await http()
    .get(`/api/v1/organizations/${org.organizationId}/members`)
    .set(authHeaders(auth))
    .expect(200);
  await http()
    .post(`/api/v1/organizations/${org.organizationId}/roles`)
    .set(authHeaders(auth))
    .send({ name: 'Escalation', permissions: ['members.manage'] })
    .expect(403);
  await organizationService.updateMember(
    ownerSession,
    org.organizationId,
    member.id,
    { roleIds: [r1.id!] },
  );
  await http()
    .get(`/api/v1/organizations/${org.organizationId}/members`)
    .set(authHeaders(auth))
    .expect(403);
  await organizationService.updateMember(
    ownerSession,
    org.organizationId,
    member.id,
    { status: 'suspended' },
  );
  await http()
    .get(`/api/v1/organizations/${org.organizationId}`)
    .set(authHeaders(auth))
    .expect(403);
});
test('last owner is protected in service and database; concurrent self-removal leaves one owner', async () => {
  const label = randomUUID();
  const org = await owner(label);
  const auth = await login(`${label}@example.test`);
  const session = await identity.authenticate(auth.cookie.split('=')[1]);
  await http()
    .put(
      `/api/v1/organizations/${org.organizationId}/members/${org.membershipId}/owner`,
    )
    .set(authHeaders(auth))
    .send({ isOwner: false })
    .expect(409);
  await expect(
    isolated.database.db
      .update(users)
      .set({ status: 'disabled' })
      .where(eq(users.id, org.userId)),
  ).rejects.toThrow();
  await expect(
    isolated.database.db
      .delete(memberships)
      .where(eq(memberships.id, org.membershipId)),
  ).rejects.toThrow();
  const secondLabel = randomUUID();
  const secondOrg = await owner(secondLabel);
  const extra = await organizationService.addMember(
    session,
    org.organizationId,
    { email: `${secondLabel}@example.test`, name: 'Second owner', roleIds: [] },
  );
  const secondAuth = await login(`${secondLabel}@example.test`);
  const second = await identity.authenticate(secondAuth.cookie.split('=')[1]);
  await organizationService.acceptInvitation(second, extra.id);
  await organizationService.setOwner(
    session,
    org.organizationId,
    extra.id,
    true,
  );
  const results = await Promise.allSettled([
    organizationService.setOwner(
      session,
      org.organizationId,
      org.membershipId,
      false,
    ),
    organizationService.setOwner(second, org.organizationId, extra.id, false),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const remaining = await isolated.database.db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, org.organizationId),
        eq(memberships.isOwner, true),
        eq(memberships.status, 'active'),
      ),
    );
  expect(remaining).toHaveLength(1);
  expect(secondOrg.userId).toBeDefined();
});
test('password changes rotate and revoke all previous sessions', async () => {
  const label = randomUUID();
  const org = await owner(label);
  const auth = await login(`${label}@example.test`);
  const other = await login(`${label}@example.test`);
  const changed = await http()
    .post('/api/v1/auth/password')
    .set(authHeaders(auth))
    .send({
      currentPassword: password,
      newPassword: 'A different strong password 2026!',
    })
    .expect(201);
  expect(changed.headers['set-cookie']).toBeDefined();
  await http().get('/api/v1/auth/session').set(authHeaders(auth)).expect(401);
  await http().get('/api/v1/auth/session').set(authHeaders(other)).expect(401);
  expect(org.organizationId).toBeDefined();
});
test('idle and absolute expiry deny existing sessions', async () => {
  const label = randomUUID();
  const org = await owner(label);
  const auth = await login(`${label}@example.test`);
  const hash = digest(auth.cookie.split('=')[1]!);
  await isolated.database.db
    .update(sessions)
    .set({ lastSeenAt: new Date(Date.now() - 31 * 60000) })
    .where(eq(sessions.tokenHash, hash));
  await http().get('/api/v1/auth/session').set(authHeaders(auth)).expect(401);
  const next = await login(`${label}@example.test`);
  await isolated.database.db
    .update(sessions)
    .set({ expiresAt: new Date(Date.now() - 1) })
    .where(eq(sessions.tokenHash, digest(next.cookie.split('=')[1]!)));
  await http().get('/api/v1/auth/session').set(authHeaders(next)).expect(401);
  expect(org.userId).toBeDefined();
});
test('SaaS owner must enroll MFA, TOTP replay fails, recovery codes are single-use', async () => {
  const label = randomUUID();
  const org = await owner(label, saasOrganizations);
  const auth = await login(`${label}@example.test`, saasApp);
  expect(auth.body.mfaRequired).toBe(true);
  await http(saasApp)
    .get('/api/v1/organizations')
    .set(authHeaders(auth))
    .expect(403);
  await http()
    .post('/api/v1/auth/login')
    .set(requestHeaders)
    .send({ email: `${label}@example.test`, password })
    .expect(401);
  const enrollment = await http(saasApp)
    .post('/api/v1/auth/mfa/enroll')
    .set(authHeaders(auth))
    .send({ password })
    .expect(201);
  const code = createTotp(enrollment.body.secret).generate();
  const confirmed = await http(saasApp)
    .post('/api/v1/auth/mfa/confirm')
    .set(authHeaders(auth))
    .send({ code })
    .expect(201);
  expect(confirmed.body.recoveryCodes).toHaveLength(10);
  const [stored] = await isolated.database.db
    .select()
    .from(mfaCredentials)
    .where(eq(mfaCredentials.userId, org.userId));
  expect(stored?.secret).not.toContain(enrollment.body.secret);
  const loggedIn = await login(`${label}@example.test`, saasApp);
  await http(saasApp)
    .post('/api/v1/auth/mfa/verify')
    .set(authHeaders(loggedIn))
    .send({ code })
    .expect(401);
  const recovery = confirmed.body.recoveryCodes[0];
  await http(saasApp)
    .post('/api/v1/auth/mfa/verify')
    .set(authHeaders(loggedIn))
    .send({ code: recovery })
    .expect(201);
  const retry = await login(`${label}@example.test`, saasApp);
  await http(saasApp)
    .post('/api/v1/auth/mfa/verify')
    .set(authHeaders(retry))
    .send({ code: recovery })
    .expect(401);
  const verified = await http(saasApp)
    .post('/api/v1/auth/mfa/verify')
    .set(authHeaders(retry))
    .send({ code: confirmed.body.recoveryCodes[1] })
    .expect(201);
  const verifiedAuth = {
    cookie: (verified.headers['set-cookie'] as unknown as string[])[0]!.split(
      ';',
    )[0]!,
    csrf: verified.body.csrfToken as string,
  };
  await http(saasApp)
    .post('/api/v1/auth/mfa/disable')
    .set(authHeaders(verifiedAuth))
    .send({ password, code: confirmed.body.recoveryCodes[2] })
    .expect(403);
  const rotated = await http(saasApp)
    .post('/api/v1/auth/mfa/recovery-codes')
    .set(authHeaders(verifiedAuth))
    .send({ password, code: confirmed.body.recoveryCodes[2] })
    .expect(201);
  expect(rotated.body.recoveryCodes).toHaveLength(10);
  await http(saasApp)
    .get('/api/v1/auth/session')
    .set(authHeaders(verifiedAuth))
    .expect(401);
  const later = await login(`${label}@example.test`, saasApp);
  await http(saasApp)
    .post('/api/v1/auth/mfa/verify')
    .set(authHeaders(later))
    .send({ code: confirmed.body.recoveryCodes[3] })
    .expect(401);
});
test('host-only offline owner recovery is one-time and audited; audit mutations fail', async () => {
  const label = randomUUID();
  const org = await owner(label);
  const auth = await login(`${label}@example.test`);
  const replacement = await identity.recoverOwner(
    `${label}@example.test`,
    org.recoveryCredential!,
    'Recovered owner password 2026!',
  );
  expect(replacement).not.toBe(org.recoveryCredential);
  await expect(
    identity.recoverOwner(
      `${label}@example.test`,
      org.recoveryCredential!,
      password,
    ),
  ).rejects.toThrow();
  await expect(
    saasIdentity.recoverOwner(`${label}@example.test`, replacement, password),
  ).rejects.toThrow();
  await http().get('/api/v1/auth/session').set(authHeaders(auth)).expect(401);
  const [event] = await isolated.database.db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organizationId, org.organizationId),
        eq(auditEvents.action, 'identity.owner_recovered'),
      ),
    );
  expect(event).toBeDefined();
  await expect(
    isolated.database.db
      .update(auditEvents)
      .set({ action: 'tampered' })
      .where(eq(auditEvents.id, event!.id)),
  ).rejects.toThrow();
  await expect(
    isolated.database.db
      .delete(auditEvents)
      .where(eq(auditEvents.id, event!.id)),
  ).rejects.toThrow();
  await expect(
    isolated.database.db.execute(sql`TRUNCATE audit_events`),
  ).rejects.toThrow();
});
test('login throttle persists failed attempts and errors do not disclose accounts', async () => {
  const email = `${randomUUID()}@example.test`;
  for (let i = 0; i < 10; i++)
    await http()
      .post('/api/v1/auth/login')
      .set(requestHeaders)
      .send({ email, password })
      .expect(401);
  const limited = await http()
    .post('/api/v1/auth/login')
    .set(requestHeaders)
    .send({ email, password })
    .expect(429);
  expect(limited.text).not.toContain(email);
  expect(limited.text).not.toContain('passwordHash');
});

test('invitations require user consent even after suspension; tenant admins cannot reset shared credentials', async () => {
  const aLabel = randomUUID();
  const bLabel = randomUUID();
  const a = await owner(aLabel);
  const b = await owner(bLabel);
  const aAuth = await login(`${aLabel}@example.test`);
  const bAuth = await login(`${bLabel}@example.test`);
  const aSession = await identity.authenticate(aAuth.cookie.split('=')[1]);
  const bSession = await identity.authenticate(bAuth.cookie.split('=')[1]);
  const [staff] = await isolated.database.db
    .select()
    .from(roles)
    .where(
      and(eq(roles.organizationId, a.organizationId), eq(roles.name, 'Staff')),
    );
  const invite = await organizationService.addMember(
    aSession,
    a.organizationId,
    {
      email: `${bLabel}@example.test`,
      name: 'Existing identity',
      roleIds: [staff!.id],
    },
  );
  await http()
    .get(`/api/v1/organizations/${a.organizationId}`)
    .set(authHeaders(bAuth))
    .expect(403);
  await http()
    .put(`/api/v1/organizations/${a.organizationId}/members/${invite.id}`)
    .set(authHeaders(aAuth))
    .send({ status: 'active' })
    .expect(403);
  await organizationService.updateMember(
    aSession,
    a.organizationId,
    invite.id,
    { status: 'suspended' },
  );
  await http()
    .put(`/api/v1/organizations/${a.organizationId}/members/${invite.id}`)
    .set(authHeaders(aAuth))
    .send({ status: 'active' })
    .expect(403);
  await organizationService.removeMember(aSession, a.organizationId, invite.id);
  const again = await organizationService.addMember(
    aSession,
    a.organizationId,
    {
      email: `${bLabel}@example.test`,
      name: 'Existing identity',
      roleIds: [staff!.id],
    },
  );
  await organizationService.acceptInvitation(bSession, again.id);
  await http()
    .get(`/api/v1/organizations/${a.organizationId}`)
    .set(authHeaders(bAuth))
    .expect(200);
  await http()
    .post(
      `/api/v1/organizations/${a.organizationId}/members/${again.id}/password`,
    )
    .set(authHeaders(aAuth))
    .send({ temporaryPassword: password })
    .expect(403);
  await http()
    .get(`/api/v1/organizations/${b.organizationId}`)
    .set(authHeaders(bAuth))
    .expect(200);
  const employeeEmail = `${randomUUID()}@example.test`;
  const employee = await organizationService.addMember(
    aSession,
    a.organizationId,
    {
      email: employeeEmail,
      name: 'Consent boundary',
      temporaryPassword: password,
      roleIds: [],
    },
  );
  const pending = await organizationService.addMember(
    bSession,
    b.organizationId,
    { email: employeeEmail, name: 'Unaccepted invitation', roleIds: [] },
  );
  // An unaccepted invitation cannot deny service to the user's actual tenant.
  await http()
    .post(
      `/api/v1/organizations/${a.organizationId}/members/${employee.id}/password`,
    )
    .set(authHeaders(aAuth))
    .send({ temporaryPassword: password })
    .expect(201);
  await organizationService.removeMember(
    aSession,
    a.organizationId,
    employee.id,
  );
  // Nor can it authorize a reset after the last accepted membership is removed.
  await http()
    .post(
      `/api/v1/organizations/${b.organizationId}/members/${pending.id}/password`,
    )
    .set(authHeaders(bAuth))
    .send({ temporaryPassword: password })
    .expect(403);
});
test('employee temporary-password reset revokes old sessions and gates access until changed', async () => {
  const label = randomUUID();
  const org = await owner(label);
  const a = await login(`${label}@example.test`);
  const session = await identity.authenticate(a.cookie.split('=')[1]);
  const email = `${randomUUID()}@example.test`;
  const staff = await isolated.database.db
    .select()
    .from(roles)
    .where(
      and(
        eq(roles.organizationId, org.organizationId),
        eq(roles.name, 'Staff'),
      ),
    );
  const member = await organizationService.addMember(
    session,
    org.organizationId,
    {
      email,
      name: 'Employee',
      temporaryPassword: password,
      roleIds: [staff[0]!.id],
    },
  );
  const employee = await login(email);
  const denied = await http()
    .get('/api/v1/organizations')
    .set(authHeaders(employee))
    .expect(403);
  expect(denied.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  await organizationService.resetPassword(
    session,
    org.organizationId,
    member.id,
    'Reset temporary password 2026!',
  );
  await http()
    .get('/api/v1/auth/session')
    .set(authHeaders(employee))
    .expect(401);
  await http()
    .post('/api/v1/auth/login')
    .set(requestHeaders)
    .send({ email, password })
    .expect(401);
  const resetLogin = await http()
    .post('/api/v1/auth/login')
    .set(requestHeaders)
    .send({ email, password: 'Reset temporary password 2026!' })
    .expect(201);
  expect(resetLogin.body.mustChangePassword).toBe(true);
});
test('explicit delegation permits bounded grants but never grants delegation itself', async () => {
  const label = randomUUID();
  const org = await owner(label);
  const auth = await login(`${label}@example.test`);
  const session = await identity.authenticate(auth.cookie.split('=')[1]);
  const role = await organizationService.saveRole(session, org.organizationId, {
    name: 'Delegated role manager',
    permissions: ['organization.read', 'roles.read', 'roles.manage'],
    delegable: ['organization.read'],
  });
  const email = `${randomUUID()}@example.test`;
  const member = await organizationService.addMember(
    session,
    org.organizationId,
    {
      email,
      name: 'Delegated manager',
      temporaryPassword: password,
      roleIds: [role.id!],
    },
  );
  const [record] = await isolated.database.db
    .select()
    .from(memberships)
    .where(eq(memberships.id, member.id));
  await isolated.database.db
    .update(users)
    .set({ mustChangePassword: false })
    .where(eq(users.id, record!.userId));
  const delegated = await login(email);
  await http()
    .post(`/api/v1/organizations/${org.organizationId}/roles`)
    .set(authHeaders(delegated))
    .send({ name: 'Bounded role', permissions: ['organization.read'] })
    .expect(201);
  await http()
    .post(`/api/v1/organizations/${org.organizationId}/roles`)
    .set(authHeaders(delegated))
    .send({
      name: 'Delegation escalation',
      permissions: ['organization.read'],
      delegable: ['organization.read'],
    })
    .expect(403);
  await http()
    .post(`/api/v1/organizations/${org.organizationId}/roles`)
    .set(authHeaders(delegated))
    .send({ name: 'Permission escalation', permissions: ['members.manage'] })
    .expect(403);
});
test('edition FKs, required owners and legacy organization adoption preserve identities', async () => {
  const offline = await owner();
  const cloud = await owner(randomUUID(), saasOrganizations);
  await expect(
    isolated.database.db.insert(memberships).values({
      organizationId: offline.organizationId,
      userId: cloud.userId,
      edition: 'offline',
    }),
  ).rejects.toThrow();
  await expect(
    identity.issue(isolated.database.db, cloud.userId),
  ).rejects.toThrow();
  await expect(
    isolated.database.db
      .insert(organizations)
      .values({ name: 'Ownerless active' }),
  ).rejects.toThrow();
  const [legacy] = await isolated.database.db
    .insert(organizations)
    .values({ name: 'Retained foundation organization', status: 'suspended' })
    .returning();
  const adopted = await organizationService.provisionOwner({
    organizationId: legacy!.id,
    organizationName: 'Must not overwrite legacy name',
    email: `${randomUUID()}@example.test`,
    name: 'Adopting owner',
    password,
  });
  expect(adopted.organizationId).toBe(legacy!.id);
  const [after] = await isolated.database.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, legacy!.id));
  expect(after).toMatchObject({
    name: 'Retained foundation organization',
    status: 'suspended',
  });
});
test('malformed and oversized JSON are rejected without server details', async () => {
  const malformed = await http()
    .post('/api/v1/auth/login')
    .set(requestHeaders)
    .set('Content-Type', 'application/json')
    .send('{')
    .expect(400);
  expect(malformed.text).not.toContain('SyntaxError');
  await http()
    .post('/api/v1/auth/login')
    .set(requestHeaders)
    .send({ email: 'x'.repeat(20000), password })
    .expect(413);
});

test('host CLI provisions privately, preserves output files, and consumes owner recovery once', async () => {
  await mkdir(join(process.cwd(), '.local'), { recursive: true });
  const directory = await mkdtemp(
    join(process.cwd(), '.local', 'gst-host-test-'),
  );
  const files = [
    'input.json',
    'owner.jsonl',
    'recover.json',
    'recovered.jsonl',
    'reused.jsonl',
  ].map((name) => join(directory, name));
  const email = `${randomUUID()}@example.test`;
  const cleanupErrors: unknown[] = [];
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DEPLOYMENT_EDITION: 'offline',
    DATABASE_URL: isolated.connectionString,
    MIGRATION_DATABASE_URL: isolated.connectionString,
    AUTH_DATA_KEY: 'ab'.repeat(32),
  };
  const run = (command: string, inputPath: string, outputPath: string) =>
    promisify(execFile)(
      process.execPath,
      [
        '--import',
        'tsx',
        'apps/api/src/security/host-cli.ts',
        command,
        inputPath,
        outputPath,
      ],
      { env, windowsHide: true, timeout: 20000 },
    );
  try {
    await writeFile(
      files[0]!,
      JSON.stringify({
        organizationName: 'CLI organization',
        email,
        name: 'CLI owner',
        password,
      }),
      { mode: 0o600 },
    );
    const packageManager = process.env.npm_execpath;
    if (!packageManager)
      throw new Error(
        'Run integration tests through the documented pnpm command',
      );
    const jsEntry = /\.[cm]?js$/i.test(packageManager);
    const completed = await promisify(execFile)(
      jsEntry ? process.execPath : packageManager,
      [
        ...(jsEntry ? [packageManager] : []),
        'identity:host',
        'provision',
        relative(process.cwd(), files[0]!),
        relative(process.cwd(), files[1]!),
      ],
      { env, windowsHide: true, timeout: 60000 },
    );
    expect(completed.stdout).not.toContain(password);
    const lines = (await readFile(files[1]!, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines[0].state).toBe('prepared');
    expect(lines[1].state).toBe('committed');
    expect(lines[0].recoveryCredential).toBe(lines[1].recoveryCredential);
    const original = await readFile(files[1]!, 'utf8');
    await expect(run('provision', files[0]!, files[1]!)).rejects.toThrow();
    expect(await readFile(files[1]!, 'utf8')).toBe(original);
    await writeFile(
      files[2]!,
      JSON.stringify({
        email,
        recoveryCredential: lines[1].recoveryCredential,
        newPassword: 'CLI recovered password 2026!',
      }),
      { mode: 0o600 },
    );
    await run('recover-owner', files[2]!, files[3]!);
    const recovered = (await readFile(files[3]!, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(recovered[0].recoveryCredential).toBe(
      recovered[1].recoveryCredential,
    );
    expect(recovered[1].recoveryCredential).not.toBe(
      lines[1].recoveryCredential,
    );
    await expect(run('recover-owner', files[2]!, files[4]!)).rejects.toThrow();
  } finally {
    for (const path of files) {
      try {
        await unlink(path);
      } catch (error) {
        if (!(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          cleanupErrors.push(error);
      }
    }
    try {
      await rmdir(directory);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  expect(cleanupErrors).toHaveLength(0);
}, 90000);
