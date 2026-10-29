import { localToday } from "@shared/storage-rental"
/** Client calls for standalone storage rentals (WP-ST4/ST5). Server errors arrive translated; they are shown as-is. */
import { getAuthHeaders } from "@/lib/api"
import { completeCardAction } from "@/lib/session-extensions"
import { friendlyTimezoneName } from "@shared/timezone-utils"

export type StorageAvailability = { listingId: number; name: string; storageType: string; dailyPriceCents: number; maxTermDays: number
  availability: { state: "now" | "full" | "from"; from?: string }; kitchenName?: string; locationId?: number; timezone?: string
  /** Listing details (owner §7 item 11); any may be missing on older listings, so each is shown only when present. */
  unitCount?: number; sizeLabel?: string | null; accessType?: string | null; temperatureRange?: string | null; notes?: string | null; photos?: string[] }
export type StorageQuote = { listingId: number; startOn: string; days: number; endOn: string; dailyPriceCents: number; subtotalCents: number
  taxCents: number; serviceFeeCents: number; totalCents: number; maxTermDays: number; taxRatePercent: number; quotedAt: string
  acceptedTermsVersion: string; disclosureVersion: string; cancellationPolicy: { version: number; noticeHours: number; lateChargePercent: number } }
export type RentalTerm = { id: number; seq: number; kind: string; startsOn: string; endsOn: string; days: number; dailyPriceCents: number
  subtotalCents: number; taxCents: number; serviceFeeCents: number; totalCents: number; status: string; paidAt: string | null
  /** Already refunded on this payment (a kitchen take-back or a kitchen refund). */ refundedCents?: number }
/** Only these are wired on the chef side; any other server action is ignored, never guessed. */
export type RentalAction = "withdraw" | "cancel" | "extend" | "move_in" | "move_out" | "report_problem"
export type StorageRental = { id: number; ref: string | null; kitchen: { id: number; name: string }; listing: { id: number; name: string; photos?: string[]; storageType?: string }
  timezone?: string | null; releasedOn?: string | null;
  unitLabel: string; state: "requested" | "declined" | "expired" | "withdrawn" | "reserved" | "active" | "move_out_requested" | "removal_review" | "ended"
  phase: "current" | "ending_soon" | "grace" | "holdover" | null; startOn: string; paidThrough: string; graceEndsOn: string; holdoverDays: number
  /** The kitchen asked for the unit back by this day (last day the chef keeps it). */ moveOutBy?: string | null
  accruedCents: number; responseDeadline: string | null; declineReason: string | null; actions: string[]; terms: RentalTerm[]
  /** The chef cancelled before the start; `kitchenPayoutCents` is on the kitchen's copy only. */
  cancellation?: { cancelledAt: string; refundCents: number; reason: string | null; kitchenPayoutCents?: number } | null
  rentalTerms: { dailyPriceCents: number; maxTermDays: number; graceDays: number; cancellationPolicySnapshot?: { timezone?: string; noticeHours?: number } } | null
  timeline?: { movedInAt: string | null; movingOutAt: string | null }
  /** What the chef recorded at move-in and move-out (owner Oct 29). */
  evidence?: { checkinPhotoUrls: string[] | null; checkoutPhotoUrls: string[] | null; moveIn?: import("./storage-board").StorageVisitRecord; moveOut?: import("./storage-board").StorageVisitRecord } }
/** The server's exact refund for cancelling now, under the frozen policy (same plan the refund reservation uses). */
export type CancellationQuote = { paidCents: number; alreadyRefundedCents: number; refundCents: number; cardFeeCents: number; lateChargeCents: number
  startsAt: string; freeUntil: string; lateChargePercent: number; timezone: string | null }
export type ExtensionQuote = { days: number; dailyPriceCents: number; subtotalCents: number; taxCents: number; serviceFeeCents: number; totalCents: number
  maxDays: number; limitReason: "max_term" | "reservation" | "reclaim" | "window" | "not_extendable"; newPaidThrough: string
  card: { brand: string; last4: string } | null }
export type ExtensionResult = { paid?: boolean; rental?: StorageRental; requiresAction?: boolean; clientSecret?: string; termId?: number
  cardFailed?: boolean; checkoutUrl?: string }

async function call<T>(url: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: await getAuthHeaders(), credentials: "include", ...(body ? { body: JSON.stringify(body) } : {}) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(typeof result?.error === "string" ? result.error : "Something went wrong. Nothing was charged."), { code: result?.code, refusal: result?.refusal, fitsDays: result?.fitsDays })
  return result as T
}
const base = "/api/chef/storage-rentals"
export const storageAvailability = (kitchenId: number) => call<StorageAvailability[]>(`/api/chef/kitchens/${kitchenId}/storage-availability`)
export const listRentals = () => call<StorageRental[]>(base)
export const readRental = (id: number) => call<StorageRental>(`${base}/${id}`)
export const withdrawRental = (id: number) => call<StorageRental>(`${base}/${id}/withdraw`, "POST", {})
export const previewCancellation = (id: number) => call<CancellationQuote>(`${base}/${id}/cancel/preview`)
export const cancelRental = (id: number, body: { operationKey: string; reason?: string; expectedRefundCents: number }) =>
  call<StorageRental & { refundPending?: boolean }>(`${base}/${id}/cancel`, "POST", body)
export const quoteRental = (body: { listingId: number; startOn: string; days: number }) => call<StorageQuote>(`${base}/quote`, "POST", body)
export const quoteExtension = (id: number, days: number) => call<ExtensionQuote>(`${base}/${id}/extend/quote`, "POST", { days })

/**
 * Re-quotes right before paying (the server accepts a quote at most 60 s old), so a chef who read the terms for minutes
 * never sees "quote expired". A changed total stops here and is shown; it is never charged silently.
 */
export async function requestRental(input: { listingId: number; startOn: string; days: number; requestKey: string; acceptedTotalCents: number }) {
  const fresh = await quoteRental({ listingId: input.listingId, startOn: input.startOn, days: input.days })
  if (fresh.totalCents !== input.acceptedTotalCents) return { priceChanged: fresh }
  const { checkoutUrl } = await call<{ checkoutUrl: string }>(base, "POST", { listingId: input.listingId, startOn: input.startOn, days: input.days,
    requestKey: input.requestKey, expectedTotalCents: fresh.totalCents, acceptedTermsVersion: fresh.acceptedTermsVersion,
    cancellationPolicyVersion: fresh.cancellationPolicy.version, disclosureVersion: fresh.disclosureVersion, quotedAt: fresh.quotedAt })
  return { checkoutUrl }
}

/** Pays an extension; finishes card authentication (3DS) when the bank asks, then returns the verified server result. */
export async function payExtension(id: number, body: { days: number; expectedTotalCents: number; requestKey: string; useSavedCard: boolean }) {
  const result = await call<ExtensionResult>(`${base}/${id}/extend`, "POST", body)
  if (!result.requiresAction || !result.clientSecret || !result.termId) return result
  const sync = () => call<ExtensionResult>(`${base}/${id}/extend/${result.termId}/sync`, "POST", {})
  try { await completeCardAction(result.clientSecret) }
  catch (error) {
    const synced = await sync()
    if (synced.cardFailed || synced.paid) return synced
    throw error
  }
  return sync()
}

/** A kitchen-local calendar day ("2026-10-20") as "Tue, Oct 20" in the reader's language, never shifted by their timezone. */
export const storageDay = (day: string, locale: string, withYear = false) =>
  new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))
export const cad = (cents: number, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "CAD" }).format(cents / 100)
export const can = (rental: Pick<StorageRental, "actions"> & Partial<Pick<StorageRental, "state">>, action: RentalAction) => rental.actions.includes(action) && (action !== "extend" || rental.state !== "removal_review")
/** A moment (the kitchen's answer-by time) in the kitchen's own clock and zone. */
export const kitchenMoment = (at: string, timezone: string, locale: string) => {
  let moment = new Date(at)
  // A deadline at the kitchen's midnight reads as the end of the day before ("Wed, 11:59 p.m."), not "Thu, 12:00 a.m.".
  if (new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(moment) === "00:00") moment = new Date(moment.getTime() - 60_000)
  return `${new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(moment)} (${friendlyTimezoneName(timezone, locale)})`
}
export const rentalTimezone = (rental: StorageRental) => rental.timezone || rental.rentalTerms?.cancellationPolicySnapshot?.timezone || "America/St_Johns"
export const CURRENT_STATES: StorageRental["state"][] = ["requested", "reserved", "active", "move_out_requested", "removal_review"]

type T = (key: string, options?: Record<string, unknown>) => string
/** One pill + one plain sentence (≤ 20 words) per rental, from the server's state and phase only. */
export function rentalStatus(rental: StorageRental, t: T, locale: string, now = new Date()): { pill: string; tone: "neutral" | "good" | "warn" | "bad" | "muted"; sentence: string } {
  const kitchen = rental.kitchen.name, first = rental.terms[0]
  const today = localToday(now, rentalTimezone(rental))
  const end = storageDay(rental.paidThrough, locale), start = storageDay(rental.startOn, locale)
  if (rental.state === "requested" && rental.responseDeadline && Date.parse(rental.responseDeadline) <= now.getTime())
    return { pill: t("stcPillRequested"), tone: "neutral", sentence: t("stcStatusRequestedElapsed") }
  if (rental.state === "requested") return { pill: t("stcPillRequested"), tone: "neutral", sentence: rental.responseDeadline
    ? t("stcStatusRequested", { kitchen, deadline: kitchenMoment(rental.responseDeadline, rentalTimezone(rental), locale), amount: cad(first?.totalCents ?? 0, locale) })
    : t("stcStatusRequestedSoon", { kitchen, amount: cad(first?.totalCents ?? 0, locale) }) }
  // The kitchen took the unit back before the paid end: unused days are refunded, and it can’t be extended.
  if (rental.moveOutBy && rental.moveOutBy < rental.paidThrough && (rental.state === "reserved" || rental.state === "active")) {
    const by = storageDay(rental.moveOutBy, locale)
    if (rental.state === "reserved") return { pill: t("stcPillReclaimed"), tone: "muted", sentence: t("stcStatusReclaimReserved", { kitchen, unit: rental.unitLabel, date: by }) }
    return today <= rental.moveOutBy ? { pill: t("stcPillMoveOutBy", { date: by }), tone: "warn", sentence: t("stcStatusReclaimActive", { kitchen, unit: rental.unitLabel, date: by }) }
      : { pill: t("stcPillHoldover"), tone: "bad", sentence: t("stcStatusReclaimLate", { kitchen, unit: rental.unitLabel, date: by }) }
  }
  if (rental.state === "reserved") return { pill: t("stcPillReserved"), tone: "good", sentence: rental.startOn > today ? t("stcStatusReserved", { unit: rental.unitLabel, start })
    : rental.paidThrough >= today ? t("stcStatusReservedReady", { unit: rental.unitLabel, end }) : t("stcStatusReservedPast", { unit: rental.unitLabel, end }) }
  if (rental.state === "move_out_requested") return { pill: t("stcPillMoveOut"), tone: "neutral", sentence: t("stcStatusMoveOut", { kitchen }) }
  if (rental.state === "removal_review") return { pill: t("stcPillRemoval"), tone: "bad", sentence: t("stcStatusRemoval") }
  if (rental.state === "active") {
    if (rental.phase === "holdover") return { pill: t("stcPillHoldover"), tone: "bad", sentence: t("stcStatusHoldover", { count: rental.holdoverDays, kitchen, amount: cad(rental.accruedCents, locale) }) }
    if (rental.phase === "grace") return { pill: t("stcPillGrace"), tone: "warn", sentence: t(today > rental.graceEndsOn ? "stcStatusGraceEnded" : "stcStatusGrace", { end, grace: storageDay(rental.graceEndsOn, locale) }) }
    if (rental.phase === "ending_soon" && rental.paidThrough >= today) return { pill: t("stcPillEndingSoon"), tone: "warn", sentence: t("stcStatusEndingSoon", { end }) }
    return { pill: t("stcPillActive"), tone: "good", sentence: t("stcStatusActive", { end }) }
  }
  if (rental.state === "ended" && rental.cancellation) return { pill: t("stcPillCancelled"), tone: "muted",
    sentence: t("stcStatusCancelled", { date: storageDay(localToday(new Date(rental.cancellation.cancelledAt), rentalTimezone(rental)), locale) }) }
  if (rental.state === "ended") return { pill: t("stcPillEnded"), tone: "muted", sentence: t("stcStatusEnded", { end: storageDay(rental.releasedOn || rental.paidThrough, locale) }) }
  if (rental.state === "declined") return { pill: t("stcPillDeclined"), tone: "muted", sentence: t("stcStatusDeclined") }
  if (rental.state === "expired") return { pill: t("stcPillExpired"), tone: "muted", sentence: t("stcStatusExpired", { kitchen }) }
  return { pill: t("stcPillWithdrawn"), tone: "muted", sentence: t("stcStatusWithdrawn") }
}
export const TONE_CLASS = { neutral: "bg-slate-100 text-slate-800", good: "bg-emerald-50 text-emerald-800", warn: "bg-amber-50 text-amber-900",
  bad: "bg-red-50 text-red-800", muted: "bg-muted text-muted-foreground" } as const
