import { localCooksSupportHref } from "@/components/support/ContactLocalCooks";
/**
 * InSessionPanel
 *
 * Chef "in-session" screen: shown on the visit page after arrival is recorded and
 * before departure is recorded. The countdown ticks locally from the saved booked
 * end (no polling of its own); data refreshes on window focus/visibility only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { createPortal } from "react-dom"
import { LogOut, Mail, Phone, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { BookingProblemReport } from "./BookingProblemReport"
import { getAuthHeaders } from "@/lib/api"
import UnifiedChatView from "@/components/chat/UnifiedChatView"
import { SessionExtensionRequest } from "./SessionExtensionRequest"

export const SESSION_ENDING_WINDOW_MINUTES = 15
const TICK_MS = 30_000
export { PROBLEM_CATEGORIES, type ProblemCategory } from "./BookingProblemReport"
export type SessionPhase = "active" | "ending" | "ended"

export function sessionPhase(now: number, endMs: number): SessionPhase {
  const left = endMs - now
  return left <= 0 ? "ended" : left <= SESSION_ENDING_WINDOW_MINUTES * 60_000 ? "ending" : "active"
}

interface InSessionPanelProps {
  bookingId: number
  chefId: number
  kitchenName: string
  timezone: string
  /** Saved booked start/end instants (ISO) of the current visit. */
  scheduledStartAt: string
  scheduledEndAt: string
  /** True while the existing departure flow can accept a check-out. */
  canCheckout: boolean
  /** The departure form now owns the single submit action. */
  checkoutStarted?: boolean
  /** Moves the chef to the existing departure instructions and tasks. */
  onStartCheckout: () => void
  /** Refreshes visit data; called on window focus / tab visibility only. */
  onRefresh?: () => void
  departureInstructions?: string
  requiredTaskCount?: number
  helpContainer?: HTMLElement | null
}

export function InSessionPanel({
  bookingId, chefId, kitchenName, timezone, scheduledStartAt, scheduledEndAt, canCheckout, onStartCheckout, onRefresh,
  departureInstructions, requiredTaskCount = 0, checkoutStarted = false, helpContainer,
}: InSessionPanelProps) {
  const { t, i18n } = useTranslation("chef")
  const locale = i18n.resolvedLanguage || i18n.language || "en-CA"
  const startMs = Date.parse(scheduledStartAt), endMs = Date.parse(scheduledEndAt)
  const [now, setNow] = useState(() => Date.now())
  const refresh = useRef(onRefresh)
  refresh.current = onRefresh

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS)
    const wake = () => {
      if (document.visibilityState === "hidden") return
      setNow(Date.now())
      refresh.current?.()
    }
    window.addEventListener("focus", wake)
    document.addEventListener("visibilitychange", wake)
    return () => {
      window.clearInterval(tick)
      window.removeEventListener("focus", wake)
      document.removeEventListener("visibilitychange", wake)
    }
  }, [])

  const phase = sessionPhase(now, endMs)
  const minutesLeft = Math.max(0, Math.ceil((endMs - now) / 60_000))
  const endTime = useMemo(() => new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "numeric", minute: "2-digit" })
    .format(new Date(endMs)), [locale, timezone, endMs])
    const progress = Number.isFinite(startMs) && endMs > startMs ? Math.min(100, Math.max(0, ((now - startMs) / (endMs - startMs)) * 100)) : 0

  // After the end the header already says the booking ended; the count shows how long past it the chef is.
  const minutesOver = Math.max(0, Math.floor((now - endMs) / 60_000))
  const countdown = phase === "ended" ? minutesOver < 1 ? t("kvIsJustEnded", { defaultValue: "Just ended" })
    : minutesOver >= 60 ? t("kciIsOverHM", { defaultValue: "{hours} h {minutes} min past your booking", hours: Math.floor(minutesOver / 60), minutes: minutesOver % 60 })
    : t("kciIsOverM", { defaultValue: "{minutes} min past your booking", minutes: minutesOver })
    : minutesLeft < 1 ? t("kciIsLeftLessMinute", { defaultValue: "Less than a minute left" })
    : minutesLeft >= 60 ? t("kciIsLeftHM", { defaultValue: "{hours} h {minutes} min left", hours: Math.floor(minutesLeft / 60), minutes: minutesLeft % 60 })
    : t("kciIsLeftM", { defaultValue: "{minutes} min left", minutes: minutesLeft })

  // ── Messaging (existing booking conversation) ────────────────────────────────
  const [chat, setChat] = useState<{ conversationId: string; draft?: string } | null>(null)
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState("")
  const openChat = useCallback(async (draft?: string) => {
    if (chatBusy) return
    setChatBusy(true); setChatError("")
    try {
      const response = await fetch(`/api/bookings/${bookingId}/conversation`, { method: "POST", headers: await getAuthHeaders(), credentials: "include" })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.conversationId) throw new Error(result.error || t("kciIsMessageFailed", { defaultValue: "Could not open the conversation. Try again or contact Local Cooks." }))
      setChat({ conversationId: result.conversationId, draft })
    } catch (error) {
      setChatError(error instanceof Error ? error.message : t("kciIsMessageFailed", { defaultValue: "Could not open the conversation. Try again or contact Local Cooks." }))
    } finally { setChatBusy(false) }
  }, [bookingId, chatBusy, t])
  const moreTimeDraft = t("kciIsMoreTimeMessage", { defaultValue: "Hi, could I have more time at {kitchen}? My booking ends at {time}.", kitchen: kitchenName, time: endTime })

  // ── Report a problem (existing commitment-problems API) ──────────────────────

  const tap = "min-h-11 w-full whitespace-normal h-auto py-2 sm:w-auto"
  const link = "inline-flex min-h-11 items-center rounded-md px-1 focus-visible:ring-2 focus-visible:ring-ring text-sm underline-offset-4 hover:underline disabled:opacity-50"
  const [helpOpen, setHelpOpen] = useState(false)
  const help = <>
      <div className="flex flex-wrap items-center gap-x-3 text-sm">
        <button type="button" className={link} disabled={chatBusy} onClick={() => void openChat()}>
          <MessageSquare className="mr-2 h-4 w-4" aria-hidden="true" />
          {chatBusy ? t("kciIsOpeningMessage", { defaultValue: "Opening conversation…" }) : t("kciIsMessageKitchen", { defaultValue: "Message kitchen" })}
        </button>
        <BookingProblemReport bookingId={bookingId} />
        <button type="button" className={link} aria-expanded={helpOpen} onClick={() => setHelpOpen(value => !value)}>{t("kvIsHelp", { defaultValue: "Get help" })}</button>
      </div>
      {chatError && <p role="alert" className="text-sm text-destructive">{chatError}</p>}

      {helpOpen && <div className="space-y-1 rounded-lg bg-muted/40 p-3 text-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150">
        <a className="flex min-h-11 items-center gap-2 underline-offset-4 hover:underline" href={localCooksSupportHref({ bookingId, role: "chef", situation: "Help during kitchen visit" })}><Mail className="h-4 w-4 shrink-0" />support@localcooks.ca</a>
        <a className="flex min-h-11 items-center gap-2 underline-offset-4 hover:underline" href="tel:+17096318480"><Phone className="h-4 w-4 shrink-0" />+1 (709) 631-8480</a>
        <p className="text-xs text-muted-foreground">{t("kciIsHelpHours", { defaultValue: "Mon–Fri, 9 AM–5 PM NL time. After hours, we reply within 24 hours." })}</p>
      </div>}

  </>
  return (
    <section className="rounded-2xl border border-border/70 bg-card p-4 sm:p-6 space-y-4" aria-label={t("kciInSessionTitle", { defaultValue: "Your visit" })} data-phase={phase}>
      <div className="space-y-2">
        {phase !== "ended" && <h2 className="text-base font-semibold">{t("kciCookingEnds", { defaultValue: "Cooking now · ends {time}", time: endTime })}</h2>}
        {/* One countdown, announced politely: its text changes at most once a minute. */}
        <div>
          <p className="text-[22px] font-semibold leading-7 tabular-nums" role="status" aria-live="polite">{countdown}</p>
          {phase === "ended" && <p className="text-[13px] leading-[18px] text-muted-foreground tabular-nums">{t("kvIsEndedAt", { defaultValue: "Ended at {time}", time: endTime })}</p>}
        </div>
        <div role="progressbar" aria-label={t("kciIsProgressLabel", { defaultValue: "Booked time used" })} aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.round(progress)} className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary motion-safe:transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {phase === "ending" && <p className="text-sm">{t("kvIsLast15Hint", { defaultValue: "Your booked time is almost up. Check out when you’re finished." })}</p>}
      {/* One row of actions. Outside the last 15 minutes there is no filled button: nothing is urgent. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {phase !== "active" && canCheckout && !checkoutStarted && <Button type="button" className={tap} onClick={onStartCheckout}>
          <LogOut className="h-4 w-4 mr-2 shrink-0" />{t("kciIsCheckOutNow", { defaultValue: "Check out now" })}
        </Button>}
        {phase !== "ended" && <SessionExtensionRequest bookingId={bookingId} kitchenName={kitchenName} timezone={timezone} className={tap}
          moreTimeDraft={moreTimeDraft} onMessage={draft => void openChat(draft)} onExtended={() => refresh.current?.()} />}
        {phase === "active" && canCheckout && !checkoutStarted && <Button type="button" variant="outline" className={tap} onClick={onStartCheckout}>
          <LogOut className="h-4 w-4 mr-2 shrink-0" />{t("kvIsCheckOutEarly", { defaultValue: "Check out early" })}
        </Button>}
      </div>

      {helpContainer ? createPortal(help, helpContainer) : help}


      <details className="rounded-lg border p-3">
        <summary className="min-h-11 cursor-pointer text-sm font-medium flex items-center">{t("kciIsDeparturePreview", { defaultValue: "Departure instructions and tasks" })}</summary>
        <div className="mt-2 space-y-2 text-sm">
          <p className="whitespace-pre-line">{departureInstructions || t("kciNoDepartureInstructions", { defaultValue: "No departure instructions provided. Contact the kitchen manager if you need help leaving the kitchen ready." })}</p>
          <p className="text-xs text-muted-foreground">{requiredTaskCount > 0
            ? t("kciIsRequiredTasks", { defaultValue: "Required tasks before check-out: {count}", count: requiredTaskCount })
            : t("kciIsNoRequiredTasks", { defaultValue: "No required tasks before check-out." })}</p>
        </div>
      </details>



      <Dialog open={!!chat} onOpenChange={value => { if (!value) setChat(null) }}>
        <DialogContent showCloseButton className="flex h-[85dvh] w-[calc(100%_-_1rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
          <div className="min-w-0 shrink-0 border-b px-5 py-4 pr-14">
            <DialogTitle>{t("kciIsMessageKitchen", { defaultValue: "Message kitchen" })}</DialogTitle>
            <DialogDescription>{kitchenName}</DialogDescription>
          </div>
          {chat && <div className="min-h-0 flex-1 overflow-hidden">
            <UnifiedChatView userId={chefId} role="chef" initialDraft={chat.draft} initialConversationId={chat.conversationId} hideConversationList />
          </div>}
        </DialogContent>
      </Dialog>
    </section>
  )
}
