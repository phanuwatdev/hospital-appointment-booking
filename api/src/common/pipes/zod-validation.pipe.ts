import { Injectable, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

import { AppException } from '../errors/app-exception';

/**
 * validate ค่าที่เข้ามาทาง param/query ด้วย zod schema แล้วคืนค่าที่ parse แล้ว
 * ตก validation → AppException('VALIDATION_ERROR') เสมอ ไม่ใช่ BadRequestException ของ Nest
 */
@Injectable()
export class ZodValidationPipe<Schema extends z.ZodTypeAny> implements PipeTransform<unknown, z.infer<Schema>> {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown): z.infer<Schema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException('VALIDATION_ERROR', 'ข้อมูลที่ส่งมาไม่ถูกต้อง', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
