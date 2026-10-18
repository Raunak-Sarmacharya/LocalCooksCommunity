/**
 * CP10: the frozen day set of a multi-day kitchen invitation and its discounted kitchen allocation.
 *
 * The kitchen offers one discounted **booking** kitchen subtotal, never a per-day price. The discount is spread over
 * the per-day listed kitchen subtotals with the shared largest-remainder allocator (stable date order breaks ties), so
 * every day's share is exact and the sum equals the offer. Equipment is never discounted: the kitchen's own equipment
 * choices and anything the chef adds are charged at their listed price, per day.
 */
import { allocateCents } from '@shared/cancellation-policy';
import type { ValidatedBookingDay } from './booking-days-validation';
import { priceBookingDays, type PricedBookingDay } from './dated-booking-quote';

export type InvitationEquipment = { listingId: number; name: string; cents: number };

export type InvitationDaySnapshot = {
  date: string;
  pricingMode: 'hourly' | 'daily';
  slots: Array<{ startTime: string; endTime: string }>;
  windowStartTime: string;
  startTime: string;
  endTime: string;
  equipment: InvitationEquipment[];
  /** The day's listed kitchen subtotal (rate x hours, or the daily rate). */
  listKitchenCents: number;
  /** This day's share of the single discounted booking subtotal. */
  offeredKitchenCents: number;
};

export type InvitationDaysPricing = {
  days: InvitationDaySnapshot[];
  listKitchenCents: number;
  offeredKitchenCents: number;
  listEquipmentCents: number;
  listSubtotalCents: number;
  offeredSubtotalCents: number;
};

/** Every day's exact share of the one offered booking subtotal; date order (index) is the stable tie-break. */
export function allocateInvitationKitchenCents(listCents: number[], offeredTotal: number) {
  if (!Number.isSafeInteger(offeredTotal) || offeredTotal < 0) throw Error('The offered kitchen subtotal is invalid.');
  if (listCents.some(cents => !Number.isSafeInteger(cents) || cents < 0)) throw Error('A listed day subtotal is invalid.');
  return allocateCents(offeredTotal, listCents);
}

/**
 * Price validated days at their listed rates and split the offered booking subtotal across them.
 * `offeredKitchenCents` is already floor-checked against the listed total by the caller.
 */
export function priceInvitationDays(days: ValidatedBookingDay[],
  rates: { hourlyRate: number; dailyRate: number },
  listings: Array<{ id: number; equipmentType: string; availabilityType: string | null; sessionRate: string | null }>,
  offeredKitchenCents: number): InvitationDaysPricing {
  const priced: PricedBookingDay[] = priceBookingDays(days, rates, listings);
  const listCents = priced.map(day => day.kitchenCents);
  const offered = allocateInvitationKitchenCents(listCents, offeredKitchenCents);
  const snapshot: InvitationDaySnapshot[] = priced.map((day, index) => ({
    date: day.date, pricingMode: day.pricingMode, slots: day.slots, windowStartTime: day.windowStartTime,
    startTime: day.startTime, endTime: day.endTime, equipment: day.equipment,
    listKitchenCents: day.kitchenCents, offeredKitchenCents: offered[index],
  }));
  const listKitchenCents = listCents.reduce((sum, cents) => sum + cents, 0);
  const listEquipmentCents = priced.reduce((sum, day) => sum + day.equipment.reduce((s, item) => s + item.cents, 0), 0);
  const offeredTotal = offered.reduce((sum, cents) => sum + cents, 0);
  if (offeredTotal !== offeredKitchenCents || listKitchenCents !== listCents.reduce((sum, cents) => sum + cents, 0))
    throw Error('The invitation day allocation does not conserve the offered subtotal.');
  return { days: snapshot, listKitchenCents, offeredKitchenCents: offeredTotal, listEquipmentCents,
    listSubtotalCents: listKitchenCents + listEquipmentCents, offeredSubtotalCents: offeredTotal + listEquipmentCents };
}

/** Snapshot rows, in date order, with the same field names the DTO and checkout read. */
export function readInvitationDays(value: unknown): InvitationDaySnapshot[] | null {
  if (value == null) return null;
  if (!Array.isArray(value) || !value.length) throw Error('The saved invitation days are incomplete.');
  return value as InvitationDaySnapshot[];
}

/** What the chef may change at checkout: each day's equipment. Dates, hours and modes are frozen by the kitchen. */
export function invitationCheckoutDays(days: InvitationDaySnapshot[], equipment: unknown) {
  const overrides = new Map<string, number[]>();
  if (equipment !== undefined && equipment !== null) {
    if (!Array.isArray(equipment) || equipment.length > 14) throw Error('Choose equipment for each invited day.');
    for (const entry of equipment as Array<{ date?: unknown; equipmentIds?: unknown }>) {
      const date = typeof entry?.date === 'string' ? entry.date : '';
      if (!days.some(day => day.date === date) || overrides.has(date)) throw Error('Choose equipment for each invited day.');
      if (!Array.isArray(entry.equipmentIds) || entry.equipmentIds.length > 10
        || entry.equipmentIds.some(id => !Number.isSafeInteger(id))) throw Error('Choose equipment from this kitchen.');
      overrides.set(date, Array.from(new Set(entry.equipmentIds as number[])));
    }
  }
  return days.map(day => ({ date: day.date, pricingMode: day.pricingMode, slots: day.slots,
    equipmentIds: overrides.get(day.date) ?? day.equipment.map(item => item.listingId) }));
}

/** The manifest's proof of the offer: one booking subtotal, its listed weights and the exact per-day shares. */
export function invitationQuoteBlock(days: InvitationDaySnapshot[], id: string, version: number) {
  return {
    id, version,
    listKitchenCents: days.reduce((sum, day) => sum + day.listKitchenCents, 0),
    offeredKitchenCents: days.reduce((sum, day) => sum + day.offeredKitchenCents, 0),
    days: days.map(day => ({ date: day.date, listKitchenCents: day.listKitchenCents, offeredKitchenCents: day.offeredKitchenCents })),
  };
}
