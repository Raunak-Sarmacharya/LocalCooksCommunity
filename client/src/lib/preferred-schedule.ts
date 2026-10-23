/**
 * The days and hours a customer would like at a kitchen, saved before they're approved. Same keys the booking flow already
 * reads to pre-fill (`kitchen_dates_<id>` { from, dates }, `kitchen_booking_prefs_<id>` { slots, pricingMode }); written to
 * session AND local storage because email verification can reopen the request in a new tab.
 */
export type PreferredSchedule = { days: string[]; pricingMode: "hourly" | "daily"; times: string[] };

const DAY = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}$/;
const read = (key: string) => { try { return JSON.parse(sessionStorage.getItem(key) || localStorage.getItem(key) || "null"); } catch { return null; } };
const write = (key: string, value: unknown) => {
  for (const store of [sessionStorage, localStorage]) {
    try { value === null ? store.removeItem(key) : store.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }
};

export function readPreferredSchedule(kitchenId: string): PreferredSchedule {
  const dates = read(`kitchen_dates_${kitchenId}`), prefs = read(`kitchen_booking_prefs_${kitchenId}`);
  const fromDay = typeof dates?.from === "string" ? dates.from.slice(0, 10) : null;
  const days = (Array.isArray(dates?.dates) ? dates.dates : fromDay ? [fromDay] : []).filter((day: unknown): day is string => typeof day === "string" && DAY.test(day));
  const times = (Array.isArray(prefs?.slots) ? prefs.slots : []).filter((time: unknown): time is string => typeof time === "string" && TIME.test(time));
  return { days: Array.from(new Set(days)).sort().slice(0, 14), pricingMode: prefs?.pricingMode === "daily" ? "daily" : "hourly", times };
}

export function writePreferredSchedule(kitchenId: string, schedule: PreferredSchedule) {
  write(`kitchen_dates_${kitchenId}`, schedule.days.length ? { from: `${schedule.days[0]}T00:00:00`, dates: schedule.days } : null);
  write(`kitchen_booking_prefs_${kitchenId}`, schedule.days.length ? { slots: schedule.times, pricingMode: schedule.pricingMode } : null);
}

/** What goes with the request (Local Cooks and the kitchen see it); null when nothing was chosen. */
export function preferredScheduleForRequest(kitchenId: string | number | null | undefined): PreferredSchedule | null {
  if (kitchenId == null || kitchenId === "") return null;
  const schedule = readPreferredSchedule(String(kitchenId));
  return schedule.days.length ? schedule : null;
}

/** "Fri, Oct 30 · Sun, Nov 1 · 9:00 a.m.–1:00 p.m." (or "Full day"); null when the value isn't a saved schedule. */
export function formatPreferredSchedule(value: unknown, locale: string, fullDayLabel: string): string | null {
  const schedule = value as Partial<PreferredSchedule> | null;
  const days = Array.isArray(schedule?.days) ? schedule.days.filter(day => typeof day === "string" && DAY.test(day)) : [];
  if (!days.length) return null;
  const dayText = days.map(day => new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00`))).join(" · ");
  const times = Array.isArray(schedule?.times) ? schedule.times.filter(time => typeof time === "string" && TIME.test(time)).sort() : [];
  const clock = (time: string) => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(new Date(`2000-01-01T${time}:00`));
  const end = (time: string) => { const [h, m] = time.split(":").map(Number); return `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`; };
  const hours = schedule?.pricingMode === "daily" ? fullDayLabel : times.length ? `${clock(times[0])}–${clock(end(times[times.length - 1]))}` : "";
  return hours ? `${dayText} · ${hours}` : dayText;
}
