/**
 * Extra time on the booking page (build-session-extensions.md).
 * Manager: a sticky request banner (Approve / Decline), "Offer more time" while the chef is in session, and
 * "Charge for extra time" within 24 h after a late checkout (prefilled from the recorded checkout; may only be lowered).
 * Chef: accept & pay an offer, pay or question an extra-time charge. Both: history lines.
 * Every action is a POST; nothing here is ever decided by opening a link.
 *
 * `variant` (design-booking-consolidation.md §1.1): "card" is the standalone card (visit page, older callers);
 * "now" renders only the open items as attention rows for the booking page's Now card, and reports the manager tools
 * ("Offer more time", "Let them start early", "Charge for extra time") through `onToolsChange` so the page can place
 * them in its one secondary row; the chosen tool opens in a sheet. "record" renders only the confirmed history lines.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Clock, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { NowAttentionRow } from "@/components/booking/BookingNowCard"
import { createExtension, decideExtension, defaultFreeChoice, isExtensionState, isQuickPick, kitchenClock, lengthText, money, newRequestKey, readExtensions, withCardAction,
  type ExtensionItem, type ExtensionState } from "@/lib/session-extensions"

/** A manager's pick before sending: which time, and Free or Charge (Free is only preselected up to 30 minutes). */
type Pick = { kind: "offer" | "early_start"; minutes: number; at: string; amountCents: number; free: boolean }
export type ExtensionTool = "offer" | "early_start" | "charge"

export function SessionExtensionsCard({ bookingId, manager, chefName, onChanged, only, refreshKey, variant = "card", tool = null, onToolChange, onToolsChange, allowPrimary = false }: {
  bookingId: number; manager: boolean; chefName: string; onChanged?: () => void | Promise<void>
  /** Visit page: show only early-start offers and grants. */
  only?: "early_start"
  /** Re-reads when the visit record changes elsewhere on the page (e.g. a departure was recorded). */
  refreshKey?: string
  variant?: "card" | "now" | "record"
  /** "now": the manager tool the page asked to open (from its secondary row). */
  tool?: ExtensionTool | null
  onToolChange?: (tool: ExtensionTool | null) => void
  /** "now": which manager tools apply right now, in display order. */
  onToolsChange?: (tools: ExtensionTool[]) => void
  /** "now": the page has no other primary action, so the first answer here may be the one filled button. */
  allowPrimary?: boolean
}) {
  const { t, i18n } = useTranslation("booking")
  const locale = i18n.resolvedLanguage || i18n.language || "en-CA"
  const [state, setState] = useState<ExtensionState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [offering, setOffering] = useState<"offer" | "early_start" | null>(null)
  const [pick, setPick] = useState<Pick | null>(null)
  // "Choose a time…" opens a compact list of every free time (15-minute steps).
  const [choosing, setChoosing] = useState(false)
  const [charging, setCharging] = useState(false)
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [disputing, setDisputing] = useState<number | null>(null)
  const [disputeNote, setDisputeNote] = useState("")
  const [requestKey, setRequestKey] = useState(newRequestKey)

  const load = useCallback(async () => {
    try { const result = await readExtensions(bookingId); setState(isExtensionState(result) ? result : null) } catch { setState(null) }
  }, [bookingId])
  useEffect(() => {
    void load()
    const wake = () => { if (document.visibilityState !== "hidden") void load() }
    window.addEventListener("focus", wake)
    return () => window.removeEventListener("focus", wake)
  }, [load, refreshKey])

  const now = state ? Date.parse(state.serverNow) : 0
  const view = useMemo(() => {
    const history = (state?.history || []).filter(item => !only || item.kind === only)
    return { requests: history.filter(item => item.kind === "request" && item.status === "requested" && item.authorized && Date.parse(item.expiresAt) > now),
      offers: history.filter(item => ["offer", "early_start"].includes(item.kind) && item.status === "offered" && Date.parse(item.expiresAt) > now),
      charges: history.filter(item => item.kind === "extra_time" && ["offered", "disputed"].includes(item.status)),
      waiting: history.filter(item => item.kind === "request" && ["requested", "approved"].includes(item.status) && !item.confirmed),
      done: history.filter(item => item.confirmed) }
  }, [state, now, only])
  const hasOpen = view.requests.length > 0 || view.offers.length > 0 || view.waiting.length > 0
  const showOffer = !!state && !only && manager && state.enabled && state.inSession && state.options.length > 0 && !hasOpen
  const showEarly = !!state && !only && manager && state.enabled && !!state.beforeStart && (state.earlyOptions?.length ?? 0) > 0 && !hasOpen
  const showCharge = !!state && !only && manager && state.enabled && !!state.extraTime
  const toolKey = [showEarly && "early_start", showOffer && "offer", showCharge && "charge"].filter(Boolean).join("|")
  useEffect(() => {
    if (variant !== "now") return
    onToolsChange?.(toolKey ? toolKey.split("|") as ExtensionTool[] : [])
  }, [variant, toolKey, onToolsChange])
  const maxCharge = state?.extraTime?.maximumAmountCents ?? 0
  // The page opens a tool from its secondary row; the sheet below holds the picker or the charge form.
  useEffect(() => {
    if (variant !== "now" || !tool) return
    setError(""); setNotice("")
    if (tool === "charge") { setCharging(true); setAmount((maxCharge / 100).toFixed(2)); setNote("") }
    else { setOffering(tool); setPick(null); setChoosing(false) }
  }, [variant, tool, maxCharge])

  if (!state) return null
  const zone = state.timezone, currency = state.currency, kitchen = state.kitchenName
  const clock = (at: string) => kitchenClock(at, zone, locale)
  const cash = (cents: number) => money(cents, currency, locale)
  const length = (minutes: number) => lengthText(minutes, (key, options) => String(t(key as never, options as never)), "sxb")
  const duration = (minutes: number) => isQuickPick(minutes)
    ? t(`sxbDuration${minutes}`, { defaultValue: minutes === 30 ? "30 more minutes" : minutes === 60 ? "1 more hour" : "2 more hours" })
    : t("sxbDurationOther", { defaultValue: "{length} more", length: length(minutes) })
  const minutesText = (minutes: number) => t("sxbMinutes", { defaultValue: `${minutes} minutes`, minutes, count: minutes })

  const act = async (key: string, work: () => Promise<unknown>, success?: string) => {
    setBusy(key); setError(""); setNotice("")
    try { await work(); if (success) setNotice(success); setRequestKey(newRequestKey()); await load(); await onChanged?.() }
    catch (failure) { setError(failure instanceof Error ? failure.message : t("sxbFailed", { defaultValue: "That didn’t go through. Nothing new was charged." })); await load() }
    finally { setBusy(null) }
  }
  const decide = (item: ExtensionItem, action: string, extra: Record<string, unknown> = {}) =>
    withCardAction(bookingId, () => decideExtension(bookingId, item.id, { action, ...extra }))
  const closeTools = () => { setOffering(null); setPick(null); setChoosing(false); setCharging(false); if (variant === "now") onToolChange?.(null) }

  const chargeCents = Math.round(Number(amount || (maxCharge / 100).toFixed(2)) * 100)
  const chargeValid = Number.isSafeInteger(chargeCents) && chargeCents > 0 && chargeCents <= maxCharge && note.trim().length > 0
  const tap = "min-h-11"
  const nowMode = variant === "now"
  // In the Now card, answers are outline buttons; at most one (the first answer) may be the page's single filled action.
  const promoted = !nowMode || !allowPrimary ? null : manager
    ? (view.requests[0] ? `approve-${view.requests[0].id}` : null)
    : view.offers[0] ? `accept-${view.offers[0].id}` : (() => { const charge = view.charges.find(item => item.status !== "disputed"); return charge ? `pay-${charge.id}` : null })()
  const answer = (key: string, filledInCard = true) => {
    const primary = promoted === key
    return { variant: (primary || (!nowMode && filledInCard) ? "default" : "outline") as "default" | "outline", ...(primary ? { "data-primary-action": "true" } : {}) }
  }

  const historyList = view.done.length > 0 && <ul className="space-y-1 text-sm" aria-label={t("sxbHistory", { defaultValue: "Extra time history" })} data-testid="extension-history">
    {view.done.map(item => <li key={item.id}>{item.kind === "extra_time"
      ? t("sxbHistoryExtra", { defaultValue: "Extra time paid · {amount}", amount: cash(item.amountCents) })
      : item.kind === "early_start" ? item.free
        // The manager reads their own decisions in the first person; the chef reads the kitchen's name.
        ? manager ? t("sxbHistoryEarlyFreeManager", { defaultValue: "You let {chef} start {early} early — no charge", chef: chefName, early: minutesText(item.minutes) })
          : t("sxbHistoryEarlyFree", { defaultValue: "{kitchen} let you start {early} early — no charge", kitchen, early: minutesText(item.minutes) })
        : t("sxbHistoryEarly", { defaultValue: "Started earlier at {time} · {amount}", time: clock(item.endAt), amount: cash(item.amountCents) })
      : item.free ? manager ? t("sxbHistoryFreeManager", { defaultValue: "You gave {chef} {duration} (until {time}) — no charge", chef: chefName, duration: duration(item.minutes), time: clock(item.endAt) })
        : t("sxbHistoryFree", { defaultValue: "{kitchen} gave you {duration} (until {time}) — no charge", kitchen, duration: duration(item.minutes), time: clock(item.endAt) })
      : t("sxbHistoryExtended", { defaultValue: "Extended until {time} · {amount}", time: clock(item.endAt), amount: cash(item.amountCents) })}</li>)}
  </ul>

  if (variant === "record") return historyList || null

  const openItems = <>
    {manager && view.requests.map(item => (
      <NowAttentionRow key={item.id} as={nowMode ? undefined : "plain"} role="alert" className={nowMode ? undefined : "sticky top-0 z-20 space-y-2 rounded-xl border border-primary/40 bg-background p-3 shadow-sm"} data-testid="extension-request-banner">
        <p className="text-sm font-medium">{t("sxbRequestBanner", { defaultValue: "{chef} asked for {duration} (until {time}) · you’d get {payout}",
          chef: chefName, duration: duration(item.minutes), time: clock(item.endAt), payout: cash(item.kitchenGrossCents ?? 0) })}</p>
        <p className="text-xs text-muted-foreground">{t("sxbRequestHint", { defaultValue: "Their card is on hold for {amount}. It’s only charged if you approve. The request closes at {expires}.",
          amount: cash(item.amountCents), expires: clock(item.expiresAt) })}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" className={tap} {...answer(`approve-${item.id}`)} disabled={!!busy} onClick={() => void act(`approve-${item.id}`, () => decide(item, "approve"),
            t("sxbApproved", { defaultValue: "Approved. {chef} has until {time}.", chef: chefName, time: clock(item.endAt) }))}>
            {busy === `approve-${item.id}` && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}{t("sxbApproveCharge", { defaultValue: "Approve · charge {amount}", amount: cash(item.amountCents) })}</Button>
          <Button type="button" variant="outline" className={tap} disabled={!!busy} onClick={() => void act(`free-${item.id}`, () => decide(item, "approve_free"),
            t("sxbApprovedFree", { defaultValue: "Approved at no charge. {chef} has until {time}; their card hold is released.", chef: chefName, time: clock(item.endAt) }))}>
            {busy === `free-${item.id}` && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}{t("sxbApproveFree", { defaultValue: "Approve for free" })}</Button>
          <Button type="button" variant="outline" className={tap} disabled={!!busy} onClick={() => void act(`decline-${item.id}`, () => decide(item, "decline"),
            t("sxbDeclinedNotice", { defaultValue: "Declined. {chef}’s card hold is released.", chef: chefName }))}>{t("sxbDecline", { defaultValue: "Decline" })}</Button>
        </div>
      </NowAttentionRow>
    ))}

    {!manager && view.waiting.map(item => (
      <p key={item.id} className="text-sm" role="status">{t("sxbWaiting", { defaultValue: "Waiting for {kitchen} · we’ll let you know", kitchen })}</p>
    ))}
    {manager && view.offers.map(item => (
      <p key={item.id} className="text-sm" role="status">{item.kind === "early_start"
        ? t("sxbEarlyOfferSent", { defaultValue: "You offered {chef} an earlier start at {time} · {amount}. Waiting for them to accept.", chef: chefName, time: clock(item.endAt), amount: cash(item.amountCents) })
        : t("sxbOfferSent", { defaultValue: "You offered {chef} {duration} (until {time}). Waiting for them to accept.",
        chef: chefName, duration: duration(item.minutes), time: clock(item.endAt) })}</p>
    ))}

    {!manager && view.offers.map(item => (
      <NowAttentionRow key={item.id} as={nowMode ? undefined : "plain"} className={nowMode ? undefined : "space-y-2 rounded-xl border p-3"} data-testid="extension-offer">
        <p className="text-sm font-medium">{item.kind === "early_start"
          ? t("sxbEarlyOffer", { defaultValue: "{kitchen} can let you start {early} early, at {time} · {amount}", kitchen, early: minutesText(item.minutes), time: clock(item.endAt), amount: cash(item.amountCents) })
          : t("sxbOffer", { defaultValue: "{kitchen} offered you {duration} (until {time}) · {amount}",
          kitchen, duration: duration(item.minutes), time: clock(item.endAt), amount: cash(item.amountCents) })}</p>
        <p className="text-xs text-muted-foreground">{t("sxbNoRefund", { defaultValue: "Charged to your saved card. Extra time can’t be refunded once it’s added." })}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" className={tap} {...answer(`accept-${item.id}`)} disabled={!!busy} onClick={() => void act(`accept-${item.id}`, () => decide(item, "accept", { expectedAmountCents: item.amountCents }))}>
            {busy === `accept-${item.id}` && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}{t("sxbAcceptPay", { defaultValue: "Accept & pay {amount}", amount: cash(item.amountCents) })}</Button>
          <Button type="button" variant="outline" className={tap} disabled={!!busy} onClick={() => void act(`decline-${item.id}`, () => decide(item, "decline"))}>{t("sxbNoThanks", { defaultValue: "No thanks" })}</Button>
        </div>
      </NowAttentionRow>
    ))}

    {view.charges.map(item => (
      <NowAttentionRow key={item.id} as={nowMode ? undefined : "plain"} tone={item.status === "disputed" || manager ? "info" : "warning"}
        className={nowMode ? undefined : "space-y-2 rounded-xl border p-3"} data-testid="extension-charge">
        <p className="text-sm font-medium">{manager
          ? t("sxbChargeSent", { defaultValue: "You asked {chef} for {amount} for {billed} of extra time.", chef: chefName, amount: cash(item.amountCents), billed: minutesText(item.minutes) })
          // The amount may have been lowered, so the chef line never pairs it with a length (it would read as a rate).
          : t("sxbChargeChef", { defaultValue: "You stayed {stayed} past your booking at {kitchen}. They’ve asked for {amount} for the extra time.",
            stayed: minutesText(item.actualMinutes ?? item.minutes), kitchen, amount: cash(item.amountCents) })}</p>
        {item.note && <p className="text-sm whitespace-pre-wrap">{manager ? t("sxbYourNote", { defaultValue: "Your note: {note}", note: item.note }) : t("sxbKitchenNote", { defaultValue: "Note from {kitchen}: {note}", kitchen, note: item.note })}</p>}
        {item.status === "disputed" ? <p className="text-sm" role="status">{t("sxbDisputed", { defaultValue: "Local Cooks is reviewing this charge. Nothing was charged." })}</p>
          : manager ? <p className="text-xs text-muted-foreground">{item.escalated ? t("sxbEscalated", { defaultValue: "No answer after 48 hours, so Local Cooks is following up. Nothing has been charged." })
            : t("sxbChargeWaiting", { defaultValue: "Waiting for {chef}. Their card is only charged if they pay.", chef: chefName })}</p>
          : <>
            <div className="flex flex-wrap gap-2">
              <Button type="button" className={tap} {...answer(`pay-${item.id}`)} disabled={!!busy} onClick={() => void act(`pay-${item.id}`, () => decide(item, "pay", { expectedAmountCents: item.amountCents }),
                t("sxbPaid", { defaultValue: "Paid. Thank you!" }))}>
                {busy === `pay-${item.id}` && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}{t("sxbPay", { defaultValue: "Pay {amount}", amount: cash(item.amountCents) })}</Button>
              <Button type="button" variant="outline" className={tap} disabled={!!busy} onClick={() => { setDisputing(item.id); setDisputeNote("") }}>{t("sxbNotRight", { defaultValue: "This isn’t right" })}</Button>
            </div>
            {disputing === item.id && <div className="space-y-2">
              <label htmlFor={`extra-dispute-${item.id}`} className="block text-sm font-medium">{t("sxbDisputeLabel", { defaultValue: "What isn’t right? Local Cooks will review it with {kitchen}.", kitchen })}</label>
              <Textarea id={`extra-dispute-${item.id}`} value={disputeNote} maxLength={1000} rows={3} onChange={event => setDisputeNote(event.target.value)} />
              <Button type="button" className={tap} variant={nowMode ? "outline" : "default"} disabled={!!busy || !disputeNote.trim()} onClick={() => void act(`dispute-${item.id}`, () => decide(item, "dispute", { note: disputeNote.trim() }),
                t("sxbDisputeSent", { defaultValue: "Thanks — Local Cooks will review this and get back to you. Nothing was charged." })).then(() => setDisputing(null))}>
                {t("sxbSendToSupport", { defaultValue: "Send to Local Cooks" })}</Button>
            </div>}
          </>}
      </NowAttentionRow>
    ))}
  </>

  const picker = offering && (showOffer || showEarly) && (
    <div className={nowMode ? "space-y-3" : "space-y-2 rounded-xl border p-3"} data-testid="extension-offer-picker">
      <p className="text-sm font-medium">{offering === "early_start"
        ? t("sxbEarlyPick", { defaultValue: "When can {chef} start? Only free times are shown.", chef: chefName })
        : t("sxbOfferPick", { defaultValue: "How much time do you want to offer {chef}?", chef: chefName })}</p>
      {(() => {
        // Every free time from the server; the chips are the quick picks, the list holds the rest (15-minute steps).
        const all = offering === "early_start"
          ? (state.earlyOptions || []).map(option => ({ minutes: option.minutes, at: option.startAt, amountCents: option.amountCents, startNow: !!option.startNow }))
          : state.options.map(option => ({ minutes: option.minutes, at: option.endAt, amountCents: option.amountCents, startNow: false }))
        const chips = all.filter(option => option.startNow || isQuickPick(option.minutes))
        const choose = (option: typeof all[number]) => setPick({ kind: offering, minutes: option.minutes, at: option.at, amountCents: option.amountCents, free: defaultFreeChoice(option.minutes) || !state.hasSavedCard })
        const label = (option: typeof all[number]) => offering === "early_start"
          ? option.startNow ? t("sxbStartNowOption", { defaultValue: "Start now (from {time})", time: clock(option.at) })
            : t("sxbEarlyOption", { defaultValue: "Start at {time} ({early} early)", time: clock(option.at), early: length(option.minutes) })
          : t("sxbOfferOption", { defaultValue: "{duration} · until {time}", duration: duration(option.minutes), time: clock(option.at) })
        const fieldLabel = offering === "early_start" ? t("sxbNewStartLabel", { defaultValue: "New start time" }) : t("sxbNewEndLabel", { defaultValue: "New end time" })
        return <>
          <div className="flex flex-wrap gap-2" role="group" aria-label={fieldLabel}>
            {chips.map(option => (
              <Button key={option.minutes} type="button" size="sm" variant={pick?.minutes === option.minutes ? "default" : "outline"} className={tap} disabled={!!busy}
                aria-pressed={pick?.minutes === option.minutes} onClick={() => { setChoosing(false); choose(option) }}>
                {offering === "early_start" && option.startNow ? t("sxbStartNow", { defaultValue: "Start now" }) : label(option)}
              </Button>
            ))}
            <Button type="button" size="sm" variant={choosing ? "default" : "outline"} className={tap} disabled={!!busy} aria-expanded={choosing}
              onClick={() => setChoosing(open => !open)}>{t("sxbChooseTime", { defaultValue: "Choose a time…" })}</Button>
          </div>
          {choosing && <div className="space-y-1">
            <label htmlFor={`extra-time-choice-${bookingId}`} className="block text-sm font-medium">{fieldLabel}</label>
            <select id={`extra-time-choice-${bookingId}`} className="block w-full min-h-11 rounded-md border bg-background p-2" disabled={!!busy}
              value={pick?.minutes ?? ""} onChange={event => { const option = all.find(item => item.minutes === Number(event.target.value)); if (option) choose(option); else setPick(null) }}>
              <option value="">{t("sxbPickTime", { defaultValue: "Pick a time" })}</option>
              {all.map(option => <option key={option.minutes} value={option.minutes}>{label(option)}</option>)}
            </select>
          </div>}
        </>
      })()}
      {pick && <fieldset className="space-y-2 border-t pt-2">
        <p className="text-sm font-medium tabular-nums" data-testid="extension-pick-summary">{pick.kind === "early_start"
          ? t("sxbSummaryStart", { defaultValue: "Starts at {time} · {amount}", time: clock(pick.at), amount: pick.free ? t("sxbFree", { defaultValue: "Free" }) : cash(pick.amountCents) })
          : t("sxbSummaryUntil", { defaultValue: "Until {time} · {amount}", time: clock(pick.at), amount: pick.free ? t("sxbFree", { defaultValue: "Free" }) : cash(pick.amountCents) })}</p>
        <legend className="text-sm font-medium">{t("sxbChargeChoice", { defaultValue: "Free, or charge {chef}?", chef: chefName })}</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="extra-time-charge" checked={pick.free} onChange={() => setPick({ ...pick, free: true })} />
          {t("sxbFree", { defaultValue: "Free" })}</label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="extra-time-charge" checked={!pick.free} disabled={!state.hasSavedCard} onChange={() => setPick({ ...pick, free: false })} />
          {t("sxbChargeFor", { defaultValue: "Charge for the extra time · {amount}", amount: cash(pick.amountCents) })}</label>
        <p className="text-xs text-muted-foreground">{pick.free
          ? pick.kind === "early_start" ? t("sxbFreeStartHint", { defaultValue: "{chef} can start at {time} right away — we’ll let them know.", chef: chefName, time: clock(pick.at) })
            : t("sxbFreeEndHint", { defaultValue: "{chef} gets until {time} right away — we’ll let them know.", chef: chefName, time: clock(pick.at) })
          : t("sxbPaidOfferHint", { defaultValue: "{chef} accepts and pays with their saved card. Nothing changes until they pay.", chef: chefName })}</p>
        <Button type="button" className={tap} disabled={!!busy} onClick={() => void act(`offer-${pick.minutes}`, () => createExtension(bookingId, { kind: pick.kind, minutes: pick.minutes,
            requestKey, free: pick.free, expectedEndAt: pick.kind === "early_start" ? state.startAt : state.endAt, expectedAmountCents: pick.free ? 0 : pick.amountCents,
            ...(state.visitId ? { visitId: state.visitId } : {}) }),
          pick.free ? t("sxbGranted", { defaultValue: "Done. We let {chef} know.", chef: chefName }) : t("sxbOfferDone", { defaultValue: "Offer sent to {chef}.", chef: chefName }))
          .then(closeTools)}>
          {pick.free ? t("sxbGiveFree", { defaultValue: "Give it free" }) : t("sxbSendOffer", { defaultValue: "Send offer · {amount}", amount: cash(pick.amountCents) })}</Button>
      </fieldset>}
      <Button type="button" variant="ghost" className={tap} onClick={closeTools}>{t("sxbCancel", { defaultValue: "Cancel" })}</Button>
    </div>
  )

  const chargeForm = showCharge && charging && state.extraTime && (
    <form className={nowMode ? "space-y-3" : "space-y-2 rounded-xl border p-3"} data-testid="extension-charge-form" onSubmit={event => {
      event.preventDefault()
      if (!chargeValid || !state.endAt) return
      void act("charge", () => createExtension(bookingId, { kind: "extra_time", amountCents: chargeCents, note: note.trim(), requestKey,
        expectedEndAt: state.endAt, expectedAmountCents: chargeCents, ...(state.visitId ? { visitId: state.visitId } : {}) }),
        t("sxbChargeDone", { defaultValue: "Sent to {chef}. They’ll pay or let us know if it isn’t right.", chef: chefName })).then(closeTools)
    }}>
      <p className="text-sm">{t("sxbChargeExplain", { defaultValue: "{chef} checked out {stayed} after the booked end ({end}). That’s {billed} at the booking’s rate: up to {max}.",
        chef: chefName, stayed: minutesText(state.extraTime.actualMinutes), end: state.endAt ? clock(state.endAt) : "", billed: minutesText(state.extraTime.minutes), max: cash(maxCharge) })}</p>
      <label htmlFor="extra-time-amount" className="block text-sm font-medium">{t("sxbAmount", { defaultValue: "Amount (you can lower it)" })}</label>
      <input id="extra-time-amount" type="number" inputMode="decimal" min="0.01" step="0.01" max={(maxCharge / 100).toFixed(2)} value={amount}
        onChange={event => setAmount(event.target.value)} className="block w-40 min-h-11 rounded-md border bg-background p-2 tabular-nums" />
      {chargeCents > maxCharge && <p role="alert" className="text-sm text-destructive">{t("sxbTooHigh", { defaultValue: "The charge can’t be more than {max}.", max: cash(maxCharge) })}</p>}
      <label htmlFor="extra-time-note" className="block text-sm font-medium">{t("sxbNote", { defaultValue: "Note to {chef} (required)", chef: chefName })}</label>
      <Textarea id="extra-time-note" value={note} maxLength={1000} rows={3} onChange={event => setNote(event.target.value)} />
      <p className="text-xs text-muted-foreground">{t("sxbChargeHint", { defaultValue: "{chef} pays with one tap or tells us it isn’t right. Their card is never charged without them.", chef: chefName })}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className={tap} disabled={!!busy || !chargeValid}>{t("sxbSendCharge", { defaultValue: "Send {amount} to {chef}", amount: cash(Number.isSafeInteger(chargeCents) ? chargeCents : 0), chef: chefName })}</Button>
        <Button type="button" variant="ghost" className={tap} onClick={closeTools}>{t("sxbCancel", { defaultValue: "Cancel" })}</Button>
      </div>
    </form>
  )

  const feedback = <>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </>

  if (nowMode) {
    const sheetOpen = !!picker || !!chargeForm
    const hasItems = view.requests.length + view.offers.length + view.charges.length + view.waiting.length > 0
    if (!hasItems && !sheetOpen && !notice && !error) return null
    return <div className="space-y-3" data-testid="session-extensions" data-variant="now">
      {openItems}
      {!sheetOpen && feedback}
      <Sheet open={sheetOpen} onOpenChange={open => { if (!open && !busy) closeTools() }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader className="mb-4">
            <SheetTitle>{charging ? t("sxbChargeExtra", { defaultValue: "Charge for extra time" }) : offering === "early_start" ? t("sxbLetStartEarly", { defaultValue: "Let them start early" }) : t("sxbOfferMore", { defaultValue: "Offer more time" })}</SheetTitle>
            <SheetDescription className="sr-only">{chefName}</SheetDescription>
          </SheetHeader>
          {picker || chargeForm}
          {sheetOpen && feedback}
        </SheetContent>
      </Sheet>
    </div>
  }

  const nothing = !view.requests.length && !view.offers.length && !view.charges.length && !view.waiting.length && !view.done.length && !showOffer && !showEarly && !showCharge
  if (nothing && !error && !notice) return null

  return (
    <section className="space-y-3 rounded-2xl border p-4 sm:p-5" aria-labelledby={only ? undefined : "extra-time-title"} aria-label={only ? t("sxbEarlyTitle", { defaultValue: "Earlier start" }) : undefined} data-testid="session-extensions">
      {!only && <h2 id="extra-time-title" className="text-base font-semibold flex items-center gap-2"><Clock className="h-4 w-4" aria-hidden />{t("sxbTitle", { defaultValue: "Extra time" })}</h2>}
      {openItems}
      {showOffer && !offering && <Button type="button" variant="outline" className={tap} onClick={() => { setOffering("offer"); setPick(null); setChoosing(false) }}>{t("sxbOfferMore", { defaultValue: "Offer more time" })}</Button>}
      {showEarly && !offering && <Button type="button" variant="outline" className={tap} onClick={() => { setOffering("early_start"); setPick(null); setChoosing(false) }}>{t("sxbLetStartEarly", { defaultValue: "Let them start early" })}</Button>}
      {picker}
      {showCharge && !charging && <Button type="button" variant="outline" className={tap} onClick={() => { setCharging(true); setAmount((maxCharge / 100).toFixed(2)); setNote("") }}>
        {t("sxbChargeExtra", { defaultValue: "Charge for extra time" })}</Button>}
      {chargeForm}
      {historyList}
      {!state.enabled && manager && <p className="text-xs text-muted-foreground">{t("sxbPaused", { defaultValue: "Extra time is paused on Local Cooks right now." })}</p>}
      {feedback}
    </section>
  )
}
