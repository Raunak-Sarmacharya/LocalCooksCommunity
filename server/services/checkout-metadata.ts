import { addHour, getHourlySlotStarts } from "@shared/operating-hours";

export type CheckoutSlot = { startTime: string; endTime: string };

export function expandHourlySlots(startTime: string, endTime: string): CheckoutSlot[] {
  return getHourlySlotStarts(startTime, endTime).map((slotStart) => ({
    startTime: slotStart,
    endTime: addHour(slotStart),
  }));
}

export function serializeCheckoutSlots(
  slots: CheckoutSlot[] | undefined,
  startTime: string,
  endTime: string,
  pricingMode?: "hourly" | "daily",
): string | undefined {
  if (!slots?.length) return undefined;

  const contiguous = slots[0].startTime === startTime
    && slots.at(-1)?.endTime === endTime
    && slots.every((slot, index) => index === 0 || slots[index - 1].endTime === slot.startTime);
  if (pricingMode === "daily" && contiguous) return undefined;

  // Stripe metadata is limited to 500 characters; one-hour starts fit even a full day.
  const serialized = slots.map(slot => slot.startTime).join(',');
  if (serialized.length > 500) {
    throw new Error("Selected time slots exceed Stripe's 500-character metadata limit");
  }
  return serialized;
}

export function parseCheckoutSlots(
  serialized: string | null | undefined,
  startTime: string,
  endTime: string,
): CheckoutSlot[] {
  if (!serialized) return expandHourlySlots(startTime, endTime);
  // Existing open Checkout Sessions contain JSON; keep them fulfillable.
  if (serialized.startsWith('[')) return JSON.parse(serialized);
  return serialized.split(',').map(slotStart => ({ startTime: slotStart, endTime: addHour(slotStart) }));
}
