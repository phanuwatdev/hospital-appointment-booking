import { HttpException, HttpStatus } from '@nestjs/common';

import type { ErrorCode } from './error-codes';

export interface AppErrorBody {
  code: ErrorCode;
  message: string;
  details: Record<string, unknown>;
}

/**
 * exception มาตรฐานของ business error ทั้งหมดในระบบ
 * ทำให้ทุก error ตอบกลับเป็นรูปแบบเดียวกัน: { error: { code, message, details } }
 */
export class AppException extends HttpException {
  constructor(
    code: ErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    const body: AppErrorBody = { code, message, details };
    super(body, status);
  }
}
