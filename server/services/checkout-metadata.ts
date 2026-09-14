export type CheckoutSlot = { startTime: string; endTime: string };

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

const toTime = (minutes: number) =>
  `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;

export function expandHourlySlots(startTime: string, endTime: string): CheckoutSlot[] {
  const slots: CheckoutSlot[] = [];
  for (let minutes = toMinutes(startTime); minutes < toMinutes(endTime); minutes += 60) {
    slots.push({ startTime: toTime(minutes), endTime: toTime(minutes + 60) });
  }
  return slots;
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

  const serialized = JSON.stringify(slots);
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
  return serialized ? JSON.parse(serialized) : expandHourlySlots(startTime, endTime);
}
