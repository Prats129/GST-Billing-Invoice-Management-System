import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  platformOrganization,
  platformAgreement,
  platformReceipt,
  platformGrantImport,
  platformDirectory,
} from './platform.js';
test('offline organization mapping requires real organization and installation identifiers', () => {
  const base = {
    name: 'Business',
    email: 'owner@example.test',
    edition: 'offline',
    mode: 'link',
    requestKey: randomUUID(),
  };
  expect(platformOrganization.safeParse(base).success).toBe(false);
  expect(
    platformOrganization.safeParse({
      ...base,
      runtimeId: randomUUID(),
      installationId: randomUUID(),
    }).success,
  ).toBe(true);
  expect(
    platformOrganization.safeParse({
      ...base,
      edition: 'saas',
      runtimeId: randomUUID(),
      installationId: randomUUID(),
    }).success,
  ).toBe(false);
});
test('commercial amounts are integer paise and agreement dates must be valid', () => {
  const base = {
    kind: 'subscription',
    startsAt: '2026-11-05T00:00:00.000Z',
    endsAt: '2026-12-05T00:00:00.000Z',
    dueDate: '2026-11-06',
    totalPaise: '125025',
    reference: 'Agreed externally',
    requestKey: randomUUID(),
  };
  expect(platformAgreement.safeParse(base).success).toBe(true);
  for (const update of [
    { totalPaise: '12.5' },
    { totalPaise: '-1' },
    { dueDate: '2026-02-31' },
    { endsAt: base.startsAt },
    { kind: 'subscription', endsAt: null },
  ])
    expect(platformAgreement.safeParse({ ...base, ...update }).success).toBe(
      false,
    );
  expect(
    platformAgreement.safeParse({ ...base, kind: 'perpetual', endsAt: null })
      .success,
  ).toBe(true);
});
test('receipts reject zero, decimals and unknown flags', () => {
  const base = {
    agreementId: randomUUID(),
    amountPaise: '1',
    receivedAt: '2026-11-05T00:00:00.000Z',
    reference: 'BANK-1',
    requestKey: randomUUID(),
  };
  expect(platformReceipt.safeParse(base).success).toBe(true);
  for (const update of [
    { amountPaise: '0' },
    { amountPaise: '1.01' },
    { enableAccess: true },
  ])
    expect(platformReceipt.safeParse({ ...base, ...update }).success).toBe(
      false,
    );
});
test('grant imports are bounded and response contracts reject unexpected fields', () => {
  expect(
    platformGrantImport.safeParse({
      requestId: null,
      grants: [],
      requestKey: randomUUID(),
    }).success,
  ).toBe(false);
  expect(
    platformDirectory.safeParse({
      items: [],
      hasMore: false,
      password: 'must not leak',
    }).success,
  ).toBe(false);
});
