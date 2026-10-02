import type { RequestHandler } from 'express';
import { publicBookingAttendanceNotes } from '@shared/booking-attendance';

export function publicBookingResponse(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(publicBookingResponse);
  const row = value as Record<string, unknown>;
  const kitchenRecord = ('bookingDate' in row && 'startTime' in row)
    || ('bookingId' in row && 'blockIndex' in row);
  const safe = kitchenRecord ? publicBookingAttendanceNotes(row) : row;
  return Object.fromEntries(Object.entries(safe).map(([key, nested]) => [key, publicBookingResponse(nested)]));
}

/** Shared responses cannot expose historical/private inspection notes. */
export const bookingAttendancePrivacy: RequestHandler = (req, res, next) => {
  const json = res.json.bind(res);
  res.json = body => json(req.neonUser?.role === 'admin' ? body : publicBookingResponse(body));
  next();
};
