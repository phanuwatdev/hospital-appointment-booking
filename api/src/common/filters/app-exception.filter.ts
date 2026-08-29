import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

import { AppException, type AppErrorBody } from '../errors/app-exception';

/**
 * รวบ error ทุกชนิดให้ตอบกลับเป็นรูปแบบเดียว: { error: { code, message, details } }
 * ตาม contract ใน docs/api.http — ห้าม controller/service ประกอบ response error เอง
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as AppErrorBody;
      response.status(status).json({ error: body });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message = typeof body === 'string' ? body : ((body as { message?: string }).message ?? exception.message);

      response.status(status).json({
        error: {
          code: status === HttpStatus.BAD_REQUEST ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
          message,
          details: {},
        },
      });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error', details: {} },
    });
  }
}
