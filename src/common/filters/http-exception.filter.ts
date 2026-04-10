import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import Stripe from 'stripe';

interface ErrorResponse {
  error: true;
  message: string;
  code: string;
  statusCode: number;
}

interface SupabaseError {
  message: string;
  code?: string;
}

function isSupabaseError(err: unknown): err is SupabaseError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    'code' in err &&
    typeof (err as Record<string, unknown>).code === 'string'
  );
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const isProd = process.env.NODE_ENV === 'production';

    let body: ErrorResponse;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      const message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as Record<string, unknown>).message?.toString() ??
            exception.message;

      body = {
        error: true,
        message: Array.isArray(message) ? message.join(', ') : message,
        code: toSnakeCase(exception.name),
        statusCode: status,
      };
    } else if (exception instanceof Stripe.errors.StripeError) {
      body = {
        error: true,
        message: isProd ? 'Payment processing error' : exception.message,
        code: 'STRIPE_ERROR',
        statusCode: HttpStatus.PAYMENT_REQUIRED,
      };
    } else if (isSupabaseError(exception)) {
      body = {
        error: true,
        message: isProd ? 'A database error occurred' : exception.message,
        code: 'DATABASE_ERROR',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      };
    } else {
      body = {
        error: true,
        message: 'Something went wrong',
        code: 'INTERNAL_ERROR',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      };
    }

    response.status(body.statusCode).json(body);
  }
}

function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toUpperCase()
    .replace(/^_/, '');
}
