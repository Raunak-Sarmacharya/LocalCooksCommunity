import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ExtensionItem } from "@/lib/session-extensions";
import { fmtMoney } from "./format";
import { SupportApiError, type TokenGetter } from "./api";
import { useSupportT } from "./useSupportT";

type Outcome = "upheld" | "reduced" | "waived";
const OUTCOMES: Outcome[] = ["upheld", "reduced", "waived"];

async function call<T>(getToken: TokenGetter, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: body ? "POST" : "GET", headers: { ...(body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${await getToken()}` },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw new SupportApiError(0, ""); }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new SupportApiError(res.status, typeof json?.error === "string" ? json.error : "");
  return json as T;
}

/**
 * Extra-time charges waiting on Local Cooks: the customer said "This isn't right", or didn't answer for 48 hours.
 * Settled like a damage claim (owner, Oct 22): uphold, reduce or waive, with a note both sides read.
 */
export function ExtraTimeDisputes({ bookingId, currency, getFirebaseToken }: { bookingId: number; currency: string; getFirebaseToken: TokenGetter }) {
  const t = useSupportT();
  const query = useQuery({ queryKey: ["/api/bookings", bookingId, "extensions", "admin"], retry: false,
    queryFn: () => call<{ history: ExtensionItem[] }>(getFirebaseToken, `/api/bookings/${bookingId}/extensions`) });
  const waiting = (query.data?.history ?? []).filter(item => item.kind === "extra_time" && !item.upheldAt
    && (item.status === "disputed" || item.status === "offered" && item.escalated && !item.paid));
  if (!waiting.length) return null;
  return <Card data-testid="extra-time-disputes" className="border-warning/40 bg-warning/5">
    <CardHeader className="pb-2"><CardTitle className="text-base">{t("bsExtraTimeTitle")}</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      {waiting.map(item => <Dispute key={item.id} item={item} bookingId={bookingId} currency={currency} getFirebaseToken={getFirebaseToken} onDone={() => void query.refetch()} />)}
    </CardContent>
  </Card>;
}

function Dispute({ item, bookingId, currency, getFirebaseToken, onDone }: { item: ExtensionItem; bookingId: number; currency: string; getFirebaseToken: TokenGetter; onDone: () => void }) {
  const t = useSupportT();
  const [outcome, setOutcome] = useState<Outcome | null>(null), [amount, setAmount] = useState(""), [note, setNote] = useState("");
  const cents = Math.round(Number(amount) * 100);
  const amountOk = outcome !== "reduced" || Number.isSafeInteger(cents) && cents > 0 && cents < item.amountCents;
  const settle = useMutation({
    mutationFn: () => call(getFirebaseToken, `/api/admin/bookings/${bookingId}/extensions/${item.id}/resolve`,
      { outcome, note: note.trim(), ...(outcome === "reduced" ? { amountCents: cents } : {}) }),
    onSuccess: onDone,
  });
  const error = settle.error instanceof SupportApiError ? settle.error.message || t("bsErrServerGeneric") : settle.error ? t("bsErrServerGeneric") : "";
  return <section className="space-y-2 rounded-xl border bg-background p-3" data-testid="extra-time-dispute">
    <p className="text-sm font-medium">{t(item.status === "disputed" ? "bsExtraTimeDisputed" : "bsExtraTimeUnanswered",
      { amount: fmtMoney(item.amountCents, currency), minutes: item.actualMinutes ?? item.minutes, billed: item.minutes })}</p>
    {item.note && <p className="text-sm whitespace-pre-wrap">{t("bsExtraTimeKitchenNote", { note: item.note })}</p>}
    {item.resolution?.disputeNote && <p className="text-sm whitespace-pre-wrap">{t("bsExtraTimeCustomerNote", { note: item.resolution.disputeNote })}</p>}
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t("bsExtraTimeDecide")}</legend>
      <div className="flex flex-wrap gap-2">
        {OUTCOMES.map(value => <Button key={value} type="button" size="sm" variant={outcome === value ? "default" : "outline"} aria-pressed={outcome === value}
          onClick={() => setOutcome(value)} data-testid={`extra-time-${value}`}>{t(`bsExtraTime_${value}`, { amount: fmtMoney(item.amountCents, currency) })}</Button>)}
      </div>
    </fieldset>
    {outcome === "reduced" && <label className="block space-y-1 text-sm"><span>{t("bsExtraTimeAmount", { max: fmtMoney(item.amountCents, currency) })}</span>
      <Input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} className="max-w-40" /></label>}
    {outcome && <label className="block space-y-1 text-sm"><span>{t("bsExtraTimeNote")}</span>
      <Textarea value={note} maxLength={2000} rows={3} onChange={event => setNote(event.target.value)} /></label>}
    {outcome && <p className="text-xs text-muted-foreground">{t(`bsExtraTimeEffect_${outcome}`)}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {outcome && <Button type="button" disabled={settle.isPending || note.trim().length < 10 || !amountOk} onClick={() => settle.mutate()}>
      {settle.isPending ? t("bsChangeWorking") : t("bsExtraTimeConfirm")}</Button>}
  </section>;
}
