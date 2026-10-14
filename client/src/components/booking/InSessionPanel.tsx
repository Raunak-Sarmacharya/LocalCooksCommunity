/**
 * InSessionPanel
 *
 * Chef "in-session" screen: shown on the visit page after arrival is recorded and
 * before departure is recorded. The countdown ticks locally from the saved booked
 * end (no polling of its own); data refreshes on window focus/visibility only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Clock, LifeBuoy, LogOut, MessageSquare, ShieldAlert, Mail, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { getAuthHeaders } from "@/lib/api"
import { friendlyTimezoneName } from "@shared/timezone-utils"
import UnifiedChatView from "@/components/chat/UnifiedChatView"

export const SESSION_ENDING_WINDOW_MINUTES = 15
const TICK_MS = 30_000
export const PROBLEM_CATEGORIES = ["safety", "access", "equipment", "cleanliness", "other"] as const
export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number]
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
  /** Moves the chef to the existing departure instructions and tasks. */
  onStartCheckout: () => void
  /** Refreshes visit data; called on window focus / tab visibility only. */
  onRefresh?: () => void
  departureInstructions?: string
  requiredTaskCount?: number
}

export function InSessionPanel({
  bookingId, chefId, kitchenName, timezone, scheduledStartAt, scheduledEndAt, canCheckout, onStartCheckout, onRefresh,
  departureInstructions, requiredTaskCount = 0,
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
  const zone = friendlyTimezoneName(timezone, locale)
  const progress = Number.isFinite(startMs) && endMs > startMs ? Math.min(100, Math.max(0, ((now - startMs) / (endMs - startMs)) * 100)) : 0

  const countdown = phase === "ended" ? t("kciIsTimeEnded", { defaultValue: "Your booked time ended" })
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
  const [reportOpen, setReportOpen] = useState(false)
  const [category, setCategory] = useState<ProblemCategory | "">("")
  const [description, setDescription] = useState("")
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID())
  const [reportBusy, setReportBusy] = useState(false)
  const [reportError, setReportError] = useState("")
  const [reportSent, setReportSent] = useState(false)
  const canSend = !!category && description.trim().length >= 10 && !reportBusy
  const sendReport = async () => {
    if (!canSend) return
    setReportBusy(true); setReportError("")
    try {
      const response = await fetch(`/api/commitment-problems/booking/${bookingId}`, {
        method: "POST", headers: await getAuthHeaders(), credentials: "include",
        body: JSON.stringify({ description: description.trim(), category, requestKey }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || t("kciIsReportFailed", { defaultValue: "Could not send the report. Your text is kept; try again." }))
      setReportOpen(false); setReportSent(true); setDescription(""); setCategory(""); setRequestKey(crypto.randomUUID())
    } catch (error) {
      setReportError(error instanceof Error ? error.message : t("kciIsReportFailed", { defaultValue: "Could not send the report. Your text is kept; try again." }))
    } finally { setReportBusy(false) }
  }

  const tap = "min-h-11 w-full whitespace-normal h-auto py-2"
  return (
    <section className="rounded-2xl border bg-card p-5 sm:p-6 space-y-4" aria-labelledby="in-session-title" data-phase={phase}>
      <div className="space-y-1">
        <h2 id="in-session-title" className="text-lg font-semibold">{kitchenName}</h2>
        <p className="text-sm font-medium">{t("kciIsEndsAt", { defaultValue: "In session · ends {time} {zone}", time: endTime, zone })}</p>
      </div>

      <div className="space-y-2">
        {/* One countdown, announced politely: its text changes at most once a minute. */}
        <p className="text-2xl font-semibold tabular-nums" role="status" aria-live="polite">{countdown}</p>
        <div role="progressbar" aria-label={t("kciIsProgressLabel", { defaultValue: "Booked time used" })} aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.round(progress)} className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {phase === "active" && (
        <div className="space-y-2">
          <Button type="button" className={tap} disabled={chatBusy} onClick={() => void openChat(moreTimeDraft)}>
            <Clock className="h-4 w-4 mr-2 shrink-0" />{t("kciIsNeedMoreTime", { defaultValue: "Need more time?" })}
          </Button>
          <p className="text-xs text-muted-foreground">{t("kciIsNeedMoreTimeHint", { defaultValue: "This opens a message to the kitchen. Send it to ask; they will reply with what is possible." })}</p>
        </div>
      )}
      {phase !== "active" && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{phase === "ending"
            ? t("kciIsLast15Hint", { defaultValue: "Your booked time is almost up. Start check-out when you are finished." })
            : t("kciIsTimeEndedHint", { defaultValue: "Check out now to close your visit." })}</p>
          {canCheckout && <Button type="button" className={tap} onClick={onStartCheckout}>
            <LogOut className="h-4 w-4 mr-2 shrink-0" />{t("kciIsStartCheckout", { defaultValue: "Start check-out" })}
          </Button>}
        </div>
      )}

      <div className="space-y-2 border-t pt-4">
        {canCheckout && <>
          <Button type="button" variant="outline" className={tap} onClick={onStartCheckout}>
            <LogOut className="h-4 w-4 mr-2 shrink-0" />{t("kciIsLeaveEarly", { defaultValue: "Leave early / check out now" })}
          </Button>
          <p className="text-xs text-muted-foreground">{t("kciIsLeaveEarlyNote", { defaultValue: "Leaving early does not refund unused booked time." })}</p>
        </>}
        <Button type="button" variant="outline" className={tap} disabled={chatBusy} onClick={() => void openChat()}>
          <MessageSquare className="h-4 w-4 mr-2 shrink-0" />{chatBusy ? t("kciIsOpeningMessage", { defaultValue: "Opening conversation…" }) : t("kciIsMessageKitchen", { defaultValue: "Message kitchen" })}
        </Button>
        {chatError && <p role="alert" className="text-sm text-destructive">{chatError}</p>}
        <Button type="button" variant="outline" className={tap} onClick={() => { setReportSent(false); setReportOpen(true) }}>
          <ShieldAlert className="h-4 w-4 mr-2 shrink-0" />{t("kciIsReportProblem", { defaultValue: "Report a problem" })}
        </Button>
        {reportSent && <p role="status" className="text-sm">{t("kciIsReportSent", { defaultValue: "Report sent. You can follow it on your booking page." })}</p>}
      </div>

      <details className="rounded-lg border p-3">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
          <LifeBuoy className="h-4 w-4 shrink-0" />{t("kciIsGetHelp", { defaultValue: "Get help from Local Cooks" })}
        </summary>
        <div className="mt-2 space-y-1 text-sm">
          <a className="flex min-h-11 items-center gap-2 underline-offset-4 hover:underline" href="mailto:support@localcooks.ca"><Mail className="h-4 w-4 shrink-0" />support@localcooks.ca</a>
          <a className="flex min-h-11 items-center gap-2 underline-offset-4 hover:underline" href="tel:+17096318480"><Phone className="h-4 w-4 shrink-0" />+1 (709) 631-8480</a>
          <p className="text-xs text-muted-foreground">{t("kciIsHelpHours", { defaultValue: "Mon–Fri, 9 AM–5 PM NL time. After hours, we reply within 24 hours." })}</p>
        </div>
      </details>

      <details className="rounded-lg border p-3">
        <summary className="min-h-11 cursor-pointer text-sm font-medium flex items-center">{t("kciIsDeparturePreview", { defaultValue: "Departure instructions and tasks" })}</summary>
        <div className="mt-2 space-y-2 text-sm">
          <p className="whitespace-pre-line">{departureInstructions || t("kciNoDepartureInstructions", { defaultValue: "No departure instructions provided. Contact the kitchen manager if you need help leaving the kitchen ready." })}</p>
          <p className="text-xs text-muted-foreground">{requiredTaskCount > 0
            ? t("kciIsRequiredTasks", { defaultValue: "Required tasks before check-out: {count}", count: requiredTaskCount })
            : t("kciIsNoRequiredTasks", { defaultValue: "No required tasks before check-out." })}</p>
        </div>
      </details>

      <Dialog open={reportOpen} onOpenChange={value => { if (!reportBusy) setReportOpen(value) }}>
        <DialogContent showCloseButton className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("kciIsReportProblem", { defaultValue: "Report a problem" })}</DialogTitle>
            <DialogDescription>{t("kciIsReportIntro", { defaultValue: "Safety comes first. If anyone is in danger, call 911 before anything else." })}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={event => { event.preventDefault(); void sendReport() }}>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("kciIsCategory", { defaultValue: "What kind of problem is it?" })}</legend>
              {PROBLEM_CATEGORIES.map(value => (
                <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm">
                  <input type="radio" name="problem-category" value={value} checked={category === value} disabled={reportBusy}
                    onChange={() => setCategory(value)} className="h-4 w-4" />
                  <span>{t(`kciIsCat_${value}`, { defaultValue: value })}</span>
                </label>
              ))}
            </fieldset>
            <div className="space-y-2">
              <label htmlFor="in-session-problem-text" className="block text-sm font-medium">{t("kciIsDescribe", { defaultValue: "What happened?" })}</label>
              <Textarea id="in-session-problem-text" value={description} maxLength={2000} disabled={reportBusy} rows={4}
                onChange={event => setDescription(event.target.value)} aria-describedby="in-session-problem-hint" />
              <p id="in-session-problem-hint" className="text-xs text-muted-foreground">{t("kciIsDescribeHint", { defaultValue: "Write 10 to 2000 characters. The kitchen manager and Local Cooks will see this." })}</p>
            </div>
            {reportError && <p role="alert" className="text-sm text-destructive">{reportError}</p>}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" className="min-h-11" disabled={reportBusy} onClick={() => setReportOpen(false)}>{t("kciIsCancel", { defaultValue: "Cancel" })}</Button>
              <Button type="submit" className="min-h-11" disabled={!canSend}>{reportBusy ? t("kciIsSending", { defaultValue: "Sending…" }) : t("kciIsSendReport", { defaultValue: "Send report" })}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
