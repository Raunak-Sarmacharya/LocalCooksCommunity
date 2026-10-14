/**
 * VisitCodePanel
 *
 * Manager surface for the arrival visit code of one owned booking (one card per visit target).
 * Shows the current code while the visit is staffed and unconsumed; afterwards only the method and time.
 * The code is rendered here only. It is never logged, put in a toast, a URL or a query key.
 */
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, RefreshCw, ShieldCheck, UserCheck } from "lucide-react"
import { toast } from "sonner"
import { apiClient } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { friendlyTimezoneName, createBookingDateTime } from "@shared/timezone-utils"
import { calendarDateForBookingTime } from "@shared/operating-hours"
import { VISIT_CODE_MAX_ATTEMPTS, type ManagerVisitCodeResponse, type ManagerVisitCodeState } from "@shared/visit-code"

export const SELF_REASON_MIN = 10
export const SELF_REASON_MAX = 500

export interface VisitCodePanelVisit { id: number; blockIndex: number; startTime: string; endTime: string }

interface VisitCodePanelProps {
  bookingId: number
  customerName?: string
  kitchenName?: string
  timezone?: string | null
  bookingDate: string
  operatingWindowStartTime?: string | null
  /** Booking-level hours, used when the target is not a split visit. */
  startTime: string
  endTime: string
  visits?: VisitCodePanelVisit[]
  /** Only a confirmed booking can have an active code to show; others render recorded history only. */
  bookingStatus?: string
  onChanged?: () => void | Promise<void>
  /**
   * Inside the booking page's Visit card: no own heading or card, no repeated chef/kitchen/time
   * (the page header shows them), and a sentence instead of an empty block.
   */
  embedded?: boolean
  /** The visit is over: only the arrival method/time is shown, never a code. */
  visitEnded?: boolean
}

type Action = { kind: "issue" | "self" | "staffed"; target: ManagerVisitCodeState }

export const groupVisitCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`

/** Poll from this long before a visit starts until it ends, so an arrival or lock shows without a reload. */
export const POLL_LEAD_MINUTES = 30
export const POLL_INTERVAL_MS = 30_000

const queryKey = (bookingId: number) => [`/api/manager/bookings/${bookingId}/visit-code`]

async function readError(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({}))
  return typeof body.error === "string" && body.error ? body.error : fallback
}

export function VisitCodePanel({ bookingId, customerName, kitchenName, timezone, bookingDate, operatingWindowStartTime, startTime, endTime,
  visits = [], bookingStatus, onChanged, embedded = false, visitEnded = false }: VisitCodePanelProps) {
  const { t, i18n } = useTranslation("manager")
  const locale = i18n?.resolvedLanguage || i18n?.language || "en-CA"
  const queryClient = useQueryClient()
  const [action, setAction] = useState<Action | null>(null)
  const [reason, setReason] = useState("")
  const [allVisits, setAllVisits] = useState(false)
  const [reasonTouched, setReasonTouched] = useState(false)
  const [dialogError, setDialogError] = useState("")

  // Active = confirmed, not consumed/revoked, and inside [start - lead, end]. Anything else needs no timer.
  const windowOpen = (target: ManagerVisitCodeState) => {
    if (!timezone) return true
    const visit = target.visitId ? visits.find(row => row.id === target.visitId) : undefined
    const start = visit?.startTime ?? startTime, end = visit?.endTime ?? endTime
    try {
      const day = bookingDate.split("T")[0]
      const begins = createBookingDateTime(calendarDateForBookingTime(day, start, operatingWindowStartTime), start, timezone)
      const ends = createBookingDateTime(calendarDateForBookingTime(day, end, operatingWindowStartTime, start), end, timezone)
      const now = Date.now()
      return now >= begins.getTime() - POLL_LEAD_MINUTES * 60_000 && now <= ends.getTime()
    } catch { return true }
  }
  const pollActive = (data?: ManagerVisitCodeResponse) =>
    bookingStatus === "confirmed" && !!data?.targets?.some(target => !target.consumed && !target.revoked && windowOpen(target))

  const query = useQuery<ManagerVisitCodeResponse>({
    queryKey: queryKey(bookingId),
    queryFn: async () => {
      const response = await apiClient.get(`/manager/bookings/${bookingId}/visit-code`)
      if (!response.ok) throw new Error(await readError(response, t("visitCodeLoadFailed", { defaultValue: "Could not load the visit code." })))
      return response.json()
    },
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: current => (pollActive(current.state.data) ? POLL_INTERVAL_MS : false),
  })

  const refetchVisitCode = query.refetch
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible" && pollActive(query.data)) void refetchVisitCode() }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, refetchVisitCode, bookingStatus])

  const mutation = useMutation({
    mutationFn: async (input: { path: "issue" | "mode"; body: Record<string, unknown> }) => {
      const response = await apiClient.post(`/manager/bookings/${bookingId}/visit-code/${input.path}`, input.body)
      if (!response.ok) throw new Error(await readError(response, t("visitCodeActionFailed", { defaultValue: "Could not update the visit code." })))
      return (await response.json()) as ManagerVisitCodeResponse
    },
    onSuccess: async data => {
      queryClient.setQueryData(queryKey(bookingId), data)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [`/api/manager/bookings/${bookingId}/details`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/manager/bookings/${bookingId}/attendance`] }),
      ])
      // The change is already saved; a failed page refresh must not read as a failed change.
      try { await onChanged?.() } catch { /* the page's own refresh control recovers */ }
    },
  })

  const targets = query.data?.targets ?? []
  const zone = timezone || undefined

  const whenLabel = (target: ManagerVisitCodeState) => {
    if (!zone) return ""
    const visit = target.visitId ? visits.find(row => row.id === target.visitId) : undefined
    const start = visit?.startTime ?? startTime, end = visit?.endTime ?? endTime
    try {
      const day = bookingDate.split("T")[0]
      const begins = createBookingDateTime(calendarDateForBookingTime(day, start, operatingWindowStartTime), start, zone)
      const ends = createBookingDateTime(calendarDateForBookingTime(day, end, operatingWindowStartTime, start), end, zone)
      const date = new Intl.DateTimeFormat(locale, { timeZone: zone, dateStyle: "medium" }).format(begins)
      const time = new Intl.DateTimeFormat(locale, { timeZone: zone, timeStyle: "short", hour12: true })
      return `${date}, ${time.format(begins)} – ${time.format(ends)} ${friendlyTimezoneName(zone, locale)}`
    } catch { return "" }
  }
  const consumedLabel = (target: ManagerVisitCodeState) => {
    const time = target.consumedAt && zone
      ? new Intl.DateTimeFormat(locale, { timeZone: zone, timeStyle: "short", hour12: true }).format(new Date(target.consumedAt)) : ""
    const key = target.consumedMethod === "self" ? "visitCodeArrivedSelf" : target.consumedMethod === "assisted" ? "visitCodeArrivedAssisted" : "visitCodeArrivedCode"
    const fallback = target.consumedMethod === "self" ? "Arrived {time} with self check-in"
      : target.consumedMethod === "assisted" ? "Arrived {time}, added by the kitchen" : "Arrived {time} with the visit code"
    return t(key, { defaultValue: fallback, time })
  }
  const visitName = (target: ManagerVisitCodeState) => {
    const visit = target.visitId ? visits.find(row => row.id === target.visitId) : undefined
    return visit ? t("visitCodeVisitN", { defaultValue: "Visit {number}", number: visit.blockIndex + 1 }) : ""
  }

  const open = (kind: Action["kind"], target: ManagerVisitCodeState) => {
    setAction({ kind, target }); setReason(""); setAllVisits(false); setReasonTouched(false); setDialogError("")
  }
  const close = () => { if (!mutation.isPending) setAction(null) }
  const trimmed = reason.trim()
  const reasonValid = trimmed.length >= SELF_REASON_MIN && trimmed.length <= SELF_REASON_MAX

  const confirm = async () => {
    if (!action || mutation.isPending) return
    setDialogError("")
    try {
      if (action.kind === "issue") {
        await mutation.mutateAsync({ path: "issue", body: { target: action.target.targetKey } })
        toast.success(t("visitCodeIssuedToast", { defaultValue: "New visit code issued. The old code no longer works." }))
      } else if (action.kind === "self") {
        if (!reasonValid) { setReasonTouched(true); return }
        await mutation.mutateAsync({ path: "mode", body: { ...(allVisits ? { all: true } : { target: action.target.targetKey }), mode: "self", reason: trimmed } })
        toast.success(t("visitCodeSelfToast", { defaultValue: "Self check-in is on for this visit." }))
      } else {
        await mutation.mutateAsync({ path: "mode", body: { target: action.target.targetKey, mode: "staffed" } })
        toast.success(t("visitCodeStaffedToast", { defaultValue: "Switched back to staffed check-in with a new code." }))
      }
      setAction(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : t("visitCodeActionFailed", { defaultValue: "Could not update the visit code." })
      setDialogError(message)
      toast.error(message)
    }
  }

  if (embedded && bookingStatus === "pending") {
    return <p className="text-sm text-muted-foreground" data-testid="visit-code-empty">{t("visitCodeEmptyPending", { defaultValue: "A visit code is created when you confirm this request." })}</p>
  }
  if (query.isPending) return <p role="status" className="text-sm text-muted-foreground">{t("visitCodeLoading", { defaultValue: "Loading visit code…" })}</p>
  if (query.isError) {
    return (
      <section className="rounded-2xl border bg-card p-5 space-y-2" aria-label={t("visitCodeTitle", { defaultValue: "Visit code" })}>
        <p role="alert" className="text-sm text-destructive">{query.error.message}</p>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => void query.refetch()}>{t("visitCodeRetry", { defaultValue: "Try again" })}</Button>
      </section>
    )
  }
  // Legacy bookings (no challenge) and inactive bookings without a recorded arrival have nothing to show.
  const visible = targets.filter(target => target.consumed || (!visitEnded && !target.revoked && bookingStatus !== "cancelled"))
  if (!visible.length) {
    // No challenge at all: say so instead of leaving an empty heading.
    if (embedded && !targets.length && bookingStatus === "confirmed" && !visitEnded) {
      return <p className="text-sm text-muted-foreground" data-testid="visit-code-empty">{t("visitCodeEmptyLegacy", { defaultValue: "This booking uses tap check-in; no code needed." })}</p>
    }
    return null
  }
  if (embedded && visible.every(target => target.consumed)) {
    return (
      <ul className="space-y-1" aria-label={t("visitCodeTitle", { defaultValue: "Visit code" })}>
        {visible.map(target => (
          <li key={target.targetKey} className="flex items-center gap-2 text-sm" data-testid="visit-code-consumed">
            <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            {visitName(target) ? `${visitName(target)} · ` : ""}{consumedLabel(target)}
          </li>
        ))}
      </ul>
    )
  }

  const modeSelf = action?.kind === "self"
  const multiple = targets.filter(target => !target.consumed && !target.revoked).length > 1
  const dialogTitle = !action ? "" : action.kind === "issue" ? t("visitCodeIssueTitle", { defaultValue: "Issue a new visit code?" })
    : modeSelf ? t("visitCodeSelfTitle", { defaultValue: "Set up self check-in?" })
      : t("visitCodeStaffedTitle", { defaultValue: "Switch back to staffed check-in?" })
  const dialogBody = !action ? "" : action.kind === "issue"
    ? t("visitCodeIssueBody", { defaultValue: "The current code stops working immediately. Give the new code to the chef when they arrive." })
    : modeSelf ? t("visitCodeSelfBody", { defaultValue: "The chef will be able to confirm their arrival without staff and without a code. The kitchen must provide access instructions for this visit. The current code stops working." })
      : t("visitCodeStaffedBody", { defaultValue: "Self check-in is turned off and a new visit code is issued. The chef will need the code from kitchen staff." })

  return (
    <section className={embedded ? "space-y-3" : "rounded-2xl border bg-card p-5 sm:p-6 space-y-4"} aria-label={t("visitCodeTitle", { defaultValue: "Visit code" })}>
      {!embedded && <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">{t("visitCodeTitle", { defaultValue: "Visit code" })}</h2>
      </div>}
      <div className="space-y-4">
        {visible.map(target => {
          const name = visitName(target)
          const when = whenLabel(target)
          const staffed = target.mode === "staffed"
          return (
            <article key={target.targetKey} className="rounded-xl border p-4 space-y-3" data-testid={`visit-code-${target.targetKey}`}>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {name && <div><dt className="text-xs text-muted-foreground">{t("visitCodeVisit", { defaultValue: "Visit" })}</dt><dd className="font-medium">{name}</dd></div>}
                {!embedded && <div><dt className="text-xs text-muted-foreground">{t("visitCodeCustomer", { defaultValue: "Chef" })}</dt><dd className="font-medium">{customerName || t("visitCodeNameUnavailable", { defaultValue: "Name unavailable" })}</dd></div>}
                {!embedded && <div><dt className="text-xs text-muted-foreground">{t("visitCodeKitchen", { defaultValue: "Kitchen" })}</dt><dd className="font-medium">{kitchenName || "—"}</dd></div>}
                {when && (!embedded || name) && <div><dt className="text-xs text-muted-foreground">{t("visitCodeWhen", { defaultValue: "Visit time (kitchen local)" })}</dt><dd className="font-medium tabular-nums">{when}</dd></div>}
                <div><dt className="text-xs text-muted-foreground">{t("visitCodeMode", { defaultValue: "Check-in mode" })}</dt>
                  <dd className="font-medium">{staffed ? t("visitCodeModeStaffed", { defaultValue: "Staff gives the code" }) : t("visitCodeModeSelf", { defaultValue: "Self check-in" })}</dd></div>
              </dl>

              {target.consumed ? (
                <p className="flex items-center gap-2 text-sm font-medium" data-testid="visit-code-consumed">
                  <ShieldCheck className="h-4 w-4 shrink-0" />{consumedLabel(target)}
                </p>
              ) : (
                <>
                  {staffed ? (
                    <div className="space-y-2">
                      {target.code ? (
                        <div>
                          <p className="text-xs text-muted-foreground">{t("visitCodeGiveHint", { defaultValue: "Give this code to the chef in person when they arrive." })}</p>
                          <p className="mt-1 text-4xl font-semibold tabular-nums tracking-[0.2em] sm:text-5xl" data-testid="visit-code-value"
                            aria-label={t("visitCodeA11y", { defaultValue: "Visit code {digits}", digits: target.code.split("").join(" ") })}>{groupVisitCode(target.code)}</p>
                        </div>
                      ) : target.codeUnavailable ? (
                        <p role="alert" className="text-sm text-destructive">{t("visitCodeUnavailable", { defaultValue: "The code cannot be shown right now. Try again shortly or contact Local Cooks." })}</p>
                      ) : null}
                      <p className="text-sm text-muted-foreground">{t("visitCodeAttempts", { defaultValue: "Wrong attempts: {used} of {max}", used: target.failedAttempts, max: VISIT_CODE_MAX_ATTEMPTS })}</p>
                      {target.locked && <p role="alert" className="text-sm font-medium text-destructive">{t("visitCodeLockedState", { defaultValue: "Locked after too many wrong attempts. Issue a new code to unlock." })}</p>}
                    </div>
                  ) : (
                    <div className="space-y-1 text-sm">
                      <p>{t("visitCodeSelfActive", { defaultValue: "The chef can confirm arrival without a code. Make sure they have the access instructions for this visit." })}</p>
                      {target.modeReason && <p className="text-muted-foreground">{t("visitCodeReasonShown", { defaultValue: "Reason: {reason}", reason: target.modeReason })}</p>}
                    </div>
                  )}
                  {!target.revoked && (
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      {staffed ? (
                        <>
                          <Button type="button" variant="outline" className="min-h-11" onClick={() => open("issue", target)}>
                            <RefreshCw className="mr-2 h-4 w-4" />{t("visitCodeIssueNew", { defaultValue: "Issue new code" })}
                          </Button>
                          <Button type="button" variant="outline" className="min-h-11" onClick={() => open("self", target)}>
                            <UserCheck className="mr-2 h-4 w-4" />{t("visitCodeSelfSetup", { defaultValue: "Set up self check-in" })}
                          </Button>
                        </>
                      ) : (
                        <Button type="button" variant="outline" className="min-h-11" onClick={() => open("staffed", target)}>
                          {t("visitCodeBackToStaffed", { defaultValue: "Switch back to staffed" })}
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )}
            </article>
          )
        })}
      </div>

      <Dialog open={!!action} onOpenChange={value => { if (!value) close() }}>
        <DialogContent showCloseButton className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogBody}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={event => { event.preventDefault(); void confirm() }}>
            {modeSelf && (
              <>
                <div className="space-y-2">
                  <label htmlFor={`visit-code-reason-${bookingId}`} className="block text-sm font-medium">
                    {t("visitCodeReasonLabel", { defaultValue: "Reason (required)" })}
                  </label>
                  <Textarea id={`visit-code-reason-${bookingId}`} value={reason} rows={3} maxLength={SELF_REASON_MAX} disabled={mutation.isPending}
                    aria-invalid={reasonTouched && !reasonValid} aria-describedby={`visit-code-reason-help-${bookingId}`}
                    onChange={event => setReason(event.target.value)} onBlur={() => setReasonTouched(true)} />
                  <p id={`visit-code-reason-help-${bookingId}`} className="text-xs text-muted-foreground">
                    {t("visitCodeReasonHelp", { defaultValue: "Write {min} to {max} characters. It is saved with this change.", min: SELF_REASON_MIN, max: SELF_REASON_MAX })}
                  </p>
                </div>
                {multiple && (
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={allVisits} disabled={mutation.isPending} onChange={event => setAllVisits(event.target.checked)} />
                    <span>{t("visitCodeAllVisits", { defaultValue: "Apply to all visits of this booking" })}</span>
                  </label>
                )}
              </>
            )}
            <div aria-live="polite">
              {modeSelf && reasonTouched && !reasonValid && <p className="text-sm text-destructive">{t("visitCodeReasonInvalid", { defaultValue: "Enter a reason of at least {min} characters.", min: SELF_REASON_MIN })}</p>}
              {dialogError && <p role="alert" className="text-sm text-destructive">{dialogError}</p>}
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" className="min-h-11" disabled={mutation.isPending} onClick={close}>{t("visitCodeCancel", { defaultValue: "Cancel" })}</Button>
              <Button type="submit" className="min-h-11" disabled={mutation.isPending || (modeSelf && !reasonValid)}>
                {mutation.isPending ? t("visitCodeSaving", { defaultValue: "Saving…" })
                  : action?.kind === "issue" ? t("visitCodeIssueConfirm", { defaultValue: "Issue new code" })
                    : modeSelf ? t("visitCodeSelfConfirm", { defaultValue: "Turn on self check-in" })
                      : t("visitCodeStaffedConfirm", { defaultValue: "Switch to staffed" })}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
