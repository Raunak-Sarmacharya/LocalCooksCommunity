import type { ChatContextItem } from "@/services/chat-service";
import { formatTime } from "@/lib/formatters";

type T = (key: string, options?: Record<string, unknown>) => string;
const TZ = "America/St_Johns";

const day = (value: string | Date, locale: string, timeZone = TZ) =>
  new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone }).format(new Date(value));
// Calendar dates ("2026-11-16") are already local: read them at noon UTC so no timezone shifts the day.
const calendarDay = (date: string, locale: string) => day(`${date}T12:00:00Z`, locale, "UTC");

/** "Mon, Nov 16 · 6:00–9:00 a.m.", "Thu, Oct 29 · 2:00 p.m.", "Oct 29 – Nov 4". */
export function itemWhen(item: ChatContextItem, locale: string, timeZone = TZ): string {
  if (item.kind === "booking" && item.date)
    return `${calendarDay(item.date, locale)} · ${formatTime(item.startTime ?? "", locale)}–${formatTime(item.endTime ?? "", locale)}`;
  if (item.kind === "tour" && item.at)
    return `${day(item.at, locale, timeZone)} · ${new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(item.at))}`;
  if (item.kind === "storage" && item.from) {
    const short = (date: string) => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
    return item.to ? `${short(item.from)} – ${short(item.to)}` : short(item.from);
  }
  return "";
}

/** Inbox tag: "Booking · Mon, Nov 16", "Tour · Thu, Oct 29", "Storage · until Nov 4". */
export function itemTag(item: ChatContextItem, t: T, locale: string): string {
  if (item.kind === "storage")
    return item.to ? t("chatTagStorageUntil", { date: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${item.to}T12:00:00Z`)) }) : t("chatKind_storage");
  const when = item.kind === "booking" && item.date ? calendarDay(item.date, locale) : item.at ? day(item.at, locale) : "";
  return [t(`chatKind_${item.kind}`), when].filter(Boolean).join(" · ");
}

/** Status chip text and tone, shared by both sides. */
export function itemStatus(item: ChatContextItem, t: T): { label: string; tone: "ok" | "wait" | "muted" } {
  const tone = ["confirmed", "reserved", "active"].includes(item.status) ? "ok"
    : ["pending", "requested", "cancellation_requested", "move_out_requested", "removal_review"].includes(item.status) ? "wait" : "muted";
  return { label: t(`chatStatus_${item.kind === "storage" ? "storage_" : ""}${item.status}`), tone };
}
