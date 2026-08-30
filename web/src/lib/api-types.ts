// -----------------------------------------------------------------------------
// ชนิดข้อมูลของทุก response จาก api/ — ต้องตรงกับ docs/api.http และ DTO ฝั่ง server เท่านั้น
// -----------------------------------------------------------------------------

export type AppointmentTypeCode = 'NEW_PATIENT' | 'FOLLOW_UP' | 'CONSULTATION' | 'PROCEDURE';

export type AppointmentStatus = 'booked' | 'checked_in' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';

export interface Department {
  id: string;
  code: string;
  name: string;
  nameTh: string | null;
  isActive: boolean;
}

export interface Doctor {
  id: string;
  code: string;
  fullName: string;
  licenseNo: string | null;
  primaryDepartmentId: string;
  departmentCode: string;
  departmentName: string;
  isActive: boolean;
}

export interface Patient {
  id: string;
  hn: string;
  fullName: string;
  dateOfBirth: string | null;
  phone: string | null;
}

export interface AppointmentType {
  id: string;
  code: AppointmentTypeCode;
  name: string;
  nameTh: string | null;
  durationMin: number;
  bufferAfterMin: number;
  minLeadTimeMin: number;
  maxAdvanceDays: number;
  sortOrder: number;
}

export interface ScheduleBreak {
  id: string;
  startTime: string;
  endTime: string;
  label: string;
}

export interface Schedule {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotIntervalMin: number;
  acceptsBooking: boolean;
  validFrom: string;
  validTo: string | null;
  breaks: ScheduleBreak[];
}

export type AvailabilityReason = 'NO_SCHEDULE' | 'SCHEDULE_NOT_BOOKABLE' | 'DOCTOR_ON_LEAVE' | 'FULLY_BOOKED';

export interface AvailabilitySlot {
  startsAt: string;
  endsAt: string;
}

export interface AvailabilityResponse {
  doctorId: string;
  date: string;
  typeCode: AppointmentTypeCode;
  durationMin: number;
  slots: AvailabilitySlot[];
  reason?: AvailabilityReason;
}

export interface Appointment {
  id: string;
  appointmentNo: string;
  patientId: string;
  doctorId: string;
  departmentId: string;
  typeCode: AppointmentTypeCode;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  reason: string | null;
  createdBy: string;
  version: number;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
