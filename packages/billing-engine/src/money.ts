import { calculationMoneySchema } from '@gst/contracts';
import { fail, validate } from './errors.js';
export const MAX_MONEY_PAISE = 999999999999999999n;
export function scaled(value: string): bigint {
  return BigInt(value.replace('.', ''));
}
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n)
    fail(
      'INVALID_INPUT',
      'Rounding requires a nonnegative value and positive divisor',
    );
  return (numerator + denominator / 2n) / denominator;
}
export function formatScaled(value: bigint, scale: number): string {
  const digits = (value < 0n ? -value : value)
    .toString()
    .padStart(scale + 1, '0');
  return `${value < 0n ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
export function money(value: bigint): string {
  if (value < 0n || value > MAX_MONEY_PAISE)
    fail('AMOUNT_OVERFLOW', 'Calculated amount exceeds supported money bounds');
  return formatScaled(value, 2);
}
/** Separate from invoice-line paise rounding. Does not determine a filing liability. */
export function roundToNearestRupee(value: unknown): {
  amount: string;
  adjustment: string;
} {
  const paise = scaled(validate(calculationMoneySchema, value));
  const rounded = roundHalfUp(paise, 100n) * 100n;
  return {
    amount: money(rounded),
    adjustment: formatScaled(rounded - paise, 2),
  };
}
