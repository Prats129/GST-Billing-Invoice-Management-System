import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { invoiceDraftSchema, createInvoiceSchema } from './invoicing.js';
const draft = {
  version: 0,
  customerId: randomUUID(),
  issueDate: '2026-10-29',
  supplyDate: '2026-10-29',
  deliveryAddress: {
    line1: '12 Road',
    city: 'Mumbai',
    stateCode: '27',
    postalCode: '400001',
  },
  ordinarySupplyConfirmed: true,
  lines: [{ id: 'a', catalogItemId: randomUUID(), quantity: '1' }],
};
test('draft contract rejects financial authority injection and unsupported scope', () => {
  expect(invoiceDraftSchema.parse(draft).lines[0]?.quantity).toBe('1.000000');
  for (const patch of [
    { totals: { total: '1' } },
    { permissions: ['price.override'] },
    { ordinarySupplyConfirmed: false },
    { lines: [{ ...draft.lines[0], catalogUnitPrice: '1' }] },
    { lines: [draft.lines[0], draft.lines[0]] },
    { issueDate: '2026-02-30' },
    {
      lines: Array.from({ length: 101 }, (_, i) => ({
        ...draft.lines[0],
        id: String(i),
      })),
    },
  ])
    expect(invoiceDraftSchema.safeParse({ ...draft, ...patch }).success).toBe(
      false,
    );
  expect(
    createInvoiceSchema.safeParse({ ...draft, requestKey: randomUUID() })
      .success,
  ).toBe(true);
});
