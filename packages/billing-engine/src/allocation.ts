import { fail } from './errors.js';
export interface Weight {
  key: string;
  weight: bigint;
}
/** Hamilton allocation in integer units. Ties use ASCII keys, not locale or array order. */
export function allocatePaise(
  amount: bigint,
  weights: readonly Weight[],
): Map<string, bigint> {
  if (
    amount < 0n ||
    weights.some((row) => row.weight < 0n) ||
    new Set(weights.map((row) => row.key)).size !== weights.length
  )
    fail('INVALID_INPUT', 'Invalid allocation weights');
  const sum = weights.reduce((total, row) => total + row.weight, 0n);
  if (amount > sum)
    fail('DISCOUNT_EXCEEDS_VALUE', 'Allocation exceeds eligible value');
  const shares = weights.map((row) => ({
    ...row,
    share: sum ? (amount * row.weight) / sum : 0n,
    remainder: sum ? (amount * row.weight) % sum : 0n,
  }));
  let remaining = amount - shares.reduce((total, row) => total + row.share, 0n);
  const ranked = [...shares].sort((a, b) =>
    a.remainder === b.remainder
      ? a.key < b.key
        ? -1
        : a.key > b.key
          ? 1
          : 0
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (let index = 0; remaining > 0n; index++, remaining--)
    ranked[index]!.share++;
  return new Map(shares.map((row) => [row.key, row.share]));
}
