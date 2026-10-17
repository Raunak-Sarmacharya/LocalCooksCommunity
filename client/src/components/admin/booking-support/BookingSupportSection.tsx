import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSupportT } from "./useSupportT";
import { Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fmtOperatingDate } from "./format";
import { loadCase, searchBookings, type TokenGetter } from "./api";
import { ActionDialog } from "./ActionDialog";
import { ActionPanel, CaseHeader, Chronology, DeadlinesCard, FeedbackCard, MoneyCard, PaymentEvidenceCard, VisitCodesCard } from "./CaseView";
import type { AvailableSupportAction, SearchRow, SupportCase } from "./types";
import { FrozenCancellationPolicy } from './FrozenCancellationPolicy';
import { DamageClaimPanel } from './DamageClaimPanel';
import { AdminCancellationPolicyEditor } from '@/components/admin/AdminCancellationPolicyEditor';
import { CheckoutIncidents } from './CheckoutIncidents';
import { KitchenChangeRecovery } from './KitchenChangeRecovery';

function readBookingParam(): number | null {
  const raw = new URLSearchParams(window.location.search).get("booking");
  const id = raw ? parseInt(raw, 10) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

function setBookingParam(id: number | null) {
  const params = new URLSearchParams(window.location.search);
  params.set("section", "booking-support");
  if (id) params.set("booking", String(id)); else params.delete("booking");
  window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
}

export function BookingSupportSection({ getFirebaseToken }: { getFirebaseToken: TokenGetter }) {
  const t = useSupportT();
  const queryClient = useQueryClient();
  const [bookingId, setBookingId] = useState<number | null>(readBookingParam);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<AvailableSupportAction | null>(null);
  const [doneLabel, setDoneLabel] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setQuery(text.trim()), 350);
    return () => clearTimeout(handle);
  }, [text]);

  const search = useQuery({
    queryKey: ["/api/admin/booking-support/search", query],
    queryFn: () => searchBookings(getFirebaseToken, query),
    enabled: bookingId === null && query.length >= 2,
  });
  const caseQuery = useQuery({
    queryKey: ["/api/admin/booking-support/case", bookingId],
    queryFn: () => loadCase(getFirebaseToken, bookingId!),
    enabled: bookingId !== null,
    retry: false,
  });

  const open = (id: number) => { setBookingId(id); setBookingParam(id); };
  const back = () => { setDoneLabel(null); setBookingId(null); setBookingParam(null); setChosen(null); };
  const replaceCase = (next: SupportCase) => queryClient.setQueryData(["/api/admin/booking-support/case", next.bookingId], next);

  if (bookingId === null) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div><h1 className="text-xl font-semibold">{t("bsTitle")}</h1><p className="text-sm text-muted-foreground">{t("bsSubtitle")}</p></div>
        <CheckoutIncidents getToken={getFirebaseToken} query={query} />
        <form className="relative" onSubmit={(e) => { e.preventDefault(); setQuery(text.trim()); }} role="search">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input autoFocus className="pl-9" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("bsSearchPlaceholder")} aria-label={t("bsSearchLabel")} />
        </form>
        {query.length >= 2 && search.isLoading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{t("bsSearching")}</p>}
        {search.isError && <p role="alert" className="text-sm text-destructive">{t("bsSearchFailed")}</p>}
        {search.data && search.data.length === 0 && <p className="text-sm text-muted-foreground">{t("bsNoResults")}</p>}
        <ul className="space-y-2">
          {(search.data ?? []).map((r: SearchRow) => (
            <li key={r.bookingId}>
              <Card className="transition-colors hover:bg-muted/40">
                <button type="button" className="w-full p-3 text-left sm:p-4" onClick={() => open(r.bookingId)}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-primary">{r.referenceCode}</span>
                    <Badge variant="secondary">{t(`bsStatus_${r.status}`, { defaultValue: r.status.replace(/_/g, " ") })}</Badge>
                  </div>
                  <p className="mt-1 text-sm">{[r.chefName, r.managerName].filter(Boolean).join(" · ") || t("bsPartyNoName")}</p>
                  <p className="text-xs text-muted-foreground">{[r.kitchenName, `${fmtOperatingDate(r.bookingDate)}, ${r.startTime}–${r.endTime} (${r.timezone.replace(/_/g, " ")})`].filter(Boolean).join(" · ")}</p>
                </button>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (caseQuery.isLoading) return <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{t("bsLoadingCase")}</p>;
  if (caseQuery.isError || !caseQuery.data) {
    const status = (caseQuery.error as { status?: number } | null)?.status;
    return (
      <div className="mx-auto max-w-xl space-y-3 p-6" role="alert">
        <p className="text-sm">{status === 404 ? t("bsCaseNotFound") : t("bsCaseFailed")}</p>
        <div className="flex gap-2"><Button variant="outline" onClick={back}>{t("bsBackToSearch")}</Button><Button onClick={() => void caseQuery.refetch()}>{t("bsTryAgain")}</Button></div>
      </div>
    );
  }
  const c = caseQuery.data;
  return (
    <div className="space-y-4">
      {doneLabel && <p role="status" data-testid="action-done" className="rounded-xl border border-success/40 bg-success/10 p-3 text-sm font-medium">{t("bsToastDone", { action: doneLabel })}</p>}
      <CaseHeader c={c} onBack={back} onRefresh={() => void caseQuery.refetch()} refreshing={caseQuery.isFetching} />
      {c.kitchenRefund && (
        <p role={c.kitchenRefund.status === 'pending' ? 'alert' : 'status'} data-testid="kitchen-refund-state"
          className={`rounded-xl border p-3 text-sm ${c.kitchenRefund.status === 'pending' ? 'border-warning/40 bg-warning/10' : 'border-success/40 bg-success/10'}`}>
          {c.kitchenRefund.status === 'pending'
            ? t('bsKitchenRefundPending', { amount: new Intl.NumberFormat(undefined, { style: 'currency', currency: c.money.currency }).format(c.kitchenRefund.amountCents / 100),
              problem: c.kitchenRefund.error ? ` ${t('bsKitchenRefundProblem', { error: c.kitchenRefund.error })}` : '' })
            : t('bsKitchenRefundSent', { amount: new Intl.NumberFormat(undefined, { style: 'currency', currency: c.money.currency }).format(c.kitchenRefund.amountCents / 100) })}
        </p>
      )}
      <DamageClaimPanel bookingId={c.bookingId} />
      <KitchenChangeRecovery bookingId={c.bookingId} getFirebaseToken={getFirebaseToken} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_20rem] xl:items-start">
        <div className="order-1 md:col-span-2 xl:order-3 xl:col-span-1">
          <ActionPanel actions={c.availableActions} supportActions={c.supportActions} onChoose={(action) => { setDoneLabel(null); setChosen(action); }} />
        </div>
        <div className="order-2 space-y-4 xl:order-1">
          <FrozenCancellationPolicy snapshot={c.cancellationPolicySnapshot} />
          {c.kitchen && <AdminCancellationPolicyEditor kitchenId={c.kitchen.id} />}
          <MoneyCard c={c} /><DeadlinesCard c={c} /><FeedbackCard c={c} getFirebaseToken={getFirebaseToken} /><VisitCodesCard c={c} /><PaymentEvidenceCard c={c} />
        </div>
        <div className="order-3 min-w-0 xl:order-2"><Chronology c={c} /></div>
      </div>
      <ActionDialog action={chosen} supportCase={c} getFirebaseToken={getFirebaseToken} onClose={() => setChosen(null)} onCaseUpdated={replaceCase} onDone={setDoneLabel} />
    </div>
  );
}
