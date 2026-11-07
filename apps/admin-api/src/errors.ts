import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { ZodError } from 'zod';
import { EntitlementError, CryptoRateLimitError } from '@gst/security';
function validationHint(error: ZodError) {
  const fields = [
    ...new Set(
      error.issues
        .map((issue) => issue.path.map(String).join('.'))
        .filter(Boolean),
    ),
  ].slice(0, 5);
  return fields.length
    ? `Check these fields: ${fields.join(', ')}. Review required values, date ranges and formats.`
    : 'Check the supplied fields and remove unsupported values.';
}
export class PlatformError extends HttpException {
  constructor(
    readonly code: string,
    status = 409,
    message = 'The operation conflicts with the current state.',
  ) {
    super(message, status);
  }
}
export function fail(code: string, status = 409, message?: string): never {
  throw new PlatformError(code, status, message);
}
@Catch()
export class PlatformErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const pg =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
    const e =
      error instanceof EntitlementError
        ? new PlatformError(
            'INVALID_GRANT',
            400,
            'The signed grant could not be verified.',
          )
        : error instanceof CryptoRateLimitError
          ? new PlatformError('RATE_LIMITED', 429, 'Too many attempts.')
          : ['23505', '23503', '23514', '40001', '40P01'].includes(pg)
            ? new PlatformError('CONFLICT')
            : error instanceof PlatformError
              ? error
              : error instanceof ZodError
                ? new PlatformError('INVALID_INPUT', 400, validationHint(error))
                : new PlatformError(
                    'REQUEST_FAILED',
                    error instanceof HttpException ? error.getStatus() : 500,
                    'The request could not be completed.',
                  );
    host
      .switchToHttp()
      .getResponse()
      .status(e.getStatus())
      .json({ error: { code: e.code, message: e.message } });
  }
}
