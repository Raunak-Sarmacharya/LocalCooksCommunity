/**
 * ManagerInSessionBadge
 *
 * "In session · N min left" for a visit whose arrival is recorded and departure is not.
 * Ticks locally (no polling); the end instant comes from the saved clock projection.
 */
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Clock } from "lucide-react"
import { friendlyTimezoneName } from "@shared/timezone-utils"

const TICK_MS = 30_000

interface SessionSource {
  status: string
  checkinStatus?: string | null
  closeout?: { visits: Array<{ visitId?: number; scheduledEndAt: string; phase: string }> }
  visits?: Array<{ id: number; blockIndex?: number; checkinStatus?: string | null }>
}

/** Saved booked-end instants of every visit the chef has arrived at but not left; empty otherwise. */
export function inSessionEnds(source: SessionSource | undefined | null): Array<{ visitId?: number; endsAt: string }> {
  if (!source || source.status !== "confirmed" || !source.closeout) return []
  const visits = source.closeout.visits
  const open = (visit: { phase: string }) => visit.phase !== "ended"
  if (source.visits?.length) {
    return source.visits
      .filter(row => row.checkinStatus === "checked_in")
      .flatMap(row => {
        const clock = visits.find(visit => visit.visitId === row.id)
        return clock && open(clock) ? [{ visitId: row.id, endsAt: clock.scheduledEndAt }] : []
      })
  }
  const clock = visits[0]
  return source.checkinStatus === "checked_in" && clock && open(clock) ? [{ endsAt: clock.scheduledEndAt }] : []
}

export function ManagerInSessionBadge({ endsAt, timezone, label }: { endsAt: string; timezone?: string | null; label?: string }) {
  const { t, i18n } = useTranslation("manager")
  const locale = i18n?.resolvedLanguage || i18n?.language || "en-CA"
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [])
  const endMs = Date.parse(endsAt)
  if (!Number.isFinite(endMs)) return null
  const minutes = Math.max(0, Math.ceil((endMs - now) / 60_000))
  const over = endMs - now <= 0
  const time = new Intl.DateTimeFormat(locale, { ...(timezone ? { timeZone: timezone } : {}), hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(endMs))
  const zone = timezone ? ` ${friendlyTimezoneName(timezone, locale)}` : ""
  const text = over ? t("inSessionOver", { defaultValue: "In session · booked time ended at {time}", time })
    : minutes >= 60 ? t("inSessionLeftHM", { defaultValue: "In session · {hours} h {minutes} min left · ends {time}", hours: Math.floor(minutes / 60), minutes: minutes % 60, time })
      : t("inSessionLeftM", { defaultValue: "In session · {minutes} min left · ends {time}", minutes, time })
  return (
    <span data-testid="manager-in-session" data-over={over || undefined} title={`${time}${zone}`}
      className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium tabular-nums ${over ? "border-amber-500/40 bg-amber-50 text-amber-900" : "border-emerald-600/30 bg-emerald-50 text-emerald-900"}`}>
      <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />{label ? `${label} · ` : ""}{text}
    </span>
  )
}
