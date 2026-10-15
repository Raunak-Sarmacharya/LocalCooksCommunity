/**
 * Chef "Need more time?" (build-session-extensions.md). Loads nothing until tapped: the countdown never polls.
 * In the last hour it lists the server-priced quick picks (+30 min, +1 h, +2 h) plus "Choose a time…" (any free end in
 * 15-minute steps, priced in 30-minute blocks); one tap places a hold on the saved card
 * (the kitchen approves) or charges it at once when the kitchen approves automatically. Outside that window, or when
 * extra time is unavailable, it opens the kitchen conversation with a prefilled message, as before.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { CheckCircle2, Clock, Loader2, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createExtension, isExtensionState, isQuickPick, kitchenClock, lengthText, money, newRequestKey, readExtensions, withCardAction,
  type ExtensionItem, type ExtensionOption, type ExtensionState } from "@/lib/session-extensions"

const POLL_MS = 20_000
type View = { kind: "idle" } | { kind: "loading" } | { kind: "options"; state: ExtensionState } | { kind: "busy"; state: ExtensionState }
  | { kind: "waiting"; item: ExtensionItem; state: ExtensionState } | { kind: "confirmed"; item: ExtensionItem; state: ExtensionState }
  | { kind: "declined"; state: ExtensionState } | { kind: "booked"; state: ExtensionState }

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
    if (item.confirmed) { setView({ kind: "confirmed", item, state }); extended.current?.(); requestKey.current = newRequestKey(); return }
    if (["declined", "expired", "cancelled"].includes(item.status)) { setView({ kind: "declined", state }); requestKey.current = newRequestKey(); return }
    setView({ kind: "waiting", item, state })
  }, [])

  const open = async () => {
    setError(""); setView({ kind: "loading" })
    let state: ExtensionState | null = null
    try { const result = await readExtensions(bookingId); state = isExtensionState(result) ? result : null } catch { state = null }
    const pending = state?.history.find(item => item.kind === "request" && ["requested", "approved"].includes(item.status) && !item.confirmed)
    if (state && pending) return settle(pending, state)
    if (!state || !state.enabled || !state.canRequest || state.unavailableReason || !state.hasSavedCard) {
      setView({ kind: "idle" })
      return onMessage(moreTimeDraft)
    }
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
  const waitingId = view.kind === "waiting" ? view.item.id : null
  const waitingUntil = view.kind === "waiting" ? Date.parse(view.item.expiresAt) + 60_000 : 0
  useEffect(() => {
    if (!waitingId) return
    const timer = window.setInterval(async () => {
      if (Date.now() > waitingUntil) { window.clearInterval(timer); return }
      try {
        const state = await readExtensions(bookingId)
        const item = isExtensionState(state) ? state.history.find(row => row.id === waitingId) : undefined
        if (item && state) settle(item, state)
      } catch { /* keep waiting; the next tick or a notice will update */ }
    }, POLL_MS)
    return () => window.clearInterval(timer)
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

  const state = view.state
  if (view.kind === "waiting") return (
    <div className="space-y-1 rounded-lg border p-3" role="status" data-testid="extension-waiting">
      <p className="text-sm font-medium flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
        {t("sxWaiting", { defaultValue: "Waiting for {kitchen} · we’ll let you know", kitchen: kitchenName })}</p>
      <p className="text-xs text-muted-foreground">{t("sxWaitingDetail", { defaultValue: "{amount} is on hold on your card for {duration} (until {time}). It’s only charged if {kitchen} approves; otherwise the hold is released.",
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
  if (view.kind === "booked") return (
    <div className="space-y-2 rounded-lg border p-3" role="status" data-testid="extension-booked">
      <p className="text-sm">{t("sxBookedAfter", { defaultValue: "The kitchen is booked right after you. Message {kitchen}.", kitchen: kitchenName })}</p>
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
          <select id={`extension-end-${bookingId}`} className="block w-full min-h-11 rounded-md border bg-background p-2" disabled={busy}
            value={custom.minutes ?? ""} onChange={event => setCustom({ open: true, minutes: event.target.value ? Number(event.target.value) : null })}>
            <option value="">{t("sxPickEnd", { defaultValue: "Pick a time" })}</option>
            {state.options.map(option => <option key={option.minutes} value={option.minutes}>
              {t("sxUntilLength", { defaultValue: "Until {time} ({duration})", time: clock(option.endAt, state.timezone), duration: duration(option.minutes) })}</option>)}
          </select>
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
