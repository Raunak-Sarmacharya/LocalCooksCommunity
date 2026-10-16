/**
 * The chef's "My bookings" (design-booking-consolidation.md §0, §6, §7; Airbnb Trips): three tabs, one card per booking,
 * the whole card opens the booking page. Each card speaks the booking page's language — the same phase, pill and
 * 12-hour times — with ONE short line (the next step or the money outcome) and at most ONE action when it is the
 * obvious next step. Everything else lives on the booking page.
 */
import { useMemo, useState } from "react"
import { Link } from "wouter"
import { useTranslation } from "react-i18next"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { SmartImage } from "@/components/ui/smart-image"
import { KitchenIcon } from "@/components/ui/kitchen-icon"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StatusPill } from "@/components/booking/BookingNowCard"
import { PendingOverstayPenalties } from "../chef/PendingOverstayPenalties"
import { sentence } from "@/lib/booking-header-state"
import { bookingCancelCause } from "@/lib/booking-cancel-cause"
import { bookingResponseDeadline, formatResponseDeadline } from "@/lib/booking-response-deadline"
import {
  bookingListBounds, bookingListPill, chefBookingTabs, chefUpcomingRank, listTimezone, listWhenLine,
  type BookingListRow, type ChefListTab, type ListedBooking,
} from "@/lib/booking-list-status"
import { friendlyTimezoneName } from "@shared/timezone-utils"
import { getR2ProxyUrl } from "@/utils/r2-url-helper"
import { bt } from "@/i18n/booking-ns"
import { cn } from "@/lib/utils"

export interface ChefListBooking extends BookingListRow {
  id: number
  chefId?: number
  kitchenId: number
  referenceCode?: string | null
  createdAt?: string
  kitchenName?: string
  locationName?: string
  kitchenPhoto?: string | null
  paymentStatus?: string
  paymentDecision?: { state?: string; target?: string; actorId?: number | null } | null
  responseDeadlineAt?: string | null
  isVoidedAuthorization?: boolean
  /** Cents. */
  totalPrice?: number | null
  /** Cents, tax included: what the chef actually paid. */
  chargedAmount?: number | null
  /** Cents. */
  refundAmount?: number | null
  checkedInAt?: string | null
  chefDue?: { kind: "claim" | "extra_time"; amountCents: number } | null
}

interface ChefBookingsViewProps {
  bookings: ChefListBooking[]
  isLoading: boolean
  kitchens?: Array<{ id: number; name: string; locationName?: string }>
  /** "Find a kitchen" in the empty state. */
  onFindKitchen?: () => void
}

type T = (key: string, options?: Record<string, unknown>) => string

/** A search box only earns its place once a tab is long. */
const SEARCH_AFTER = 8

const money = (cents: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: "currency", currency: "CAD" }).format(cents / 100)

const clock = (at: Date | string, locale: string, timeZone: string) => {
  try { return new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(at)) }
  catch { return "" }
}

/** The single next-step or money line under the date (empty when nothing is worth saying). */
export function chefListLine(booking: ChefListBooking, item: ListedBooking<ChefListBooking>, t: T, locale: string): string {
  const zone = listTimezone(booking)
  const paid = booking.chargedAmount ?? booking.totalPrice ?? 0
  const refund = booking.refundAmount ?? 0
  const bounds = bookingListBounds(booking)
  switch (item.phase) {
    case "pending": {
      const deadline = bookingResponseDeadline(booking)
      const text = deadline ? formatResponseDeadline(deadline, locale, zone, false) : null
      return text ? t("blKitchenRepliesBy", { deadline: text }) : ""
    }
    case "today": return bounds ? t("blCheckinOpensAt", { time: clock(bounds.opensAt, locale, zone) }) : ""
    case "checkin_open": return t("blCheckinOpen")
    case "in_session": return bounds ? t("blInSessionUntil", { time: clock(bounds.endAt, locale, zone) }) : ""
    case "time_ended_in_session": return bounds ? sentence(t("blTimeEnded", { time: clock(bounds.endAt, locale, zone) })) : ""
    case "checkout_review": {
      const at = booking.checkoutRequestedAt || booking.visitStates?.find(visit => visit.checkoutRequestedAt)?.checkoutRequestedAt
      return at ? t("blCheckoutAt", { time: clock(at, locale, zone) }) : ""
    }
    case "cancellation_requested": return t("blCancelWaiting")
    case "visit_ended": return t("blNoCheckin")
    case "cancelled":
      if (refund > 0) return t("blRefunded", { amount: money(refund, locale) })
      if (booking.isVoidedAuthorization || !["paid", "partially_refunded", "refunded"].includes(booking.paymentStatus || "")) return t("blNotCharged")
      return t("blNoRefund")
    case "completed": case "issue": case "no_show":
      if (booking.chefDue) return t(booking.chefDue.kind === "claim" ? "blDueClaim" : "blDueExtra")
      if (item.phase !== "completed" || paid <= 0) return ""
      return refund > 0 ? t("blPaidRefunded", { amount: money(paid, locale), refund: money(refund, locale) }) : t("blPaid", { amount: money(paid, locale) })
    case "confirmed":
      // A partial refund on a booking that still goes ahead (a shortened booking, a removed add-on) says what it is.
      return refund > 0 ? t("blPartRefunded", { amount: money(refund, locale) }) : ""
  }
  return ""
}

type CardAction = { label: string; href: string } | null

/** At most one action, only when it is the obvious next step. */
export function chefListAction(booking: ChefListBooking, item: ListedBooking<ChefListBooking>, t: T, locale: string): CardAction {
  if (["checkin_open", "in_session", "time_ended_in_session"].includes(item.phase)) return { label: t("bdhOpenVisit"), href: `/booking/${booking.id}/visit` }
  if (booking.chefDue && booking.chefDue.amountCents > 0 && item.phase !== "cancelled")
    return { label: bt("dcV2Pay", { amount: money(booking.chefDue.amountCents, locale) }), href: `/booking/${booking.id}` }
  return null
}

function KitchenThumb({ src, alt }: { src?: string | null; alt: string }) {
  const [failed, setFailed] = useState(false)
  const resolved = src ? getR2ProxyUrl(src) || src : null
  return (
    <div className="relative aspect-square w-[72px] shrink-0 self-start overflow-hidden rounded-xl bg-muted sm:aspect-[4/3] sm:w-[120px]">
      {resolved && !failed
        ? <SmartImage src={resolved} alt={alt} className="h-full w-full object-cover" onError={() => setFailed(true)} />
        : <div className="flex h-full w-full items-center justify-center text-muted-foreground/60" data-testid="kitchen-thumb-placeholder"><KitchenIcon className="size-6" aria-hidden /></div>}
    </div>
  )
}

function BookingCard({ item, kitchenName, t, locale, words, primary, showZone }: {
  item: ListedBooking<ChefListBooking>; kitchenName: string; t: T; locale: string; words: { today: string; tomorrow: string }
  /** The pinned "now" card carries the one filled button on the page. */
  primary: boolean; showZone: boolean
}) {
  const booking = item.row
  const cause = bookingCancelCause({ status: booking.status, chefId: booking.chefId, paymentDecision: booking.paymentDecision })
  const pill = bookingListPill(item.phase, false, cause)
  const line = chefListLine(booking, item, t, locale)
  const action = chefListAction(booking, item, t, locale)
  const when = listWhenLine(booking, locale, words)
  const zone = showZone ? friendlyTimezoneName(listTimezone(booking), locale) : ""
  return (
    <article className="group relative flex gap-3 rounded-2xl border border-border/70 bg-card p-3 transition-shadow sm:gap-5 sm:p-4 [@media(hover:hover)]:hover:shadow-[0_4px_16px_-8px_rgba(15,23,42,0.18)]"
      data-testid="chef-booking-card" data-phase={item.phase}>
      <KitchenThumb src={booking.kitchenPhoto} alt={kitchenName} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-col-reverse items-start gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <h3 className="min-w-0 max-w-full truncate text-[15px] font-semibold leading-6">
            {/* The whole card is the link (stretched); the inline action sits above it. */}
            <Link href={`/booking/${booking.id}`} className="outline-none after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring">
              {kitchenName}
            </Link>
          </h3>
          <StatusPill tone={pill.tone} className="shrink-0">{t(pill.key)}</StatusPill>
        </div>
        <p className="text-sm font-medium tabular-nums text-foreground/80">{when}{zone ? ` · ${zone}` : ""}</p>
        {line && <p className="text-[13px] leading-[18px] text-muted-foreground">{line}</p>}
        {action && (
          <Button asChild size="sm" variant={primary ? "default" : "outline"} className="relative z-10 mt-2 min-h-11 sm:min-h-9">
            <Link href={action.href}>{action.label}</Link>
          </Button>
        )}
      </div>
    </article>
  )
}

export default function ChefBookingsView({ bookings, isLoading, kitchens = [], onFindKitchen }: ChefBookingsViewProps) {
  const { t: tStrict, i18n } = useTranslation("chef")
  const t = tStrict as unknown as T
  const locale = i18n.language || "en-CA"
  const [tab, setTab] = useState<ChefListTab>("upcoming")
  const [query, setQuery] = useState("")
  const words = { today: t("ovToday"), tomorrow: t("ovTomorrow") }

  const rows = useMemo(() => (Array.isArray(bookings) ? bookings : []).filter(Boolean), [bookings])
  const tabs = useMemo(() => chefBookingTabs(rows), [rows])
  const kitchenName = (booking: ChefListBooking) =>
    kitchens.find(kitchen => kitchen.id === booking.kitchenId)?.name || booking.kitchenName || t("bkKitchenFallback", { id: booking.kitchenId })

  // Cancelled is a tab only while it holds something.
  const activeTab: ChefListTab = tab === "cancelled" && !tabs.cancelled.length ? "upcoming" : tab
  const current = tabs[activeTab]
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return current
    return current.filter(({ row }) => [kitchenName(row), row.locationName, row.referenceCode, listWhenLine(row, locale, words)]
      .filter(Boolean).join(" ").toLowerCase().includes(q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, query, locale])

  // The kitchen zone is said once for the page; per card only when bookings span zones.
  const zones = useMemo(() => Array.from(new Set(rows.map(row => listTimezone(row)))), [rows])
  const pinned = activeTab === "upcoming" ? visible.find(item => chefUpcomingRank(item.row, item.phase) === 0) : undefined

  const tabLabel = (key: ChefListTab, label: string) => {
    const count = tabs[key].length
    return <TabsTrigger value={key} className="min-h-11 gap-1.5 px-4 sm:min-h-9">{label}{count > 0 && <span className="tabular-nums text-muted-foreground">{count}</span>}</TabsTrigger>
  }

  const findKitchen = onFindKitchen && <Button variant="outline" className="min-h-11" onClick={onFindKitchen}>{t("blFindKitchen")}</Button>

  return (
    <div className="w-full max-w-[880px] space-y-5">
      <PendingOverstayPenalties />

      {isLoading ? (
        <div className="space-y-3" role="status" aria-label={t("bkLoadingBookings")}>
          {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-[104px] w-full rounded-2xl" />)}
        </div>
      ) : !rows.length ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed p-6">
          <p className="text-[15px]">{t("blEmptyAll")}</p>
          {findKitchen}
        </div>
      ) : (
        <section className="space-y-4" aria-label={t("bkMyBookings")}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Tabs value={activeTab} onValueChange={value => { setTab(value as ChefListTab); setQuery("") }}>
              <TabsList className="h-auto">
                {tabLabel("upcoming", t("blTabUpcoming"))}
                {tabLabel("past", t("blTabPast"))}
                {tabs.cancelled.length > 0 && tabLabel("cancelled", t("blTabCancelled"))}
              </TabsList>
            </Tabs>
            {zones.length === 1 && <p className="text-[13px] text-muted-foreground">{t("blTimesIn", { zone: friendlyTimezoneName(zones[0], locale) })}</p>}
          </div>

          {current.length > SEARCH_AFTER && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t("blSearch")} aria-label={t("blSearch")} className="min-h-11 pl-9 pr-10" />
              {query && <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2" onClick={() => setQuery("")} aria-label={t("bkClearSearch")}><X className="h-4 w-4" /></Button>}
            </div>
          )}

          {visible.length ? (
            <ul className="space-y-3" data-testid={`chef-bookings-${activeTab}`}>
              {visible.map(item => (
                <li key={item.row.id}>
                  <BookingCard item={item} kitchenName={kitchenName(item.row)} t={t} locale={locale} words={words}
                    primary={item === pinned} showZone={zones.length > 1} />
                </li>
              ))}
            </ul>
          ) : query ? (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed p-6">
              <p className="text-[15px]">{t("blNoMatch", { query: query.trim() })}</p>
              <Button variant="outline" className="min-h-11" onClick={() => setQuery("")}>{t("bkClearSearch")}</Button>
            </div>
          ) : (
            <div className={cn("flex flex-col items-start gap-3 rounded-2xl border border-dashed p-6")}>
              <p className="text-[15px]">{t(activeTab === "past" ? "blEmptyPast" : "blEmptyUpcoming")}</p>
              {findKitchen}
            </div>
          )}
        </section>
      )}

      {/* Storage is rented on its own now; the old add-on list moved to "My storage". */}
      <p className="text-sm"><Link className="font-medium underline underline-offset-2" href="/storage">{t("blMyStorage")}</Link></p>
    </div>
  )
}
