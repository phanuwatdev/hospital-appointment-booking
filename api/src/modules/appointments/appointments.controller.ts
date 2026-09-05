import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AppointmentsService, type AppointmentDto } from './appointments.service';
import {
  appointmentIdParamSchema,
  cancelAppointmentBodySchema,
  createAppointmentBodySchema,
  idempotencyKeyHeaderSchema,
  listAppointmentsQuerySchema,
  staffIdHeaderSchema,
  type CancelAppointmentBody,
  type CreateAppointmentBody,
  type ListAppointmentsQuery,
} from './appointments.schema';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  async createAppointment(
    @Body(new ZodValidationPipe(createAppointmentBodySchema)) body: CreateAppointmentBody,
    // @Headers ในเวอร์ชันนี้ไม่รองรับ pipe เป็นอาร์กิวเมนต์ที่สอง (ต่างจาก @Param/@Query) EX @Headers('X-Staff-Id', new ZodValidationPipe(schema))
    // จึงรับค่าดิบมาก่อน แล้วเรียก ZodValidationPipe.transform() เองด้านล่าง
    @Headers('X-Staff-Id') rawStaffId: string | undefined,
    @Headers('Idempotency-Key') rawIdempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ data: AppointmentDto }> {
    const staffId = new ZodValidationPipe(staffIdHeaderSchema).transform(rawStaffId);
    const idempotencyKey = new ZodValidationPipe(idempotencyKeyHeaderSchema).transform(rawIdempotencyKey);

    const { appointment, created } = await this.appointmentsService.createAppointment({
      patientId: body.patientId,
      doctorId: body.doctorId,
      typeCode: body.typeCode,
      startsAt: body.startsAt,
      reason: body.reason,
      createdBy: staffId,
      idempotencyKey,
    });

    // สร้างใหม่ → 201, idempotent replay → 200 (ไม่ใช่ default 201 ของ @Post)
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return { data: appointment };
  }

  @Get()
  async listAppointments(
    @Query(new ZodValidationPipe(listAppointmentsQuerySchema)) query: ListAppointmentsQuery,
  ): Promise<{ data: AppointmentDto[] }> {
    const data = await this.appointmentsService.listAppointments(query);
    return { data };
  }

  @Get(':id')
  async getAppointment(
    @Param('id', new ZodValidationPipe(appointmentIdParamSchema)) id: string,
  ): Promise<{ data: AppointmentDto }> {
    const data = await this.appointmentsService.getAppointmentById(id);
    return { data };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelAppointment(
    @Param('id', new ZodValidationPipe(appointmentIdParamSchema)) id: string,
    @Body(new ZodValidationPipe(cancelAppointmentBodySchema)) body: CancelAppointmentBody,
    @Headers('X-Staff-Id') rawStaffId: string | undefined,
  ): Promise<{ data: AppointmentDto }> {
    const staffId = new ZodValidationPipe(staffIdHeaderSchema).transform(rawStaffId);

    const data = await this.appointmentsService.cancelAppointment({
      id,
      reason: body.reason,
      staffId,
    });

    return { data };
  }
}
