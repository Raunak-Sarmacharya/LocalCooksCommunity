import { eq } from "drizzle-orm";
import { db } from "../db";
import { kitchenViewingBlackouts, type KitchenDateOverride } from "@shared/schema";
import { tourBlackoutForDate } from "@shared/tour-schedule";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function sameBookingException(a: KitchenDateOverride, b: KitchenDateOverride): boolean {
  return a.specificDate.toISOString().slice(0, 10) === b.specificDate.toISOString().slice(0, 10)
    && a.isAvailable === b.isAvailable && a.startTime === b.startTime && a.endTime === b.endTime
    && a.reason === b.reason;
}

/** Keep manually broader blackouts; only exact full-day copies can be removed. */
export async function syncTourClosure(
  tx: Transaction,
  kitchenId: number,
  date: string,
  timezone: string,
  previousReason: string | null | undefined,
  nextReason: string | null | undefined,
) {
  if (previousReason === nextReason) return;
  const blackouts = await tx.select().from(kitchenViewingBlackouts)
    .where(eq(kitchenViewingBlackouts.kitchenId, kitchenId));
  if (previousReason !== undefined) {
    const previous = tourBlackoutForDate(date, timezone, previousReason);
    const matching = blackouts.find((item) => item.startDate.getTime() === previous.startDate.getTime()
      && item.endDate.getTime() === previous.endDate.getTime() && item.reason === previous.reason);
    if (matching) await tx.delete(kitchenViewingBlackouts).where(eq(kitchenViewingBlackouts.id, matching.id));
  }
  if (nextReason !== undefined) {
    const next = tourBlackoutForDate(date, timezone, nextReason);
    const covered = blackouts.some((item) => item.startDate <= next.startDate && item.endDate >= next.endDate
      && !(previousReason !== undefined && item.startDate.getTime() === next.startDate.getTime()
        && item.endDate.getTime() === next.endDate.getTime() && item.reason === previousReason));
    if (!covered) await tx.insert(kitchenViewingBlackouts).values({ kitchenId, ...next });
  }
}
