import { expect, test } from 'vitest';
import { allocatePaise } from './allocation.js';
import { BillingCalculationError } from './errors.js';
test('integer allocations conserve units and stay within quota/capacity across generated weights', () => {
  for (let seed = 1; seed <= 600; seed++) {
    const weights = Array.from({ length: (seed % 17) + 1 }, (_, index) => ({
      key: `key-${String(index).padStart(2, '0')}`,
      weight: BigInt((seed * (index + 7) + index * 11) % 31),
    }));
    const sum = weights.reduce((value, row) => value + row.weight, 0n);
    const amount = BigInt(seed) % (sum + 1n);
    const result = allocatePaise(amount, weights);
    expect(
      [...result.values()].reduce((value, share) => value + share, 0n),
    ).toBe(amount);
    for (const row of weights) {
      const allocated = result.get(row.key)!;
      expect(allocated >= 0n && allocated <= row.weight).toBe(true);
      if (sum) {
        const floorQuota = (amount * row.weight) / sum;
        expect(allocated === floorQuota || allocated === floorQuota + 1n).toBe(
          true,
        );
      }
      if (!row.weight) expect(allocated).toBe(0n);
    }
    expect(allocatePaise(amount, [...weights].reverse())).toEqual(result);
  }
});
test('empty/negative/duplicate allocation boundaries are explicit', () => {
  expect(allocatePaise(0n, [])).toEqual(new Map());
  expect(() => allocatePaise(-1n, [{ key: 'a', weight: 1n }])).toThrow(
    BillingCalculationError,
  );
  expect(() => allocatePaise(0n, [{ key: 'a', weight: -1n }])).toThrow(
    BillingCalculationError,
  );
  expect(() =>
    allocatePaise(1n, [
      { key: 'a', weight: 1n },
      { key: 'a', weight: 1n },
    ]),
  ).toThrow(BillingCalculationError);
});
