import { Controller, Get, Param, Query } from '@nestjs/common';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  MasterDataService,
  type AppointmentTypeDto,
  type DepartmentDto,
  type DoctorDto,
  type DoctorScheduleDto,
  type PatientDto,
} from './master-data.service';
import {
  doctorIdParamSchema,
  doctorsQuerySchema,
  patientsQuerySchema,
  type DoctorsQuery,
  type PatientsQuery,
} from './master-data.schema';

@Controller()
export class MasterDataController {
  constructor(private readonly masterDataService: MasterDataService) {}

  @Get('departments')
  async getDepartments(): Promise<{ data: DepartmentDto[] }> {
    const data = await this.masterDataService.listDepartments();
    return { data };
  }

  @Get('doctors')
  async getDoctors(
    @Query(new ZodValidationPipe(doctorsQuerySchema)) query: DoctorsQuery,
  ): Promise<{ data: DoctorDto[] }> {
    const data = await this.masterDataService.listDoctors(query.departmentId);
    return { data };
  }

  @Get('patients')
  async getPatients(
    @Query(new ZodValidationPipe(patientsQuerySchema)) query: PatientsQuery,
  ): Promise<{ data: PatientDto[] }> {
    const data = await this.masterDataService.listPatients(query.q);
    return { data };
  }

  @Get('appointment-types')
  async getAppointmentTypes(): Promise<{ data: AppointmentTypeDto[] }> {
    const data = await this.masterDataService.listAppointmentTypes();
    return { data };
  }

  @Get('doctors/:id/schedules')
  async getDoctorSchedules(
    @Param('id', new ZodValidationPipe(doctorIdParamSchema)) id: string,
  ): Promise<{ data: DoctorScheduleDto[] }> {
    const data = await this.masterDataService.getDoctorSchedules(id);
    return { data };
  }
}
