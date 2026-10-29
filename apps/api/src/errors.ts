import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { SecurityError } from './security/errors.js';
import { BillingCalculationError } from '@gst/billing-engine';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof BillingCalculationError) {
      response.status(400).json({
        error: { statusCode: 400, code: error.code, message: error.message },
      });
      return;
    }
    if (error instanceof SecurityError) {
      response.status(error.getStatus()).json({
        error: {
          statusCode: error.getStatus(),
          code: error.code,
          message: error.message,
        },
      });
      return;
    }
    const cause =
      error && typeof error === 'object' && 'cause' in error
        ? error.cause
        : error;
    const databaseCode =
      cause && typeof cause === 'object' && 'code' in cause
        ? cause.code
        : undefined;
    if (
      ['23505', '23503', '23514', '40001', '40P01'].includes(
        String(databaseCode),
      )
    ) {
      response.status(409).json({
        error: {
          statusCode: 409,
          code: 'CONFLICT',
          message: 'Operation conflicts with the current state',
        },
      });
      return;
    }
    const parserType =
      error && typeof error === 'object' && 'type' in error
        ? error.type
        : undefined;
    const statusCode =
      error instanceof HttpException
        ? error.getStatus()
        : parserType === 'entity.parse.failed'
          ? 400
          : parserType === 'entity.too.large'
            ? 413
            : 500;
    const messages: Record<number, string> = {
      400: 'Bad request',
      403: 'Forbidden',
      404: 'Not found',
      413: 'Request too large',
      503: 'Service unavailable',
    };
    response.status(statusCode).json({
      error: {
        statusCode,
        message: messages[statusCode] ?? 'Internal server error',
      },
    });
  }
}
