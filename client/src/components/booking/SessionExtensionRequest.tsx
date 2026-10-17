/**
 * Chef "Need more time?" (build-session-extensions.md). Loads nothing until tapped: the countdown never polls.
 * In the last hour it lists the server-priced quick picks (+30 min, +1 h, +2 h) plus "Choose a time…" (any free end in
 * 15-minute steps, priced in 30-minute blocks); one tap places a hold on the saved card
 * (the kitchen approves) or charges it at once when the kitchen approves automatically. Outside that window, or when
 * extra time is unavailable, it explains why and offers a message button.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { CheckCircle2, Clock, Loader2, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { checkoutExtension, createExtension, isExtensionState, isQuickPick, kitchenClock, lapsedAt, lengthText, money, newRequestKey, readExtensions, useServerNow, withCardAction,
  type ExtensionItem, type ExtensionOption, type ExtensionState } from "@/lib/session-extensions"

const EMPTY = "__empty__"

const POLL_MS = 20_000
type View = { kind: "unavailable"; state: ExtensionState | null } | { kind: "idle" } | { kind: "loading" } | { kind: "options"; state: ExtensionState } | { kind: "busy"; state: ExtensionState }
  | { kind: "waiting"; item: ExtensionItem; state: ExtensionState } | { kind: "confirmed"; item: ExtensionItem; state: ExtensionState }
  // The kitchen's deadline passed before it answered; the server is releasing the hold. Never flips back to "Need more time?".
  | { kind: "lapsed"; item: ExtensionItem; state: ExtensionState }
  | { kind: "declined"; state: ExtensionState } | { kind: "booked"; state: ExtensionState }
  // The kitchen already offered more time: answer that offer (shown above) instead of starting a competing request.
  | { kind: "offer_open"; state: ExtensionState }
  | { kind: "card_failed"; item: ExtensionItem; state: ExtensionState }

export function SessionExtensionRequest({ bookingId, kitchenName, timezone, className, moreTimeDraft, onMessage, onExtended }: {
  bookingId: number; kitchenName: string; timezone: string; className?: string
  /** Prefilled "could I have more time" message used when extra time can't be added here. */
  moreTimeDraft: string
  /** Opens the kitchen conversation; with a draft when asking for time there. */
  onMessage: (draft?: string) => void
  /** The booked end changed (extension confirmed): refresh the visit. */
  onExtended?: () => void
}) {
  const { t, i18n } = useTranslation("chef")
  const locale = i18n.resolvedLanguage || i18n.language || "en-CA"
  const [view, setView] = useState<View>({ kind: "idle" })
  const [error, setError] = useState("")
  // "Choose a time…": any free end in 15-minute steps; a summary line shows before the chef confirms.
  const [custom, setCustom] = useState<{ open: boolean; minutes: number | null }>({ open: false, minutes: null })
  const requestKey = useRef(newRequestKey())
  const extended = useRef(onExtended)
  extended.current = onExtended
  const clock = (at: string, zone = timezone) => kitchenClock(at, zone, locale)

  const settle = useCallback((item: ExtensionItem, state: ExtensionState) => {
    if ((item.cardFailedAt || item.checkoutPending && !item.authorized) && !item.refundedAt && Date.parse(item.expiresAt) > Date.parse(state.serverNow)) { setView({ kind: "card_failed", item, state }); return }
    if (item.confirmed) { setView({ kind: "confirmed", item, state }); extended.current?.(); requestKey.current = newRequestKey(); return }
    if (["declined", "expired", "cancelled"].includes(item.status)) { setView({ kind: "declined", state }); requestKey.current = newRequestKey(); return }
    if (lapsedAt(item, Date.parse(state.serverNow))) { setView({ kind: "lapsed", item, state }); requestKey.current = newRequestKey(); return }
    setView({ kind: "waiting", item, state })
  }, [])

  const open = async (again = false) => {
    setError(""); setView({ kind: "loading" })
    let state: ExtensionState | null = null
    try { const result = await readExtensions(bookingId); state = isExtensionState(result) ? result : null } catch { state = null }
    const pending = state?.history.find(item => item.kind === "request" && (["requested", "approved"].includes(item.status) || !!item.cardFailedAt && Date.parse(item.expiresAt) > Date.parse(state.serverNow)) && !item.confirmed && !item.refundedAt)
    // A request past its deadline is closed (the server is releasing it): it shows as closed, and "Ask again" goes past it
    // to the options instead of bouncing back to "Waiting".
    if (state && pending && !(again && lapsedAt(pending, Date.parse(state.serverNow)))) return settle(pending, state)
    if (!state || !state.enabled || !state.canRequest || state.unavailableReason) {
      return setView({ kind: "unavailable", state })
    }
    const offerOpen = state.history.some(item => ["offer", "early_start"].includes(item.kind) && item.status === "offered" && Date.parse(item.expiresAt) > Date.parse(state.serverNow))
    if (offerOpen) return setView({ kind: "offer_open", state })
    if (state.noTimeFree || !state.options.length) return setView({ kind: "booked", state })
    setView({ kind: "options", state })
  }

  const choose = async (state: ExtensionState, option: ExtensionOption) => {
    if (!state.endAt) return
    setError(""); setView({ kind: "busy", state })
    try {
      const result = await withCardAction(bookingId, () => createExtension(bookingId, { kind: "request", minutes: option.minutes,
        requestKey: requestKey.current, expectedEndAt: state.endAt, expectedAmountCents: option.amountCents, ...(state.visitId ? { visitId: state.visitId } : {}) }))
      settle(result.extension, state)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("sxFailed", { defaultValue: "We couldn’t add the time. Nothing was charged." }))
      setView({ kind: "options", state })
    }
  }

  // Only while a request waits for the kitchen: a light, bounded refresh until it is answered or closes.
  const waitingId = view.kind === "waiting" || view.kind === "lapsed" ? view.item.id : null
  const waitingUntil = view.kind === "waiting" || view.kind === "lapsed" ? Date.parse(view.item.expiresAt) + 60_000 : 0
  // At the deadline the waiting box turns into the truth right away (server clock), not at the next refresh.
  const serverClock = useServerNow(view.kind === "waiting" || view.kind === "lapsed" ? view.state.serverNow : null, view.kind === "waiting" ? [view.item.expiresAt] : [])
  // Deadlines are judged on the server's clock, never the device's.
  const clockOffset = useRef(0)
  clockOffset.current = serverClock - Date.now()
  useEffect(() => {
    if (!waitingId) return
    const poll = async () => {
      try {
        const state = await readExtensions(bookingId)
        const item = isExtensionState(state) ? state.history.find(row => row.id === waitingId) : undefined
        if (item && state) settle(item, state)
      } catch { /* keep waiting; the next tick or a notice will update */ }
    }
    const timer = window.setInterval(() => {
      if (Date.now() + clockOffset.current > waitingUntil) { window.clearInterval(timer); return }
      void poll()
    }, POLL_MS)
    // One read just after the deadline, so the server's own expiry (the exact-deadline timer) replaces the closed box promptly.
    const afterDeadline = window.setTimeout(() => void poll(), Math.max(0, waitingUntil - 60_000 - (Date.now() + clockOffset.current)) + 8_000)
    return () => { window.clearInterval(timer); window.clearTimeout(afterDeadline) }
  }, [bookingId, waitingId, waitingUntil, settle])

  const duration = (minutes: number) => isQuickPick(minutes)
    ? t(`sxDuration${minutes}`, { defaultValue: minutes === 30 ? "30 more minutes" : minutes === 60 ? "1 more hour" : "2 more hours" })
    : t("sxDurationOther", { defaultValue: "{length} more", length: lengthText(minutes, (key, options) => String(t(key as never, options as never)), "sx") })
  const button = (
    <Button type="button" variant="outline" className={className} disabled={view.kind === "loading"} onClick={() => void open()}>
      {view.kind === "loading" ? <Loader2 className="h-4 w-4 mr-2 shrink-0 animate-spin" /> : <Clock className="h-4 w-4 mr-2 shrink-0" />}
      {t("kciIsNeedMoreTime", { defaultValue: "Need more time?" })}
    </Button>
  )
  if (view.kind === "idle" || view.kind === "loading") return button

  if (view.kind === "unavailable") {
    const state = view.state
    const reason = state?.unavailableReason || (!state ? t("wfbExtensionFailed")
      : !state.enabled ? t("wfbExtensionDisabled")
      : !state.hasSavedCard ? t("wfbExtensionNoCard")
      : state.endAt && !state.canRequest ? t("wfbExtensionLater", { time: clock(new Date(Date.parse(state.endAt) - 3_600_000).toISOString(), state.timezone) })
      : t("wfbExtensionDisabled"))
    return <div className="space-y-2" data-testid="extension-unavailable">
      {button}
      <p className="text-sm text-muted-foreground" role="status">{reason}</p>
      <Button type="button" variant="outline" className={className} onClick={() => onMessage(moreTimeDraft)}>
        <MessageSquare className="mr-2 h-4 w-4 shrink-0" />{t("sxMessageKitchen", { kitchen: kitchenName })}
      </Button>
    </div>
  }

  const state = view.state
  if (view.kind === "card_failed") return <div className="space-y-2 rounded-lg border p-3">
    <p role={view.item.cardFailedAt ? "alert" : "status"} className="text-sm">{t(view.item.cardFailedAt ? "sxCardFailed" : "sxFinishCheckout")}</p>
    <Button type="button" onClick={() => void checkoutExtension(bookingId, view.item).catch(failure => setError(failure.message))}>{t(view.item.cardFailedAt ? "sxAnotherCard" : "sxPay", { amount: money(view.item.amountCents, state.currency, locale) })}</Button>
    <Button type="button" variant="outline" onClick={() => onMessage()}>{t("sxMessageKitchen", { kitchen: kitchenName })}</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
  const lapsedItem = view.kind === "lapsed" ? view.item : view.kind === "waiting" && lapsedAt(view.item, serverClock) ? view.item : null
  if (lapsedItem) return (
    <div className="space-y-2 rounded-lg border p-3" role="status" data-testid="extension-lapsed">
      <p className="text-sm">{t("sxLapsed", { defaultValue: "{kitchen} didn’t answer in time. Your {amount} hold is being released — you won’t be charged.",
        kitchen: kitchenName, amount: money(lapsedItem.amountCents, state.currency, locale) })}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" className={className} onClick={() => void open(true)}>{t("sxAskAgain", { defaultValue: "Ask again" })}</Button>
        <Button type="button" variant="outline" className={className} onClick={() => onMessage()}>
          <MessageSquare className="h-4 w-4 mr-2 shrink-0" />{t("sxMessageKitchen", { defaultValue: "Message {kitchen}", kitchen: kitchenName })}
        </Button>
      </div>
    </div>
  )
  if (view.kind === "waiting") return (
    <div className="space-y-1 rounded-lg border p-3" role="status" data-testid="extension-waiting">
      <p className="text-sm font-medium flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
        {t("sxWaiting", { defaultValue: "Waiting for {kitchen} · we’ll let you know", kitchen: kitchenName })}</p>
      <p className="text-xs text-muted-foreground">{t("sxWaitingDetail", { defaultValue: "You asked to stay until {time} ({duration}). {amount} is on hold and is charged only if {kitchen} approves; otherwise the hold is released.",
        amount: money(view.item.amountCents, state.currency, locale), duration: duration(view.item.minutes), time: clock(view.item.endAt, state.timezone), kitchen: kitchenName })}</p>
    </div>
  )
  if (view.kind === "confirmed") return (
    <div className="space-y-1 rounded-lg border border-success/40 p-3" role="status" data-testid="extension-confirmed">
      <p className="text-sm font-medium flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success shrink-0" aria-hidden />
        {t("sxConfirmed", { defaultValue: "You have until {time}.", time: clock(view.item.endAt, state.timezone) })}</p>
      <p className="text-xs text-muted-foreground">{view.item.free
        ? t("sxFreeGranted", { defaultValue: "{kitchen} gave you this time at no charge; the hold on your card was released.", kitchen: kitchenName })
        : t("sxChargedNote", { defaultValue: "{amount} was charged to your saved card.", amount: money(view.item.amountCents, state.currency, locale) })}</p>
    </div>
  )
  const messageInstead = (
    <Button type="button" variant="outline" className={className} onClick={() => onMessage()}>
      <MessageSquare className="h-4 w-4 mr-2 shrink-0" />{t("sxMessageKitchen", { defaultValue: "Message {kitchen}", kitchen: kitchenName })}
    </Button>
  )
  if (view.kind === "declined") return (
    <div className="space-y-2 rounded-lg border p-3" role="status" data-testid="extension-declined">
      <p className="text-sm">{t("sxDeclined", { defaultValue: "{kitchen} couldn’t extend this time. Your card wasn’t charged.", kitchen: kitchenName })}</p>
      {messageInstead}
    </div>
  )
  if (view.kind === "offer_open") return (
    <div className="space-y-2 rounded-lg border p-3" role="status" data-testid="extension-offer-open">
      <p className="text-sm">{t("sxOfferOpen", { defaultValue: "{kitchen} already offered you more time. Accept or decline that offer above.", kitchen: kitchenName })}</p>
    </div>
  )
  if (view.kind === "booked") return (
    <div className="space-y-2 rounded-lg border p-3" role="status" data-testid="extension-booked">
      <p className="text-sm">{t(view.state.noTimeReason === "closing" ? "sxNoTimeClosing" : view.state.noTimeReason === "max_length" ? "sxNoTimeMaxLength"
        : view.state.noTimeReason === "turnover" ? "sxNoTimeTurnover" : "sxBookedAfter", { defaultValue: "The kitchen is booked right after you. Message {kitchen}.", kitchen: kitchenName })}</p>
      {messageInstead}
    </div>
  )
  const busy = view.kind === "busy"
  const quick = state.options.filter(option => isQuickPick(option.minutes))
  const chosen = custom.minutes == null ? undefined : state.options.find(option => option.minutes === custom.minutes)
  const optionLabel = (option: ExtensionOption) => state.autoApprove
    ? t("sxAddUntil", { defaultValue: "Add until {time} · {amount}", time: clock(option.endAt, state.timezone), amount: money(option.amountCents, state.currency, locale) })
    : t("sxRequestUntil", { defaultValue: "Request until {time} · up to {amount}", time: clock(option.endAt, state.timezone), amount: money(option.amountCents, state.currency, locale) })
  return (
    <div className="space-y-2 rounded-lg border p-3" data-testid="extension-options">
      <p className="text-sm font-medium">{t("sxChooseTime", { defaultValue: "How much more time do you need?" })}</p>
      <ul className="space-y-2">
        {quick.map(option => (
          <li key={option.minutes}>
            <Button type="button" variant="outline" className={`${className || ""} justify-between`} disabled={busy} onClick={() => void choose(state, option)}
              aria-label={t("sxOptionAria", { defaultValue: "{duration}, until {time}, {amount}", duration: duration(option.minutes), time: clock(option.endAt, state.timezone), amount: money(option.amountCents, state.currency, locale) })}>
              {state.autoApprove ? <>
                <span>{t("sxOptionUntil", { defaultValue: "Until {time}", time: clock(option.endAt, state.timezone) })}</span>
                <span className="tabular-nums">{money(option.amountCents, state.currency, locale)}</span>
              </> : <span>{t("sxRequestUntil", { defaultValue: "Request until {time} · up to {amount}", time: clock(option.endAt, state.timezone), amount: money(option.amountCents, state.currency, locale) })}</span>}
            </Button>
          </li>
        ))}
      </ul>
      {!custom.open ? <Button type="button" variant="ghost" className={`${className || ""} justify-start`} disabled={busy}
        onClick={() => setCustom({ open: true, minutes: null })}>{t("sxChooseOther", { defaultValue: "Choose a time…" })}</Button>
        : <div className="space-y-2 rounded-md border p-2" data-testid="extension-custom">
          <label htmlFor={`extension-end-${bookingId}`} className="block text-sm font-medium">{t("sxNewEndLabel", { defaultValue: "New end time" })}</label>
          <Select disabled={busy} value={custom.minutes == null ? EMPTY : String(custom.minutes)}
            onValueChange={value => setCustom({ open: true, minutes: value === EMPTY ? null : Number(value) })}>
            <SelectTrigger id={`extension-end-${bookingId}`} className="min-h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY}>{t("sxPickEnd", { defaultValue: "Pick a time" })}</SelectItem>
              {state.options.map(option => <SelectItem key={option.minutes} value={String(option.minutes)}>
                {t("sxUntilLength", { defaultValue: "Until {time} ({duration})", time: clock(option.endAt, state.timezone), duration: duration(option.minutes) })}</SelectItem>)}
            </SelectContent>
          </Select>
          {chosen && <>
            <p className="text-sm tabular-nums" data-testid="extension-custom-summary">{t("sxSummaryUntil", { defaultValue: "Until {time} · {amount}", time: clock(chosen.endAt, state.timezone), amount: money(chosen.amountCents, state.currency, locale) })}</p>
            <Button type="button" className={className} disabled={busy} onClick={() => void choose(state, chosen)}>{optionLabel(chosen)}</Button>
          </>}
        </div>}
      <p className="text-xs text-muted-foreground">{state.autoApprove
        ? t("sxInstantHint", { defaultValue: "The time is free, so it’s confirmed right away and charged to your saved card." })
        : t("sxOnlyIfCharged", { defaultValue: "You’re only charged if {kitchen} approves with a charge.", kitchen: kitchenName })}</p>
      <p className="text-xs text-muted-foreground">{t("sxNoRefund", { defaultValue: "Extra time can’t be refunded once it’s added." })}</p>
      {busy && <p className="text-xs flex items-center gap-2" role="status"><Loader2 className="h-3 w-3 animate-spin" aria-hidden />{t("sxWorking", { defaultValue: "Checking with your bank…" })}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        {messageInstead}
        <Button type="button" variant="ghost" className={className} disabled={busy} onClick={() => { setError(""); setCustom({ open: false, minutes: null }); setView({ kind: "idle" }) }}>{t("sxNotNow", { defaultValue: "Not now" })}</Button>
      </div>
    </div>
  )
}
