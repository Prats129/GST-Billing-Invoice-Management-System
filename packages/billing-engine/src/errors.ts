export type CalculationErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_AUTHORITY'
  | 'UNSUPPORTED_RULE_VERSION'
  | 'UNSUPPORTED_DATE'
  | 'UNSUPPORTED_SCENARIO'
  | 'PERMISSION_DENIED'
  | 'MISSING_TAX_CLASSIFICATION'
  | 'TAX_NOT_REVIEWED'
  | 'INVALID_TAX_HISTORY'
  | 'INVALID_CLASSIFICATION'
  | 'FUTURE_TAX_OVERRIDE'
  | 'DISCOUNT_EXCEEDS_VALUE'
  | 'NO_DISCOUNT_ELIGIBILITY'
  | 'MULTIPLE_PLACES_OF_SUPPLY'
  | 'AMOUNT_OVERFLOW';
export class BillingCalculationError extends Error {
  override readonly name = 'BillingCalculationError';
  constructor(
    readonly code: CalculationErrorCode,
    message: string,
    readonly path: string = '',
  ) {
    super(message);
  }
}
export function fail(
  code: CalculationErrorCode,
  message: string,
  path = '',
): never {
  throw new BillingCalculationError(code, message, path);
}
interface Schema<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: readonly { path: readonly PropertyKey[] }[] };
      };
}
export function validate<T>(
  schema: Schema<T>,
  value: unknown,
  code: 'INVALID_INPUT' | 'INVALID_AUTHORITY' = 'INVALID_INPUT',
): T {
  const result = schema.safeParse(value);
  if (!result.success)
    fail(
      code,
      code === 'INVALID_AUTHORITY'
        ? 'Invalid calculation authority'
        : 'Invalid calculation input',
      result.error.issues[0]?.path.map(String).join('.') ?? '',
    );
  return result.data;
}
