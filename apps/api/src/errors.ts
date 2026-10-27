import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode = error instanceof HttpException ? error.getStatus() : 500;
    const messages: Record<number, string> = {
      400: 'Bad request',
      403: 'Forbidden',
      404: 'Not found',
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
