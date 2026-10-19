import { useMemo, useState } from "react";
import { KitchenPayoutStatus } from '@/components/booking/KitchenPayoutStatus';
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSupportT } from "./useSupportT";
import { AlertTriangle, ArrowLeft, Mail, Phone, RefreshCw, MapPin, CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAdminDateTime, formatAdminRange } from "@/lib/admin-time";
import { adminDay, fmtMoney } from "./format";
import { loadBookingFeedback, type TokenGetter } from "./api";
import { bookingFeedbackTags } from "@shared/booking-feedback";
import type { AvailableSupportAction, ChronologyEntry, Party, SupportActionRecord, SupportCase } from "./types";

const humanize = (value: string) => value.replace(/_/g, " ");

// ---------------------------------------------------------------- header

function PartyBlock({ role, party }: { role: "chef" | "manager"; party: Party | null }) {
  const t = useSupportT();
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`bsParty_${role}`)}</p>
      {!party ? <p className="text-sm text-muted-foreground">{t("bsPartyUnknown")}</p> : (
        <>
          <p className={party.name ? "truncate text-sm font-medium" : "truncate text-sm text-muted-foreground"}>{party.name || t("bsPartyNoName")}</p>
          <div className="flex flex-wrap gap-2">
            {party.email && (
              <Button asChild size="sm" variant="outline" className="h-9">
                <a href={`mailto:${party.email}`}><Mail className="mr-1.5 h-4 w-4" aria-hidden />{party.email}</a>
              </Button>
            )}
            {party.phone && (
              <Button asChild size="sm" variant="outline" className="h-9">
                <a href={`tel:${party.phone}`}><Phone className="mr-1.5 h-4 w-4" aria-hidden />{party.phone}</a>
              </Button>
            )}
            {!party.email && !party.phone && <p className="text-sm text-muted-foreground">{t("bsPartyNoContact")}</p>}
          </div>
        </>
      )}
    </div>
  );
}

export function CaseHeader({ c, onBack, onRefresh, refreshing }: { c: SupportCase; onBack: () => void; onRefresh: () => void; refreshing: boolean }) {
  const t = useSupportT();
  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}><ArrowLeft className="mr-1 h-4 w-4" aria-hidden />{t("bsBackToSearch")}</Button>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={`mr-1 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden />{t("bsRefresh")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-mono text-xl font-semibold tracking-tight">{c.referenceCode}</h2>
          <Badge variant="secondary" data-testid="status-pill">{t(`bsStatus_${c.status}`, { defaultValue: humanize(c.status) })}</Badge>
        </div>
        {c.flags.length > 0 && (
          <ul className="space-y-1.5" aria-label={t("bsOpenFlags")}>
            {c.flags.map((f) => (
              <li key={f.id} className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive" data-testid="open-flag">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{t(`bsFlag_${f.kind}`)}{f.providerRef ? ` · ${f.providerRef}` : ""} · {t("bsFlagOpenedAt", { when: formatAdminDateTime(f.openedAt, c.schedule) })}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-4 sm:grid-cols-2"><PartyBlock role="chef" party={c.parties.chef} /><PartyBlock role="manager" party={c.parties.manager} /></div>
        <div className="space-y-1.5 border-t pt-3 text-sm">
          <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{[c.kitchen?.name, c.location?.name, c.location?.address].filter(Boolean).join(" · ")}</span></p>
          <div className="flex items-start gap-2"><CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div data-testid="schedule">
              {c.schedule.blocks.length === 0 && <span className="text-muted-foreground">{t("bsNoSchedule")}</span>}
              {c.schedule.blocks.map((b, i) => <p key={i}>{formatAdminRange(b.startAt, b.endAt, { timeZone: c.schedule.timezone, zoneLabel: c.schedule.zoneLabel })}</p>)}
              <p className="text-xs text-muted-foreground">{t("bsTimesIn", { zone: c.schedule.zoneLabel })}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- action panel

export function ActionPanel({ actions, supportActions, onChoose }: { actions: AvailableSupportAction[]; supportActions: SupportActionRecord[]; onChoose: (a: AvailableSupportAction) => void }) {
  const t = useSupportT();
  const needsAttention = supportActions.some((a) => a.status === "recovery_required" || a.status === "executing");
  return (
    <Card className="xl:sticky xl:top-4" data-testid="action-panel">
      <CardHeader className="pb-3"><CardTitle className="text-base">{t("bsTakeAction")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {needsAttention && (
          <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-sm">{t("bsNeedsAttention")}</p>
        )}
        {actions.length === 0 ? <p className="text-sm text-muted-foreground">{t("bsNoActions")}</p> : (
          <ul className="space-y-2">
            {actions.map((a) => (
              <li key={a.type}>
                <Button variant="outline" className="h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left" onClick={() => onChoose(a)}>
                  {t(`bsAction_${a.type}`, { defaultValue: a.label })}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- facts

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-3 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{children}</dd></div>;
}

export function transferLine(t: (key: string, options?: Record<string, unknown>) => string,
  tr: SupportCase["money"]["transfers"][number], currency: string, timezone?: string | null) {
  if (tr.amountCents === undefined) return t("bsTransferLine", { amount: fmtMoney(tr.managerRevenueCents, currency), status: t(`bsTransferStatus_${tr.status}`, { defaultValue: humanize(tr.status) }) });
  const amount = fmtMoney(tr.amountCents, currency);
  if (!tr.sent) return t("bsTransferExpectedLine", { amount });
  return tr.sentAt ? t("bsTransferSentLine", { amount, date: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: timezone || undefined }).format(new Date(tr.sentAt)) })
    : t("bsTransferSentNoDate", { amount });
}

export function MoneyCard({ c }: { c: SupportCase }) {
  const t = useSupportT();
  const m = c.money;
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-base">{t("bsMoney")}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {!!c.dayMoney?.length && <section className="space-y-3 border-b pb-3" aria-label={t('bsDatedDays')}>
          <h3 className="text-sm font-semibold">{t('bsDatedDays')}</h3>
          {c.visits.filter(visit => visit.visitDate && visit.scheduleRevision === c.scheduleRevision && visit.scheduleState !== 'superseded').map((visit, index, days) => {
            const day = c.dayMoney?.find(row => row.visitId === visit.id);
            return <div key={visit.id} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">{t('bsDayOf', { number: index + 1, total: days.length })} · {adminDay(visit.visitDate!)} · {visit.startTime}–{visit.endTime}</p>
              <p>{visit.declinedAtAcceptance ? t('bsDayDeclinedAtAcceptance') : t('bsDayState', { state: t(`mdState_${visit.scheduleState}`, { defaultValue: visit.scheduleState }) })}</p>
              {day && <><p>{t('bsDayAllocation', { amount: fmtMoney(day.allocatedCents, m.currency) })}</p><p>{t('bsDayRefunded', { amount: fmtMoney(day.refundedCents, m.currency) })}</p></>}
              {!!day?.pendingRefundCents && <p role="status">{t('bsDayRefundProcessing', { amount: fmtMoney(day.pendingRefundCents, m.currency) })}</p>}
              {m.dayPayouts?.filter(payout => payout.visitId === visit.id && (payout.transferId || payout.feePending || payout.amountCents > 0)).map(payout => <p key={payout.installmentId}>{fmtMoney(payout.amountCents, m.currency)} · {humanize(payout.status)}{payout.transferId ? ` · ${payout.transferId}` : ''}</p>)}
            </div>;
          })}
        </section>}
        {!!c.kitchenRefundDebts?.length && <div data-testid="kitchen-refund-debts" className="rounded-lg border p-3 text-sm">
          <p className="font-medium">{t("bsKitchenDebtTitle")}</p>
          {c.kitchenRefundDebts.map(debt => <p key={debt.operationId}>{debt.itemName} · {fmtMoney(debt.amountCents, m.currency)} · {t(debt.status === "open" ? "bsKitchenDebtOpen" : "bsKitchenDebtAwaiting")} · {formatAdminDateTime(debt.recordedAt, c.schedule)}</p>)}
          <p className="mt-2 text-muted-foreground">{t("bsKitchenDebtHelp")}</p>
        </div>}
        <dl className="space-y-1.5">
          <Row label={t("bsMoneyCaptured")}>{fmtMoney(m.capturedCents, m.currency)}</Row>
          <Row label={t("bsMoneyRefunded")}>{fmtMoney(m.refundedCents, m.currency)}</Row>
          <Row label={t("bsMoneyProcessingFee")}>{fmtMoney(m.processingFeeCents, m.currency)}</Row>
          <Row label={t("bsMoneyPlatformFee")}>{fmtMoney(m.platformFeeCents, m.currency)}</Row>
        </dl>
        {c.payout && <div data-testid="admin-kitchen-payout">
          {c.payout.status !== 'not_applicable' && <p className="mt-3 text-sm font-medium">{t("bsKitchenPayout")} {fmtMoney(c.payout.amountCents, m.currency)}</p>}
          <KitchenPayoutStatus payout={c.payout} timezone={c.schedule.timezone} currency={m.currency} showAmount={false} audience="admin" />
        </div>}
        {!!m.dayPayouts?.length && <div className="border-t pt-2">
          <p className="text-sm font-medium">Daily payout installments</p>
          {/* Each payment has a row per day; its $0 rows (another payment funds that day) are noise for support. */}
          <ul>{m.dayPayouts.filter(day => day.transferId || day.feePending || day.amountCents > 0).map(day => <li key={day.installmentId} className="py-1 text-sm">
            {day.operatingDate ? adminDay(day.operatingDate) : '—'} - {day.feePending ? 'Waiting for actual processing fee' : fmtMoney(day.amountCents, m.currency)} - {humanize(day.status)}
            {day.transferId && <span className="ml-2 text-muted-foreground">{day.transferId}</span>}
            {day.retryReason && <p className="text-muted-foreground">{humanize(day.retryReason)}</p>}
          </li>)}</ul>
          <p className="text-xs text-muted-foreground">Use Release payout to retry an installment. Resolve open problems before it can be paid.</p>
        </div>}
        <div className="border-t pt-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("bsTransfers")}</p>
          {m.transfers.length === 0 ? <p className="text-sm text-muted-foreground">{t("bsNoTransfers")}</p> : (
            <ul className="mt-1 space-y-1">
              {m.transfers.map((tr) => (
                <li key={tr.transactionId} className="text-sm">
                  {transferLine(t, tr, m.currency, c.schedule.timezone)}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-xs text-muted-foreground">{t("bsTransferNote")}</p>
        </div>
        {!m.providerVerified && <p className="text-xs text-muted-foreground">{t("bsLedgerNotVerified")}</p>}
      </CardContent>
    </Card>
  );
}

export function DeadlinesCard({ c }: { c: SupportCase }) {
  const t = useSupportT();
  const when = (iso: string | null) => iso ? formatAdminDateTime(iso, c.schedule) : t("bsNoDeadline");
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-base">{t("bsDeadlines")}</CardTitle></CardHeader>
      <CardContent><dl className="space-y-1.5">
        <Row label={t("bsDeadlineResponse")}>{when(c.deadlines.responseAt)}</Row>
        <Row label={t("bsDeadlineInspection")}>{when(c.deadlines.inspectionAt)}</Row>
        <Row label={t("bsDeadlineCloseout")}>{when(c.deadlines.closeoutAt)}</Row>
        {c.partialAcceptance && <>
          <Row label={t("bsProposal")}>{t(`bsProposalState_${c.partialAcceptance.state}`)}</Row>
          {/* The offer's changes: the days the kitchen couldn't host, then items on kept days. */}
          <Row label={t("bsProposalTerms")}>{t("bsProposalTermsValue", { newTotal: fmtMoney(c.partialAcceptance.newTotalCents, c.money.currency),
            oldTotal: fmtMoney(c.partialAcceptance.oldTotalCents, c.money.currency), changes: [
              ...(c.partialAcceptance.declinedDays ?? []).map(day => t("bsProposalNotOn", { day: adminDay(day.date) })),
              ...(c.partialAcceptance.declined.length ? [t("bsProposalWithout", { items: c.partialAcceptance.declined.map(item => item.date ? `${item.name} (${adminDay(item.date)})` : item.name).join(", ") })] : []),
            ].join("; ") })}</Row>
          <Row label={t("bsDeadlineChefAnswer")}>{when(c.partialAcceptance.deadlineAt)}</Row>
          {c.partialAcceptance.supportReason && <Row label={t("bsProposalSupportReason")}>{c.partialAcceptance.supportReason}</Row>}
        </>}
      </dl></CardContent>
    </Card>
  );
}

/** Read-only view of the private feedback both parties sent (admin never edits these). */
export function FeedbackCard({ c, getFirebaseToken }: { c: SupportCase; getFirebaseToken: TokenGetter }) {
  const t = useSupportT();
  const { t: tb } = useTranslation("booking");
  const query = useQuery({
    queryKey: ["/api/admin/bookings/feedback", c.bookingId],
    queryFn: () => loadBookingFeedback(getFirebaseToken, c.bookingId),
    retry: false,
  });
  const data = query.data;
  const when = (iso: string) => formatAdminDateTime(iso, c.schedule);
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-base">{t("bsFeedbackHeading")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {query.isLoading && <p className="text-sm text-muted-foreground">{t("bsFeedbackLoading")}</p>}
        {query.isError && <p role="alert" className="text-sm text-destructive">{t("bsFeedbackFailed")}</p>}
        {data && data.requestedAt === null && <p className="text-sm text-muted-foreground">{t("bsFeedbackNotOpen")}</p>}
        {data && data.requestedAt !== null && (["chef", "manager"] as const).map((role) => {
          const response = data.responses.find((r) => r.respondentRole === role);
          return (
            <div key={role} className="space-y-1.5 border-t pt-3 first:border-t-0 first:pt-0" data-testid={`feedback-${role}`}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`bsFeedbackRole_${role}`)}</p>
              {!response ? (
                <>
                  <p className="text-sm">{t("bsFeedbackNoAnswer")}</p>
                  {data.closesAt && <p className="text-xs text-muted-foreground">{t("bsFeedbackWindowCloses", { when: when(data.closesAt) })}</p>}
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base tracking-wide" aria-hidden>{"★".repeat(response.rating)}{"☆".repeat(5 - response.rating)}</span>
                    <span className="text-sm font-medium">{t("bsFeedbackRating", { rating: response.rating })}</span>
                    {response.flagged && <Badge variant="destructive" className="text-[11px]">{t("bsFeedbackFlagged")}</Badge>}
                  </div>
                  {response.tags.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5">
                      {response.tags.map((tag) => {
                        const allowed = bookingFeedbackTags[response.respondentRole].find((v) => v === tag);
                        return <li key={tag}><Badge variant="outline" className="text-[11px]">{allowed ? tb(`privateFeedback.tags.${allowed}`) : tag}</Badge></li>;
                      })}
                    </ul>
                  )}
                  {response.comment && <blockquote className="border-l-2 border-border pl-3 text-sm italic">{response.comment}</blockquote>}
                  <p className="text-xs text-muted-foreground">{t("bsFeedbackAnswered", { when: when(response.createdAt) })}</p>
                </>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** True once this visit's booked time is over, using the saved closeout phase first and the schedule as a backstop. */
function visitEnded(c: SupportCase, visitId: number | null, blockIndex: number | undefined): boolean {
  const done = (phase?: string) => phase === "booked_time_ended" || phase === "ended";
  const row = c.deadlines.closeout?.visits?.find((x) => (visitId != null && x.visitId === visitId) || (blockIndex != null && x.blockIndex === blockIndex));
  if (row?.phase) return done(row.phase);
  if (done(c.deadlines.closeout?.phase) || c.status === "completed") return true;
  const block = c.schedule.blocks[blockIndex ?? c.schedule.blocks.length - 1];
  return !!block && Date.parse(block.endAt) <= Date.now();
}

export function VisitCodesCard({ c }: { c: SupportCase }) {
  const t = useSupportT();
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-base">{t("bsVisitCodes")}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {c.visitCodes.length === 0 ? <p className="text-sm text-muted-foreground">{t("bsNoVisitCodes")}</p> : (
          <ul className="space-y-1.5">
            {c.visitCodes.map((v) => {
              const visit = c.visits.find((x) => x.id === v.visitId);
              const state = v.revoked ? "revoked" : v.consumed ? "used" : v.locked ? "locked" : !v.codeRequired ? "notRequired" : visitEnded(c, v.visitId, visit?.blockIndex) ? "unused" : "waiting";
              return (
                <li key={v.targetKey} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{visit?.visitDate ? adminDay(visit.visitDate) : visit ? t("bsVisitN", { n: visit.blockIndex + 1 }) : t("bsVisitGeneral")} · {t(v.mode === "self" ? "bsModeSelfShort" : "bsModeStaffedShort")}</span>
                  <Badge variant={state === "waiting" ? "outline" : "secondary"}>{t(`bsCodeState_${state}`)}</Badge>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{t("bsCodeDigitsNever")}</p>
      </CardContent>
    </Card>
  );
}

export function PaymentEvidenceCard({ c }: { c: SupportCase }) {
  const t = useSupportT();
  const p = c.paymentEvidence;
  // Provider evidence is for the booking's own payment; a paid change or extra time is its own payment (totals under Money).
  const firstOnly = !!p && c.money.capturedCents > p.capturedCents;
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-base">{t(firstOnly ? "bsPaymentDetailsFirst" : "bsPaymentDetails")}</CardTitle></CardHeader>
      <CardContent>
        {firstOnly && <p className="mb-2 text-xs text-muted-foreground">{t("bsPaymentDetailsFirstHint")}</p>}
        {c.evidenceUnavailable || !p ? (
          <p role="status" className="text-sm text-muted-foreground" data-testid="evidence-unavailable">{c.evidenceUnavailable ? t("bsEvidenceUnavailable") : t("bsNoPayment")}</p>
        ) : (
          <dl className="space-y-1.5">
            <Row label={t("bsEvStatus")}>{t(`bsEvStatus_${p.status}`, { defaultValue: humanize(p.status) })}</Row>
            <Row label={t("bsEvAuthorized")}>{fmtMoney(p.authorizedCents, c.money.currency)}</Row>
            <Row label={t("bsMoneyCaptured")}>{fmtMoney(p.capturedCents, c.money.currency)}</Row>
            <Row label={t("bsMoneyRefunded")}>{fmtMoney(p.refundedCents, c.money.currency)}</Row>
            {p.processingFeeCents != null && <Row label={t("bsMoneyProcessingFee")}>{fmtMoney(p.processingFeeCents, c.money.currency)}</Row>}
            <Row label={t("bsEvTerms")}>{p.termsVerified ? t("bsYes") : t("bsNotVerified")}</Row>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- chronology

const SOURCES = ["all", "support", "lifecycle", "payment", "email", "problem"] as const;

function ChronologyItem({ e, c }: { e: ChronologyEntry; c: SupportCase }) {
  const t = useSupportT();
  const stamp = formatAdminDateTime(e.createdAt, c.schedule);
  let title = "title" in e && e.title ? e.title : t(`bsChron_${e.source}`);
  let detail: string | null = null;
  let badge: { text: string; bad?: boolean } | null = null;
  if (e.source === "email") {
    detail = e.recipientEmail ?? null;
    badge = { text: t(`bsEmailStatus_${e.status}`, { defaultValue: humanize(e.status) }), bad: /fail|bounce|reject/.test(e.status) };
  } else if (e.source === "problem") {
    badge = { text: t(`bsProblemStatus_${e.status}`, { defaultValue: humanize(e.status) }) };
  } else if (e.source === "support") {
    title = t(`bsAction_${e.type}`, { defaultValue: e.title });
    detail = t("bsSupportDetail", {
      actingFor: t(`bsActing_${e.actingFor}`), via: t(`bsSource_${e.requestSource}`), reason: t(`bsReason_${e.reasonCode}`, { defaultValue: e.reasonCode }),
    }) + (e.amountCents != null ? ` · ${fmtMoney(e.amountCents, e.currency)}` : "") + (e.exception ? ` · ${t("bsException")}` : "");
    badge = { text: t(`bsRunStatus_${e.status}`), bad: e.status === "failed" || e.status === "recovery_required" };
  }
  return (
    <li className="space-y-0.5 border-l-2 border-border pl-3" data-source={e.source}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{title}</span>
        {badge && <Badge variant={badge.bad ? "destructive" : "outline"} className="text-[11px]">{badge.text}</Badge>}
      </div>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      <p className="text-xs text-muted-foreground"><span className="sr-only">{t(`bsChron_${e.source}`)} · </span>{stamp}</p>
    </li>
  );
}

export function Chronology({ c }: { c: SupportCase }) {
  const t = useSupportT();
  const [filter, setFilter] = useState<(typeof SOURCES)[number]>("all");
  const counts = useMemo(() => {
    const out: Record<string, number> = { all: c.chronology.length };
    for (const e of c.chronology) out[e.source] = (out[e.source] ?? 0) + 1;
    return out;
  }, [c.chronology]);
  const newestFirst = useMemo(() => [...c.chronology].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)), [c.chronology]);
  const entries = filter === "all" ? newestFirst : newestFirst.filter((e) => e.source === filter);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("bsChronology")}</CardTitle>
        <div className="flex flex-wrap gap-2 pt-1" role="group" aria-label={t("bsChronologyFilter")}>
          {SOURCES.filter((s) => s === "all" || counts[s]).map((s) => (
            <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} className="h-8 rounded-full px-3 text-xs" aria-pressed={filter === s} onClick={() => setFilter(s)}>
              {t(`bsChronFilter_${s}`)} ({counts[s] ?? 0})
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? <p className="text-sm text-muted-foreground">{t("bsChronologyEmpty")}</p> : (
          <ol className="space-y-4" data-testid="chronology">{entries.map((e) => <ChronologyItem key={`${e.source}-${e.id}`} e={e} c={c} />)}</ol>
        )}
      </CardContent>
    </Card>
  );
}
