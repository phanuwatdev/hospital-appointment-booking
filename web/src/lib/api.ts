// -----------------------------------------------------------------------------
// API client — เรียก api/ ทุกจุดผ่านที่นี่ที่เดียว
// -----------------------------------------------------------------------------

import type {
  ApiError,
  Appointment,
  AppointmentStatus,
  AppointmentType,
  AppointmentTypeCode,
  AvailabilityResponse,
  Department,
  Doctor,
  Patient,
  Schedule,
} from './api-types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// stub แทน auth จริง — ระบบยังไม่มีระบบ login จึงส่ง staff id คงที่จาก db/seed.sql
// ('somchai.n') ไปกับทุก request แทน token จริง
const STUB_STAFF_ID = '44444444-4444-4444-4444-444444444401';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function buildQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, value);
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Staff-Id': STUB_STAFF_ID,
      ...init.headers,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiClientError(
      res.status,
      body?.error.code ?? 'UNKNOWN_ERROR',
      body?.error.message ?? `คำขอล้มเหลว (HTTP ${res.status})`,
      body?.error.details,
    );
  }

  return (await res.json()) as T;
}

export async function getDepartments(): Promise<Department[]> {
  const { data } = await apiFetch<{ data: Department[] }>('/api/departments');
  return data;
}

export async function getDoctors(departmentId?: string): Promise<Doctor[]> {
  const query = buildQuery({ departmentId });
  const { data } = await apiFetch<{ data: Doctor[] }>(`/api/doctors${query}`);
  return data;
}

export async function getPatients(q?: string): Promise<Patient[]> {
  const query = buildQuery({ q });
  const { data } = await apiFetch<{ data: Patient[] }>(`/api/patients${query}`);
  return data;
}

export async function getAppointmentTypes(): Promise<AppointmentType[]> {
  const { data } = await apiFetch<{ data: AppointmentType[] }>('/api/appointment-types');
  return data;
}

export async function getSchedules(doctorId: string): Promise<Schedule[]> {
  const { data } = await apiFetch<{ data: Schedule[] }>(`/api/doctors/${doctorId}/schedules`);
  return data;
}

export async function getAvailability(
  doctorId: string,
  date: string,
  typeCode: AppointmentTypeCode,
): Promise<AvailabilityResponse> {
  const query = buildQuery({ date, typeCode });
  const { data } = await apiFetch<{ data: AvailabilityResponse }>(`/api/doctors/${doctorId}/availability${query}`);
  return data;
}

export interface CreateAppointmentBody {
  patientId: string;
  doctorId: string;
  typeCode: AppointmentTypeCode;
  /** ISO 8601 พร้อม offset เช่น 2026-08-31T14:00:00+07:00 */
  startsAt: string;
  reason?: string;
}

export async function createAppointment(body: CreateAppointmentBody, idempotencyKey: string): Promise<Appointment> {
  const { data } = await apiFetch<{ data: Appointment }>('/api/appointments', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  });
  return data;
}

export interface ListAppointmentsFilters {
  doctorId?: string;
  patientId?: string;
  /** YYYY-MM-DD ตามปฏิทินท้องถิ่น Asia/Bangkok */
  date?: string;
  status?: AppointmentStatus;
}

export async function listAppointments(filters: ListAppointmentsFilters = {}): Promise<Appointment[]> {
  const query = buildQuery({
    doctorId: filters.doctorId,
    patientId: filters.patientId,
    date: filters.date,
    status: filters.status,
  });
  const { data } = await apiFetch<{ data: Appointment[] }>(`/api/appointments${query}`);
  return data;
}

export async function getAppointment(id: string): Promise<Appointment> {
  const { data } = await apiFetch<{ data: Appointment }>(`/api/appointments/${id}`);
  return data;
}

export async function cancelAppointment(id: string, reason: string): Promise<Appointment> {
  const { data } = await apiFetch<{ data: Appointment }>(`/api/appointments/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  return data;
}
