import { describe, expect, it } from 'vitest';
import {
  effectiveMaxBookingDays,
  validateBookingDaysContract,
  type BookingDayInput,
} from './booking-days-contract';

const day = (date: string, pricingMode: 'hourly' | 'daily' = 'hourly'): BookingDayInput => ({
  date,
  pricingMode,
  slots: [],
  equipmentIds: [],
});

describe('validateBookingDaysContract', () => {
  it('accepts a single-day legacy-shaped payload when multi-day creation is off', () => {
    const result = validateBookingDaysContract([day('2026-10-20')], {
      maxBookingDays: 7,
      multidayCreationEnabled: false,
      timezone: 'America/St_Johns',
    });
    expect(result).toMatchObject({ ok: true, dayCount: 1, firstDate: '2026-10-20', lastDate: '2026-10-20' });
  });

  it('rejects multi-day payloads while the platform rollout gate is off', () => {
    const result = validateBookingDaysContract([day('2026-10-20'), day('2026-10-22')], {
      maxBookingDays: 7,
      multidayCreationEnabled: false,
    });
    expect(result).toMatchObject({ ok: false, code: 'MULTIDAY_DISABLED' });
  });

  it('rejects duplicates and impossible calendar dates', () => {
    expect(validateBookingDaysContract([day('2026-10-20'), day('2026-10-20')], {
      maxBookingDays: 7, multidayCreationEnabled: true,
    })).toMatchObject({ ok: false, code: 'DUPLICATE_DATE' });
    expect(validateBookingDaysContract([day('2026-02-30')], {
      maxBookingDays: 7, multidayCreationEnabled: true,
    })).toMatchObject({ ok: false, code: 'INVALID_DATE' });
    expect(validateBookingDaysContract([day('not-a-date')], {
      maxBookingDays: 7, multidayCreationEnabled: true,
    })).toMatchObject({ ok: false, code: 'INVALID_DATE' });
  });

  it('enforces N = 1 when multi-day is Off, and allows up to effective max when On', () => {
    expect(validateBookingDaysContract([day('2026-10-20'), day('2026-10-21')], {
      maxBookingDays: 1, multidayCreationEnabled: true,
    })).toMatchObject({ ok: false, code: 'TOO_MANY_DAYS' });

    const seven = Array.from({ length: 7 }, (_, i) => day(`2026-10-${String(20 + i).padStart(2, '0')}`));
    expect(validateBookingDaysContract(seven, {
      maxBookingDays: 7, multidayCreationEnabled: true,
    })).toMatchObject({ ok: true, dayCount: 7 });

    const fourteen = Array.from({ length: 14 }, (_, i) => day(`2026-10-${String(1 + i).padStart(2, '0')}`));
    expect(validateBookingDaysContract(fourteen, {
      maxBookingDays: 14, multidayCreationEnabled: true,
    })).toMatchObject({ ok: true, dayCount: 14 });

    expect(validateBookingDaysContract([...fourteen, day('2026-10-15')], {
      maxBookingDays: 14, multidayCreationEnabled: true,
    })).toMatchObject({ ok: false, code: 'TOO_MANY_DAYS' });
  });

  it('allows span of exactly 14 calendar days and refuses 15 (DST-safe)', () => {
    // America/St_Johns DST transition around early November — calendar dates still UTC-safe.
    expect(validateBookingDaysContract([day('2026-10-20'), day('2026-11-03')], {
      maxBookingDays: 7, multidayCreationEnabled: true, timezone: 'America/St_Johns',
    })).toMatchObject({ ok: true, firstDate: '2026-10-20', lastDate: '2026-11-03' });

    expect(validateBookingDaysContract([day('2026-10-20'), day('2026-11-04')], {
      maxBookingDays: 7, multidayCreationEnabled: true, timezone: 'America/St_Johns',
    })).toMatchObject({ ok: false, code: 'SPAN_TOO_LONG' });
  });

  it('sorts selected dates and keeps nonconsecutive sets', () => {
    const result = validateBookingDaysContract(
      [day('2026-10-24', 'daily'), day('2026-10-20'), day('2026-10-22')],
      { maxBookingDays: 7, multidayCreationEnabled: true },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.days.map((d) => d.date)).toEqual(['2026-10-20', '2026-10-22', '2026-10-24']);
    }
  });
});

describe('effectiveMaxBookingDays', () => {
  it('returns 1 when multi-day is Off and preserves configured N when On', () => {
    expect(effectiveMaxBookingDays({ allowMultiDayBookings: false, maxBookingDays: 7 })).toBe(1);
    expect(effectiveMaxBookingDays({ allowMultiDayBookings: true, maxBookingDays: 7 })).toBe(7);
    expect(effectiveMaxBookingDays({ allowMultiDayBookings: true, maxBookingDays: 20 })).toBe(14);
  });
});
