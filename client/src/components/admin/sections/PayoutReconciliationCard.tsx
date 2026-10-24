import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Issue = { managerId: number; kitchenName: string; transferId: string; kind: "missing_on_page" | "not_in_stripe" | "amount"; pageCents: number | null; stripeCents: number | null };
type Result = { checkedAt: string; kitchens: number; transfers: number; repairedReversals: number; issues: Issue[];
  failures: Array<{ managerId: number; kitchenName: string; error: string }> };

const money = (cents: number | null) => cents == null ? "—" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
const when = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/St_Johns", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const KIND: Record<Issue["kind"], string> = {
  amount: "Amount differs",
  missing_on_page: "In Stripe, not on the kitchen's Revenue page",
  not_in_stripe: "On the Revenue page, not found in Stripe",
};

/** Daily check that each kitchen's Revenue "Paid out" matches Stripe's transfers. Nothing here moves money. */
export function PayoutReconciliationCard({ getFirebaseToken }: { getFirebaseToken: () => Promise<string> }) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const request = async (method: "GET" | "POST", path: string) => {
    const response = await fetch(`/api/admin/${path}`, { method, headers: { Authorization: `Bearer ${await getFirebaseToken()}` }, credentials: "include" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "The payout check couldn't be loaded.");
    return body as Result | null;
  };
  const { data, isLoading, error } = useQuery({ queryKey: ["/api/admin/payout-reconciliation"], queryFn: () => request("GET", "payout-reconciliation") });
  const run = async () => {
    setRunning(true); setRunError("");
    try { queryClient.setQueryData(["/api/admin/payout-reconciliation"], await request("POST", "payout-reconciliation/run")); }
    catch (err) { setRunError(err instanceof Error ? err.message : "The payout check couldn't run."); }
    finally { setRunning(false); }
  };
  const problems = (data?.issues.length ?? 0) + (data?.failures.length ?? 0);

  return (
    <Card data-testid="payout-reconciliation">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {isLoading ? <Skeleton className="size-9 rounded-full" />
              : problems ? <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"><AlertTriangle className="size-5" /></span>
              : <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><CheckCircle2 className="size-5" /></span>}
            <div className="min-w-0">
              <p className="font-semibold">
                {isLoading ? "Checking payouts…" : !data ? "Payouts haven't been checked against Stripe yet"
                  : data.issues.length ? `${data.issues.length} payout${data.issues.length === 1 ? "" : "s"} don't match Stripe`
                  : data.failures.length ? "Some kitchens couldn't be checked" : "Every kitchen's payouts match Stripe"}
              </p>
              <p className="text-sm text-muted-foreground">
                {data ? <>Checked {when(data.checkedAt)} · {data.kitchens} kitchen{data.kitchens === 1 ? "" : "s"} · {data.transfers} transfers
                  {data.repairedReversals ? ` · ${data.repairedReversals} reversal${data.repairedReversals === 1 ? "" : "s"} saved from Stripe` : ""}</>
                  : "Runs every morning. Compares each kitchen's Revenue page with the transfers Stripe holds; nothing is moved."}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void run()} disabled={running}>
            {running ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <RefreshCw className="mr-1.5 size-4" />}Run check now
          </Button>
        </div>
        {(error || runError) && <p role="alert" className="text-sm text-destructive">{runError || (error as Error).message}</p>}
        {data && problems > 0 && (
          <ul className="divide-y rounded-xl border">
            {data.issues.map(issue => (
              <li key={`${issue.transferId}-${issue.kind}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{issue.kitchenName}</p>
                  <p className="text-muted-foreground">{KIND[issue.kind]} · Revenue page {money(issue.pageCents)} · Stripe {money(issue.stripeCents)}</p>
                </div>
                <a className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline" target="_blank" rel="noopener noreferrer"
                  href={`https://dashboard.stripe.com/connect/transfers/${encodeURIComponent(issue.transferId)}`}>{issue.transferId}<ExternalLink className="size-3.5" /></a>
              </li>
            ))}
            {data.failures.map(failure => (
              <li key={`failure-${failure.managerId}`} className="px-4 py-3 text-sm">
                <p className="font-medium">{failure.kitchenName}</p>
                <p className="text-muted-foreground">Couldn't be checked: {failure.error}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
