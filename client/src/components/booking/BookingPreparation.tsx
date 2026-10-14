/** Arrival overview before instructions are released; the current instructions once they are. */
import { useTranslation } from "react-i18next";
import { friendlyTimezoneName } from "@shared/timezone-utils";

export type ArrivalMode = 'staffed' | 'self' | 'mixed' | 'legacy';

/** One-line "how arrival works" for the visit. Never shows or hints at a code value. */
export function ArrivalModeLine({ mode }: { mode?: ArrivalMode | null }) {
  const { t } = useTranslation("chef");
  const text = mode === 'staffed'
    ? t("kciAcStaffed", { defaultValue: "When you arrive, meet kitchen staff and ask for your 6-digit visit code. Enter it in Local Cooks to confirm arrival. The visit code is for the app; it does not open the door." })
    : mode === 'self'
      ? t("kciAcSelf", { defaultValue: "Self check-in is on for this visit. Follow the kitchen's instructions to get in, then confirm arrival in Local Cooks. No visit code needed." })
      : mode === 'mixed'
        ? t("kciAcMixed", { defaultValue: "Arrival method varies by visit. Open each visit for details." })
        : t("kciAcLegacy", { defaultValue: "Follow the arrival instructions and confirm arrival in Local Cooks when you're there." });
  return <p className="text-sm" data-testid="arrival-mode-line">{text}</p>;
}

interface OverviewProps {
  mode?: ArrivalMode | null;
  releaseAt?: string | null;
  /** Visit start, used only to say how many hours before the visit the details appear. */
  visitStartAt?: Date | null;
  timezone?: string | null;
  address?: string | null;
  contact?: { email?: string | null; phone?: string | null } | null;
  /** Required tasks/photos are visible before release; only the free-text instructions are gated. */
  requiredTasks?: string[];
}

export function InstructionsOverview({ mode, releaseAt, visitStartAt, timezone, address, contact, requiredTasks = [] }: OverviewProps) {
  const { t, i18n } = useTranslation("chef");
  const locale = i18n?.resolvedLanguage || i18n?.language || "en-CA";
  const release = releaseAt ? new Date(releaseAt) : null;
  const valid = !!release && !Number.isNaN(release.getTime());
  const zone = timezone || undefined;
  let when = "";
  if (valid) {
    try {
      when = `${new Intl.DateTimeFormat(locale, { timeZone: zone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(release!)}${zone ? ` ${friendlyTimezoneName(zone, locale)}` : ""}`;
    } catch { when = release!.toISOString(); }
  }
  const hours = valid && visitStartAt ? Math.round((visitStartAt.getTime() - release!.getTime()) / 3_600_000) : 0;
  return <div className="space-y-2 text-sm" data-testid="instructions-overview">
    <p className="font-medium">{t("kciAcOverviewTitle", { defaultValue: "What to expect" })}</p>
    <ArrivalModeLine mode={mode} />
    {address && <p><span className="font-medium">{t("kciAcAddress", { defaultValue: "Address" })}:</span> {address}</p>}
    {contact && (contact.email || contact.phone) && <p><span className="font-medium">{t("kciAcContact", { defaultValue: "Kitchen contact" })}:</span> {[contact.phone, contact.email].filter(Boolean).join(" · ")}</p>}
    {requiredTasks.length > 0 && <div>
      <p className="font-medium">{t("kciAcTasksTitle", { defaultValue: "Required for this visit" })}</p>
      <ul className="mt-1 list-disc list-inside text-muted-foreground">{requiredTasks.map((task, index) => <li key={`${index}-${task}`}>{task}</li>)}</ul>
    </div>}
    {valid && <p className="text-muted-foreground">{hours > 0
      ? t("kciAcReleaseAt", { defaultValue: "Arrival and departure instructions will appear here on {when} ({hours, plural, one {# hour} other {# hours}} before your visit). We'll email them to you too.", when, hours })
      : t("kciAcReleaseAtNoHours", { defaultValue: "Arrival and departure instructions will appear here on {when}. We'll email them to you too.", when })}</p>}
  </div>;
}

export default function BookingPreparation({ arrivalInstructions, departureInstructions, bookingStatus, instructionsReleased, instructionsReleaseAt, arrivalMode, visitStartAt, timezone, address, contact, requiredTasks, inSession = false }: {
  /** Chef is checked in: arrival guidance is behind them, so only departure details remain. */
  inSession?: boolean;
  arrivalInstructions?: string | null; departureInstructions?: string | null; bookingStatus?: string;
  /** Missing = released (older server). */
  instructionsReleased?: boolean; instructionsReleaseAt?: string | null; arrivalMode?: ArrivalMode | null;
  visitStartAt?: Date | null; timezone?: string | null; address?: string | null;
  contact?: OverviewProps["contact"]; requiredTasks?: string[];
}) {
  const { t } = useTranslation("chef");
  if (bookingStatus && !['confirmed', 'cancellation_requested'].includes(bookingStatus)) return null;
  if (instructionsReleased === false) {
    // A release time already in the past means the visit is over (the server never releases for finished visits); a stale "will appear on <past date>" is wrong.
    const releaseMs = instructionsReleaseAt ? Date.parse(instructionsReleaseAt) : NaN;
    if (inSession || (Number.isFinite(releaseMs) && releaseMs <= Date.now())) return null;
    return <div className="pt-3"><InstructionsOverview mode={arrivalMode} releaseAt={instructionsReleaseAt} visitStartAt={visitStartAt}
      timezone={timezone} address={address} contact={contact} requiredTasks={requiredTasks} /></div>;
  }
  return <div className="pt-3 space-y-2 text-sm">
    {!inSession && arrivalMode && <ArrivalModeLine mode={arrivalMode} />}
    {!inSession && <p className="font-medium">{t("kciRequiredArrivalInstructions", "Arrival instructions")}</p>}
    {!inSession && <p className="whitespace-pre-line">{arrivalInstructions || t("kciNoArrivalInstructions", "No arrival instructions provided. Use your booking contact details if you need help getting in.")}</p>}
    {departureInstructions && <div><p className="font-medium">{t("kciRequiredDepartureInstructions", "Departure instructions")}</p><p className="whitespace-pre-line">{departureInstructions}</p></div>}
    <p className="text-muted-foreground">{t("kciPreparationBody", "Follow the kitchen instructions for your visit. Use the kitchen contact below if you need help.")}</p>
  </div>;
}
