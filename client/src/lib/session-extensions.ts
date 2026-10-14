/** Client calls for session extensions + extra-time charges. Every decision is a POST; server messages are shown as-is. */
import { getAuthHeaders } from "@/lib/api"
import { friendlyTimezoneName } from "@shared/timezone-utils"

export type ExtensionOption = { minutes: number; endTime: string; endAt: string; amountCents: number; kitchenGrossCents: number }
/** For "early_start", originalEndAt/endAt are the original and new START. */
export type ExtensionItem = { id: number; kind: "request" | "offer" | "extra_time" | "early_start"; minutes: number; amountCents: number; free: boolean; kitchenGrossCents: number | null
  actualMinutes: number | null; maximumAmountCents: number | null
  status: "requested" | "offered" | "approved" | "declined" | "expired" | "paid" | "cancelled" | "disputed"
  authorized: boolean; paid: boolean; confirmed: boolean; originalEndAt: string; endAt: string; expiresAt: string; note: string | null
  autoApprove: boolean; createdAt: string; processing: boolean; escalated: boolean }
export type EarlyOption = { minutes: number; startTime: string; startAt: string; defaultFree: boolean; billedMinutes: number; amountCents: number; kitchenGrossCents: number; startNow?: boolean }
export type ExtensionState = { enabled: boolean; autoApprove: boolean; timezone: string; kitchenName: string; currency: string
  options: ExtensionOption[]; earlyOptions?: EarlyOption[]; startAt?: string | null; beforeStart?: boolean; extraTime: { actualMinutes: number; minutes: number; maximumAmountCents: number; amountCents: number; kitchenGrossCents: number } | null
  visitId: number | null; endAt: string | null; checkoutAt: string | null; inSession: boolean; canRequest: boolean; hasSavedCard: boolean
  unavailableReason: string | null; noTimeFree: boolean; history: ExtensionItem[]; serverNow: string }
export type ExtensionResult = { extension: ExtensionItem; requiresAction?: boolean; clientSecret?: string }

async function call<T>(url: string, method: "GET" | "POST", body?: unknown, fallback = "Something went wrong. Nothing new was charged."): Promise<T> {
  const response = await fetch(url, { method, headers: await getAuthHeaders(), credentials: "include", ...(body ? { body: JSON.stringify(body) } : {}) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : fallback)
  return result as T
}
export const readExtensions = (bookingId: number) => call<ExtensionState>(`/api/bookings/${bookingId}/extensions`, "GET")
export const createExtension = (bookingId: number, body: Record<string, unknown>) => call<ExtensionResult>(`/api/bookings/${bookingId}/extensions`, "POST", body)
export const decideExtension = (bookingId: number, id: number, body: Record<string, unknown>) =>
  call<ExtensionResult>(`/api/bookings/${bookingId}/extensions/${id}/decision`, "POST", body)
export const syncExtension = (bookingId: number, id: number) => call<ExtensionResult>(`/api/bookings/${bookingId}/extensions/${id}/sync`, "POST", {})

/** The response's `options` must be an array for the state to be usable (guards against unrelated fixtures/errors). */
export const isExtensionState = (value: unknown): value is ExtensionState =>
  !!value && typeof value === "object" && Array.isArray((value as ExtensionState).options) && Array.isArray((value as ExtensionState).history)

/** Card authentication (3DS) for an on-session payment; loaded only when the bank asks for it. */
export async function completeCardAction(clientSecret: string) {
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || import.meta.env.STRIPE_PUBLISHABLE_KEY
  if (!key) throw new Error("Card confirmation is unavailable right now. Nothing was charged.")
  const { loadStripe } = await import("@stripe/stripe-js")
  const stripe = await loadStripe(key)
  if (!stripe) throw new Error("Card confirmation is unavailable right now. Nothing was charged.")
  const { error } = await stripe.handleNextAction({ clientSecret })
  if (error) throw new Error(error.message || "Your bank didn't confirm the card. Nothing was charged.")
}
/** Runs a money action, finishing card authentication when needed, and returns the verified server state. */
export async function withCardAction(bookingId: number, run: () => Promise<ExtensionResult>) {
  const result = await run()
  if (!result.requiresAction || !result.clientSecret) return result
  await completeCardAction(result.clientSecret)
  return syncExtension(bookingId, result.extension.id)
}

export const money = (cents: number, currency: string, locale: string) =>
  new Intl.NumberFormat(locale, { style: "currency", currency: (currency || "CAD").toUpperCase() }).format(cents / 100)
/** "4:30 p.m." in the kitchen's own time. */
export const kitchenClock = (at: string, timezone: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(at))
export const kitchenClockZone = (at: string, timezone: string, locale: string) => `${kitchenClock(at, timezone, locale)} ${friendlyTimezoneName(timezone, locale)}`
export const newRequestKey = () => crypto.randomUUID()
/** Only the preselected default: up to 30 minutes starts as Free; the manager can switch either way. */
export const defaultFreeChoice = (minutes: number) => minutes <= 30
/** Shown as one-tap chips; every other free length is under "Choose a time…" (15-minute steps). */
export const QUICK_PICK_MINUTES = [30, 60, 120] as const
export const isQuickPick = (minutes: number) => (QUICK_PICK_MINUTES as readonly number[]).includes(minutes)
/** "45 min", "2 hours", "1 h 15 min" from translated pieces (keys: Min, Hours, HM under the given prefix). */
export function lengthText(minutes: number, t: (key: string, options: Record<string, unknown>) => string, prefix: string) {
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  if (!hours) return t(`${prefix}LenMin`, { minutes, defaultValue: `${minutes} min` })
  if (!rest) return t(`${prefix}LenHours`, { hours, defaultValue: `${hours} ${hours === 1 ? "hour" : "hours"}` })
  return t(`${prefix}LenHM`, { hours, minutes: rest, defaultValue: `${hours} h ${rest} min` })
}
