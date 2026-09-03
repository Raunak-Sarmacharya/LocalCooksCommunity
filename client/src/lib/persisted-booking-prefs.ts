import { useCallback, useEffect, useRef, useState } from "react";
import i18n from "@/i18n";
import {
  estimateKitchenBookingPrice,
  type BookingPriceEstimate,
} from "@/lib/booking-price-estimate";
import { formatHourSlotRange } from "@/lib/formatters";

export type PersistedBookingPricePreview = {
  kitchenId: string;
  dateLabel: string;
  slotsLabel: string;
  dateIso: string;
  slots: string[];
  hourlyRateCents: number;
  currency: string;
  estimate: BookingPriceEstimate;
};

function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function readStoredDate(kitchenId: string): Date | undefined {
  try {
    const raw = sessionStorage.getItem(`kitchen_dates_${kitchenId}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    const from = parsed.from ? new Date(parsed.from) : undefined;
    if (!from || Number.isNaN(from.getTime())) return undefined;
    from.setHours(0, 0, 0, 0);
    return from;
  } catch {
    return undefined;
  }
}

function readStoredSlots(kitchenId: string): string[] {
  try {
    const raw = sessionStorage.getItem(`kitchen_booking_prefs_${kitchenId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.slots) ? parsed.slots.map(String) : [];
  } catch {
    return [];
  }
}

/** Dispatched by prefs panel when selection/estimate changes. */
export const BOOKING_PREFS_CHANGED_EVENT = "kitchen-booking-prefs-changed";

export function notifyBookingPrefsChanged(kitchenId: string) {
  try {
    window.dispatchEvent(
      new CustomEvent(BOOKING_PREFS_CHANGED_EVENT, { detail: { kitchenId } })
    );
  } catch {
    /* ignore */
  }
}

export async function loadPersistedBookingPricePreview(
  kitchenId: string
): Promise<PersistedBookingPricePreview | null> {
  const date = readStoredDate(kitchenId);
  const slots = readStoredSlots(kitchenId);
  if (!date || slots.length === 0) return null;

  const response = await fetch(`/api/public/kitchens/${kitchenId}/booking-estimate`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = await response.json();
  const hourlyRate = typeof data.hourlyRate === "number" ? data.hourlyRate : null;
  if (!hourlyRate || hourlyRate <= 0) return null;

  const estimate = estimateKitchenBookingPrice({
    hourlyRateCents: hourlyRate,
    hours: slots.length,
    minimumBookingHours: Math.max(1, Number(data.minimumBookingHours) || 1),
    taxRatePercent: Math.max(0, Number(data.taxRatePercent) || 0),
    platformCommissionRate: Math.max(0, Number(data.platformCommissionRate) || 0),
  });

  const locale = i18n.language;
  const dateLabel = date.toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const slotTimes = slots.map((s) => formatHourSlotRange(s, locale)).join(", ");
  const slotsLabel = String(
    i18n.t("bookingSlotsSummary", {
      ns: "kitchen",
      count: slots.length,
      times: slotTimes,
      defaultValue: `${slots.length} hour${slots.length > 1 ? "s" : ""} · ${slotTimes}`,
    })
  );

  return {
    kitchenId,
    dateLabel,
    slotsLabel,
    dateIso: toLocalDateString(date),
    slots,
    hourlyRateCents: hourlyRate,
    currency: data.currency || "CAD",
    estimate,
  };
}

/** Live price preview from sessionStorage selection for a kitchen. */
export function usePersistedBookingPricePreview(kitchenId: string | undefined) {
  const [preview, setPreview] = useState<PersistedBookingPricePreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!kitchenId) {
      requestIdRef.current += 1;
      setPreview(null);
      setIsLoading(false);
      return;
    }
    // No selection yet — keep placeholder, don't flash a loader.
    if (!readStoredDate(kitchenId) || readStoredSlots(kitchenId).length === 0) {
      requestIdRef.current += 1;
      setPreview(null);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const next = await loadPersistedBookingPricePreview(kitchenId);
      if (requestId !== requestIdRef.current) return;
      setPreview(next);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setPreview(null);
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [kitchenId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!kitchenId) return;
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.kitchenId && String(detail.kitchenId) !== String(kitchenId)) return;
      void refresh();
    };
    window.addEventListener(BOOKING_PREFS_CHANGED_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(BOOKING_PREFS_CHANGED_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [kitchenId, refresh]);

  return { preview, isLoading };
}

/** Find first kitchen at a location with a persisted date (slots optional) for book prefill. */
export function findPersistedBookingForKitchens(
  kitchenIds: Array<string | number>
): { kitchenId: string; dateIso: string; slots: string[] } | null {
  for (const id of kitchenIds) {
    const kitchenId = String(id);
    const date = readStoredDate(kitchenId);
    if (!date) continue;
    return { kitchenId, dateIso: toLocalDateString(date), slots: readStoredSlots(kitchenId) };
  }
  return null;
}
