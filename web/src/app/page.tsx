'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format, startOfMonth, startOfToday } from 'date-fns';
import { th } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';
import { toast } from 'sonner';

import {
  ApiClientError,
  cancelAppointment,
  createAppointment,
  getAppointmentTypes,
  getAvailability,
  getDoctors,
  getPatients,
  listAppointments,
} from '@/lib/api';
import type {
  Appointment,
  AppointmentStatus,
  AppointmentType,
  AppointmentTypeCode,
  AvailabilityReason,
  AvailabilityResponse,
  AvailabilitySlot,
  Doctor,
  Patient,
} from '@/lib/api-types';
import { errorMessageFor } from '@/lib/error-messages';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

const BANGKOK_TZ = 'Asia/Bangkok';

const AVAILABILITY_REASON_MESSAGES: Record<AvailabilityReason, string> = {
  NO_SCHEDULE: 'แพทย์ไม่มีตารางออกตรวจในวันนี้',
  SCHEDULE_NOT_BOOKABLE: 'วันนี้เปิดตรวจแบบ walk-in ไม่รับนัดล่วงหน้า',
  DOCTOR_ON_LEAVE: 'แพทย์ลาในวันนี้',
  FULLY_BOOKED: 'นัดเต็มแล้ว',
};

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  booked: 'จองแล้ว',
  checked_in: 'เช็คอินแล้ว',
  in_progress: 'กำลังตรวจ',
  completed: 'เสร็จสิ้น',
  cancelled: 'ยกเลิกแล้ว',
  no_show: 'ไม่มาตามนัด',
};

function statusBadgeVariant(
  status: AppointmentStatus,
): 'default' | 'secondary' | 'outline' {
  switch (status) {
    case 'cancelled':
    case 'no_show':
      return 'outline';
    case 'completed':
      return 'secondary';
    default:
      return 'default';
  }
}

function formatSlotTime(iso: string): string {
  return formatInTimeZone(iso, BANGKOK_TZ, 'HH:mm');
}

function formatApiDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function formatHeadingDate(date: Date): string {
  return format(date, "EEEE'ที่' d MMMM yyyy", { locale: th });
}

function doctorLabel(doctor: Doctor): string {
  return `${doctor.fullName} · ${doctor.departmentName}`;
}

function typeLabel(type: AppointmentType): string {
  return `${type.nameTh ?? type.name} · ${type.durationMin} นาที`;
}

function patientLabel(patient: Patient): string {
  return `${patient.hn} · ${patient.fullName}`;
}

function messageForError(err: unknown, fallback: string): string {
  return err instanceof ApiClientError ? errorMessageFor(err.code) : fallback;
}

interface SlotDialogState {
  slot: AvailabilitySlot;
  idempotencyKey: string;
}

export default function Home() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([]);
  const [allPatients, setAllPatients] = useState<Patient[]>([]);

  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => addDays(startOfToday(), 1));
  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(addDays(startOfToday(), 1)));
  const [typeCode, setTypeCode] = useState<AppointmentTypeCode | null>('FOLLOW_UP');

  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);

  const [dialogState, setDialogState] = useState<SlotDialogState | null>(null);
  const [patientQuery, setPatientQuery] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [cancelDialogState, setCancelDialogState] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelSubmitting, setCancelSubmitting] = useState(false);

  const availabilityRequestId = useRef(0);
  const appointmentsRequestId = useRef(0);
  const patientsRequestId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function loadReferenceData() {
      try {
        const [doctorsData, typesData, patientsData] = await Promise.all([
          getDoctors(),
          getAppointmentTypes(),
          getPatients(),
        ]);
        if (cancelled) return;
        setDoctors(doctorsData);
        setAppointmentTypes(typesData);
        setAllPatients(patientsData);
        setDoctorId((prev) => prev ?? doctorsData[0]?.id ?? null);
      } catch (err) {
        if (cancelled) return;
        toast.error(messageForError(err, 'โหลดข้อมูลเริ่มต้นไม่สำเร็จ'));
      }
    }
    loadReferenceData();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadAvailability = useCallback(async () => {
    if (!doctorId || !selectedDate || !typeCode) return;
    const requestId = ++availabilityRequestId.current;
    setAvailabilityLoading(true);
    try {
      const data = await getAvailability(doctorId, formatApiDate(selectedDate), typeCode);
      if (requestId !== availabilityRequestId.current) return;
      setAvailability(data);
    } catch (err) {
      if (requestId !== availabilityRequestId.current) return;
      setAvailability(null);
      toast.error(messageForError(err, 'โหลดเวลาว่างไม่สำเร็จ'));
    } finally {
      if (requestId === availabilityRequestId.current) setAvailabilityLoading(false);
    }
  }, [doctorId, selectedDate, typeCode]);

  useEffect(() => {
    if (!doctorId || !selectedDate || !typeCode) return;
    const timer = setTimeout(() => loadAvailability(), 0);
    return () => clearTimeout(timer);
  }, [doctorId, selectedDate, typeCode, loadAvailability]);

  const loadAppointments = useCallback(async () => {
    if (!doctorId || !selectedDate) return;
    const requestId = ++appointmentsRequestId.current;
    setAppointmentsLoading(true);
    try {
      const data = await listAppointments({ doctorId, date: formatApiDate(selectedDate) });
      if (requestId !== appointmentsRequestId.current) return;
      setAppointments(data);
    } catch (err) {
      if (requestId !== appointmentsRequestId.current) return;
      toast.error(messageForError(err, 'โหลดรายการนัดไม่สำเร็จ'));
    } finally {
      if (requestId === appointmentsRequestId.current) setAppointmentsLoading(false);
    }
  }, [doctorId, selectedDate]);

  useEffect(() => {
    if (!doctorId || !selectedDate) return;
    const timer = setTimeout(() => loadAppointments(), 0);
    return () => clearTimeout(timer);
  }, [doctorId, selectedDate, loadAppointments]);

  useEffect(() => {
    if (!dialogState || !patientQuery) return;
    const requestId = ++patientsRequestId.current;
    const timer = setTimeout(async () => {
      setPatientsLoading(true);
      try {
        const data = await getPatients(patientQuery);
        if (requestId !== patientsRequestId.current) return;
        setPatients(data);
      } catch (err) {
        if (requestId !== patientsRequestId.current) return;
        toast.error(messageForError(err, 'ค้นหาคนไข้ไม่สำเร็จ'));
      } finally {
        if (requestId === patientsRequestId.current) setPatientsLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [dialogState, patientQuery]);

  const selectedDoctor = useMemo(() => doctors.find((d) => d.id === doctorId), [doctors, doctorId]);

  const patientsById = useMemo(() => {
    const map = new Map(allPatients.map((p) => [p.id, p]));
    for (const patient of patients) map.set(patient.id, patient);
    return map;
  }, [allPatients, patients]);

  const typesByCode = useMemo(() => new Map(appointmentTypes.map((t) => [t.code, t])), [appointmentTypes]);

  const visiblePatients = patientQuery ? patients : allPatients;

  const sortedAppointments = useMemo(
    () => [...appointments].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [appointments],
  );

  function openSlotDialog(slot: AvailabilitySlot) {
    setDialogState({ slot, idempotencyKey: crypto.randomUUID() });
    setPatientQuery('');
    setPatients([]);
    setSelectedPatientId(null);
    setReason('');
  }

  function closeDialog() {
    setDialogState(null);
  }

  async function handleConfirmBooking() {
    if (!dialogState || !doctorId || !typeCode || !selectedPatientId) return;
    setSubmitting(true);
    try {
      await createAppointment(
        {
          patientId: selectedPatientId,
          doctorId,
          typeCode,
          startsAt: dialogState.slot.startsAt,
          reason: reason.trim() || undefined,
        },
        dialogState.idempotencyKey,
      );
      toast.success('จองนัดสำเร็จ');
      closeDialog();
      await Promise.all([loadAvailability(), loadAppointments()]);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'SLOT_TAKEN') {
        toast.warning('ช่วงเวลานี้เพิ่งถูกจองไปโดยผู้อื่น กำลังรีเฟรชรายการเวลาว่าง');
        closeDialog();
        await loadAvailability();
      } else {
        toast.error(messageForError(err, 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function openCancelDialog(appointment: Appointment) {
    setCancelDialogState(appointment);
    setCancelReason('');
  }

  function closeCancelDialog() {
    setCancelDialogState(null);
  }

  async function handleConfirmCancel() {
    const trimmedReason = cancelReason.trim();
    if (!cancelDialogState || !trimmedReason) return;
    setCancelSubmitting(true);
    try {
      await cancelAppointment(cancelDialogState.id, trimmedReason);
      toast.success('ยกเลิกนัดสำเร็จ');
      closeCancelDialog();
      await Promise.all([loadAppointments(), loadAvailability()]);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'INVALID_STATUS_TRANSITION') {
        toast.error('นัดนี้ถูกยกเลิกหรือปิดไปแล้ว');
        closeCancelDialog();
        await loadAppointments();
      } else {
        toast.error(messageForError(err, 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง'));
      }
    } finally {
      setCancelSubmitting(false);
    }
  }

  const cancelPatient = cancelDialogState ? patientsById.get(cancelDialogState.patientId) : undefined;
  const cancelType = cancelDialogState ? typesByCode.get(cancelDialogState.typeCode) : undefined;

  const canLoadAvailability = Boolean(doctorId && selectedDate && typeCode);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-6">
      <header>
        <h1 className="text-xl font-semibold">ระบบจองนัดผู้ป่วยนอก</h1>
        <p className="text-sm text-muted-foreground">
          เลือกแพทย์ วันที่ และประเภทนัด เพื่อดูเวลาว่างและจองนัด
        </p>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>จองนัด</CardTitle>
            <CardDescription>เลือกแพทย์ วันที่ และประเภทนัด</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">แพทย์</label>
              <Select value={doctorId} onValueChange={(value) => setDoctorId(value)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="เลือกแพทย์">
                    {(value: string | null) => {
                      const doctor = value ? doctors.find((d) => d.id === value) : undefined;
                      return doctor ? doctorLabel(doctor) : 'เลือกแพทย์';
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {doctors.map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      {doctorLabel(doctor)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">วันที่</label>
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                  setSelectedDate(date);
                  if (date) setViewMonth(startOfMonth(date));
                }}
                month={viewMonth}
                onMonthChange={setViewMonth}
                disabled={{ before: startOfToday() }}
                locale={th}
                className="w-fit rounded-lg border"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">ประเภทนัด</label>
              <Select
                value={typeCode}
                onValueChange={(value) => setTypeCode(value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="เลือกประเภทนัด">
                    {(value: AppointmentTypeCode | null) => {
                      const type = value ? typesByCode.get(value) : undefined;
                      return type ? typeLabel(type) : 'เลือกประเภทนัด';
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {appointmentTypes.map((type) => (
                    <SelectItem key={type.id} value={type.code}>
                      {typeLabel(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">เวลาว่าง</label>
              {!canLoadAvailability && (
                <p className="text-sm text-muted-foreground">กรุณาเลือกแพทย์ วันที่ และประเภทนัดให้ครบ</p>
              )}
              {canLoadAvailability && availabilityLoading && (
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              )}
              {canLoadAvailability && !availabilityLoading && availability && availability.slots.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {availability.reason ? AVAILABILITY_REASON_MESSAGES[availability.reason] : 'ไม่มีเวลาว่าง'}
                </p>
              )}
              {canLoadAvailability && !availabilityLoading && availability && availability.slots.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {availability.slots.map((slot) => (
                    <Button
                      key={slot.startsAt}
                      variant="outline"
                      size="sm"
                      onClick={() => openSlotDialog(slot)}
                    >
                      {formatSlotTime(slot.startsAt)}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {selectedDoctor ? `รายการนัดของ ${selectedDoctor.fullName}` : 'รายการนัด'}
            </CardTitle>
            <CardDescription>
              {selectedDate ? formatHeadingDate(selectedDate) : 'เลือกแพทย์และวันที่เพื่อดูรายการนัด'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(!doctorId || !selectedDate) && (
              <p className="text-sm text-muted-foreground">ยังไม่ได้เลือกแพทย์หรือวันที่</p>
            )}
            {doctorId && selectedDate && appointmentsLoading && (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            )}
            {doctorId && selectedDate && !appointmentsLoading && sortedAppointments.length === 0 && (
              <p className="text-sm text-muted-foreground">ยังไม่มีนัดในวันนี้</p>
            )}
            {doctorId && selectedDate && !appointmentsLoading && sortedAppointments.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เวลา</TableHead>
                    <TableHead>คนไข้</TableHead>
                    <TableHead>ประเภท</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedAppointments.map((appt) => {
                    const patient = patientsById.get(appt.patientId);
                    const type = appointmentTypes.find((t) => t.code === appt.typeCode);
                    const isCancelled = appt.status === 'cancelled';
                    const canCancel = !isCancelled && appt.status !== 'completed' && appt.status !== 'no_show';
                    return (
                      <TableRow key={appt.id} className={isCancelled ? 'opacity-50' : undefined}>
                        <TableCell>
                          {formatSlotTime(appt.startsAt)}–{formatSlotTime(appt.endsAt)}
                        </TableCell>
                        <TableCell>{patient ? patientLabel(patient) : appt.patientId}</TableCell>
                        <TableCell>{type ? (type.nameTh ?? type.name) : appt.typeCode}</TableCell>
                        <TableCell>
                          <Badge variant={statusBadgeVariant(appt.status)}>
                            {STATUS_LABELS[appt.status]}
                          </Badge>
                          {isCancelled && appt.cancellationReason && (
                            <p
                              className="mt-1 max-w-40 truncate text-xs text-muted-foreground"
                              title={appt.cancellationReason}
                            >
                              เหตุผล: {appt.cancellationReason}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          {canCancel && (
                            <Button variant="outline" size="sm" onClick={() => openCancelDialog(appt)}>
                              ยกเลิก
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={Boolean(dialogState)}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยืนยันการจองนัด</DialogTitle>
            <DialogDescription>
              {selectedDoctor && selectedDate && dialogState && (
                <>
                  {doctorLabel(selectedDoctor)} · {formatHeadingDate(selectedDate)} เวลา{' '}
                  {formatSlotTime(dialogState.slot.startsAt)}–{formatSlotTime(dialogState.slot.endsAt)} น.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">ค้นหาคนไข้ (HN หรือชื่อ)</label>
              <Input
                value={patientQuery}
                onChange={(e) => setPatientQuery(e.target.value)}
                placeholder="ค้นหาด้วย HN หรือชื่อคนไข้"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">คนไข้</label>
              <Select value={selectedPatientId} onValueChange={(value) => setSelectedPatientId(value)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={patientsLoading ? 'กำลังค้นหา...' : 'เลือกคนไข้'}>
                    {(value: string | null) => {
                      const patient = value ? patientsById.get(value) : undefined;
                      return patient ? patientLabel(patient) : patientsLoading ? 'กำลังค้นหา...' : 'เลือกคนไข้';
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {visiblePatients.map((patient) => (
                    <SelectItem key={patient.id} value={patient.id}>
                      {patientLabel(patient)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">เหตุผลการมาพบแพทย์ (ไม่บังคับ)</label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="ระบุอาการหรือเหตุผล (ถ้ามี)"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={submitting}>
              ยกเลิก
            </Button>
            <Button onClick={handleConfirmBooking} disabled={submitting || !selectedPatientId}>
              {submitting ? 'กำลังจอง...' : 'ยืนยันการจอง'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(cancelDialogState)}
        onOpenChange={(open) => {
          if (!open) closeCancelDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยกเลิกนัด</DialogTitle>
            <DialogDescription>
              {cancelDialogState && (
                <>
                  {formatSlotTime(cancelDialogState.startsAt)}–{formatSlotTime(cancelDialogState.endsAt)} น. ·{' '}
                  {cancelPatient ? patientLabel(cancelPatient) : cancelDialogState.patientId} ·{' '}
                  {cancelType ? (cancelType.nameTh ?? cancelType.name) : cancelDialogState.typeCode}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">เหตุผลการยกเลิก</label>
            <Textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="ระบุเหตุผลการยกเลิกนัด"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeCancelDialog} disabled={cancelSubmitting}>
              ปิด
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmCancel}
              disabled={cancelSubmitting || !cancelReason.trim()}
            >
              {cancelSubmitting ? 'กำลังยกเลิก...' : 'ยืนยันการยกเลิก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
