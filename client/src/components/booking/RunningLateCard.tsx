import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { friendlyTimezoneName } from "@shared/timezone-utils";
import { canReportRunningLate, RUNNING_LATE_CHOICES, RUNNING_LATE_MAX_PER_BOOKING, RUNNING_LATE_NOTE_MAX, type RunningLateMinutes, type RunningLateState } from "@shared/running-late";

type Props = {
  bookingId: number;
  visitId?: number | null;
  kitchenName?: string;
  /** Booked start and end of the visit this heads-up is about. */
  startAt: Date | null;
  endAt: Date | null;
  timezone: string;
  status?: string;
  checkedIn: boolean;
  runningLate?: RunningLateState | null;
  /** Called after the kitchen was told, so the page can refresh. */
  onChanged?: () => void;
  className?: string;
};

/**
 * "Running late?" for a chef who has not checked in yet: from 30 minutes before the booked start until the
 * booked end. Coordination only. It never records arrival and the booking still ends when it was booked to end.
 */
export function RunningLateCard({ bookingId, visitId, kitchenName, startAt, endAt, timezone, status = "confirmed", checkedIn, runningLate, onChanged, className }: Props) {
  const { t: tStrict, i18n } = useTranslation("chef");
  const t = tStrict as unknown as (key: string, options?: Record<string, unknown>) => string;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState<RunningLateMinutes | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");
  const [sent, setSent] = useState<RunningLateState | null>(null);

  const windowOpen = !!startAt && !!endAt && canReportRunningLate({ status, checkedIn, start: startAt, end: endAt }, now);
  // A newer heads-up from the server wins over what this tab sent a moment ago.
  const current = [sent, runningLate].filter((value): value is RunningLateState => !!value).sort((a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt))[0] ?? null;
  const stillRelevant = !!current && !checkedIn && status === "confirmed" && !!endAt && now < endAt.getTime();
  if (!windowOpen && !stillRelevant) return null;

  const kitchen = kitchenName || t("rlTheKitchen");
  const endText = endAt ? `${new Intl.DateTimeFormat(i18n.language, { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true }).format(endAt)} ${friendlyTimezoneName(timezone, i18n.language)}` : "";
  const canUpdate = !current || current.count < RUNNING_LATE_MAX_PER_BOOKING;

  const send = async () => {
    if (!minutes || sending) return;
    setSending(true);
    setProblem("");
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/chef/bookings/${bookingId}/running-late`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ minutes, note: note.trim() || undefined, ...(visitId ? { visitId } : {}) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblem(result.code === "RUNNING_LATE_LIMIT" ? t("rlLimit") : result.code === "RUNNING_LATE_UNAVAILABLE" ? t("rlUnavailable") : t("rlFailed"));
        return;
      }
      setSent(result.runningLate as RunningLateState);
      setOpen(false);
      setNote("");
      onChanged?.();
    } catch {
      setProblem(t("rlFailed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={cn("space-y-3", className)} data-testid="running-late">
      {stillRelevant && current ? (
        <div role="status" className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950" data-testid="running-late-banner">
          <p className="flex items-center gap-2 font-medium"><Clock className="h-4 w-4 shrink-0" aria-hidden />{t("rlSentTitle")}</p>
          <p className="mt-1 leading-relaxed">{t("rlSentBody", { kitchen, duration: t(`rlDurationLong${current.minutes}`), end: endText })}</p>
          {current.note && <p className="mt-1 text-xs text-sky-900/80">“{current.note}”</p>}
          {canUpdate && !open && <Button type="button" variant="link" size="sm" className="mt-1 h-auto p-0" onClick={() => setOpen(true)}>{t("rlChange")}</Button>}
        </div>
      ) : !open && (
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Clock className="mr-1.5 h-4 w-4" aria-hidden />{t("rlAction")}
        </Button>
      )}
      {open && (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4" role="group" aria-labelledby={`running-late-title-${bookingId}`}>
          <div>
            <p id={`running-late-title-${bookingId}`} className="text-sm font-semibold">{t("rlPanelTitle")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("rlPanelHint", { kitchen, end: endText })}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {RUNNING_LATE_CHOICES.map(choice => (
              <Button key={choice} type="button" size="sm" variant={minutes === choice ? "default" : "outline"} aria-pressed={minutes === choice}
                disabled={sending} onClick={() => setMinutes(choice)}>{t(`rlChoice${choice}`)}</Button>
            ))}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`running-late-note-${bookingId}`} className="text-xs text-muted-foreground">{t("rlNoteLabel")}</label>
            <Textarea id={`running-late-note-${bookingId}`} rows={2} maxLength={RUNNING_LATE_NOTE_MAX} value={note} disabled={sending}
              placeholder={t("rlNotePlaceholder")} onChange={event => setNote(event.target.value)} />
          </div>
          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={!minutes || sending} onClick={() => void send()}>
              {sending ? t("rlSending") : t("rlSend", { kitchen })}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={sending} onClick={() => { setOpen(false); setProblem(""); }}>{t("rlNotNow")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
