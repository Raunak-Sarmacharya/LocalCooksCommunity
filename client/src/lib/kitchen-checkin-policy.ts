import { calendarDateForOperatingTime } from '@shared/operating-hours';
import { createBookingDateTime } from '@shared/timezone-utils';

export function kitchenCheckinPolicyTimes(
  operatingDate: string,
  visitStartTime: string,
  operatingWindowStartTime: string,
  timezone: string,
  checkinWindowMinutesBefore: number,
  noShowGraceMinutes: number,
) {
  const calendarDate = calendarDateForOperatingTime(operatingDate, visitStartTime, operatingWindowStartTime);
  const startsAt = createBookingDateTime(calendarDate, visitStartTime, timezone);
  return {
    startsAt,
    opensAt: new Date(startsAt.getTime() - checkinWindowMinutesBefore * 60_000),
    noShowAfter: new Date(startsAt.getTime() + noShowGraceMinutes * 60_000),
  };
}
