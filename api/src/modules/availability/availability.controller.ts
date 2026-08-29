import { Controller, Get, Param, Query } from '@nestjs/common';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AvailabilityService, type AvailabilityResult } from './availability.service';
import { availabilityQuerySchema, doctorIdParamSchema, type AvailabilityQuery } from './availability.schema';

@Controller('doctors')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get(':doctorId/availability')
  async getAvailability(
    @Param('doctorId', new ZodValidationPipe(doctorIdParamSchema)) doctorId: string,
    @Query(new ZodValidationPipe(availabilityQuerySchema)) query: AvailabilityQuery,
  ): Promise<{ data: AvailabilityResult }> {
    const data = await this.availabilityService.getAvailability(doctorId, query.date, query.typeCode);
    return { data };
  }
}
