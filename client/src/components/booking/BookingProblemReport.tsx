import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { getAuthHeaders } from "@/lib/api"

export const PROBLEM_CATEGORIES = ["safety", "access", "equipment", "cleanliness", "other"] as const
export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number]

export function BookingProblemReport({ bookingId, initialCategory }: { bookingId: number; initialCategory?: ProblemCategory }) {
  const { t } = useTranslation("chef")
  const [reportOpen, setReportOpen] = useState(false)
  const [category, setCategory] = useState<ProblemCategory | "">(initialCategory ?? "")
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
      setReportOpen(false); setReportSent(true); setDescription(""); setCategory(initialCategory ?? ""); setRequestKey(crypto.randomUUID())
    } catch (error) {
      setReportError(error instanceof Error ? error.message : t("kciIsReportFailed", { defaultValue: "Could not send the report. Your text is kept; try again." }))
    } finally { setReportBusy(false) }
  }

  const link = "min-h-11 px-1 text-sm underline-offset-4 hover:underline disabled:opacity-50"
  return <>
    <button type="button" className={link} onClick={() => { setReportSent(false); setReportOpen(true) }}>{t("kciIsReportProblem", { defaultValue: "Report a problem" })}</button>
      {reportSent && <p role="status" className="text-sm">{t("kciIsReportSent", { defaultValue: "Report sent. You can follow it on your booking page." })}</p>}
      <Sheet open={reportOpen} onOpenChange={value => { if (!reportBusy) setReportOpen(value) }}>
        <SheetContent side="bottom" className="mx-auto max-h-[90dvh] max-w-lg space-y-4 overflow-y-auto rounded-t-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>{t("kciIsReportProblem", { defaultValue: "Report a problem" })}</SheetTitle>
            <SheetDescription>{t("kciIsReportIntro", { defaultValue: "Safety comes first. If anyone is in danger, call 911 before anything else." })}</SheetDescription>
          </SheetHeader>
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
            <SheetFooter className="gap-2">
              <Button type="button" variant="outline" className="min-h-11" disabled={reportBusy} onClick={() => setReportOpen(false)}>{t("kciIsCancel", { defaultValue: "Cancel" })}</Button>
              <Button type="submit" className="min-h-11" disabled={!canSend}>{reportBusy ? t("kciIsSending", { defaultValue: "Sending…" }) : t("kciIsSendReport", { defaultValue: "Send report" })}</Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
  </>
}
