import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime } from "@/lib/formatters";
import type { ChangeSchedule } from "@shared/kitchen-booking-change";
import { fmtMoney } from "./format";
import { SupportApiError, type TokenGetter } from "./api";
import { useSupportT } from "./useSupportT";

export type RecoveryAction = "finish" | "compensate" | "close_keep_refund";

export type KitchenChangeMoney = {
  oldTotalCents: number; newTotalCents: number; payCents: number; refundCents: number;
  feeKeptCents: number; currency: string;
};

export type KitchenChangeOpen = {
  id: string; state: string; revision: number;
  original: ChangeSchedule; destination: ChangeSchedule;
  money: KitchenChangeMoney;
  steps?: { state: string; message: string; at: string }[];
};

type ChangesResponse = { open?: KitchenChangeOpen; timezone?: string | null };

const ACTIONS: RecoveryAction[] = ["finish", "compensate", "close_keep_refund"];

async function callChanges<T>(getToken: TokenGetter, url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    const token = await getToken();
    res = await fetch(url, {
      ...init,
      headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new SupportApiError(0, "");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new SupportApiError(res.status, typeof body?.error === "string" ? body.error : "");
  return body as T;
}

export function formatChangeSchedule(schedule: ChangeSchedule, locale = "en-CA"): string {
  const day = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })
    .format(new Date(`${schedule.date}T12:00:00Z`));
  const start = formatTime(schedule.slots[0]?.startTime || "", locale);
  const end = formatTime(schedule.slots.at(-1)?.endTime || "", locale);
  return `${day} · ${start}–${end}`;
}

function reasonOf(change: KitchenChangeOpen): string {
  const recovery = [...(change.steps || [])].reverse().find((step) => step.state === "recovery_required");
  return recovery?.message || change.steps?.at(-1)?.message || "";
}

function moneyMovedSummary(t: ReturnType<typeof useSupportT>, money: KitchenChangeMoney): string {
  const currency = money.currency || "CAD";
  if (money.payCents > 0) return t("bsChangeMoneyCharged", { amount: fmtMoney(money.payCents, currency) });
  if (money.refundCents > 0) {
    const refund = t("bsChangeMoneyRefunded", { amount: fmtMoney(money.refundCents, currency) });
    return money.feeKeptCents > 0
      ? `${refund} ${t("bsChangeMoneyFeeKept", { amount: fmtMoney(money.feeKeptCents, currency) })}`
      : refund;
  }
  return t("bsChangeMoneyNone");
}

export function KitchenChangeRecovery({
  bookingId, getFirebaseToken,
}: { bookingId: number; getFirebaseToken: TokenGetter }) {
  const t = useSupportT();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<RecoveryAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const queryKey = ["/api/bookings", bookingId, "changes"] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => callChanges<ChangesResponse>(getFirebaseToken, `/api/bookings/${bookingId}/changes`),
    retry: false,
  });

  const resolve = useMutation({
    mutationFn: (action: RecoveryAction) => {
      const open = query.data?.open;
      if (!open) throw new SupportApiError(409, t("bsChangeStale"));
      return callChanges(getFirebaseToken, `/api/bookings/${bookingId}/changes/${open.id}/recovery`, {
        method: "POST",
        body: JSON.stringify({ action, revision: open.revision }),
      });
    },
    onSuccess: async () => {
      setPending(null); setError(null); setStale(false);
      await queryClient.invalidateQueries({ queryKey });
      await query.refetch();
    },
    onError: (cause) => {
      const api = cause instanceof SupportApiError ? cause : new SupportApiError(0, "");
      const message = api.message || t("bsErrServerGeneric");
      setError(message);
      setStale(api.status === 409 && /refresh and try again/i.test(message));
      setPending(null);
    },
  });

  const open = query.data?.open;
  if (query.isLoading) return null;
  if (!open || open.state !== "recovery_required") return null;

  const current = formatChangeSchedule(open.original);
  const requested = formatChangeSchedule(open.destination);
  const moneyLine = moneyMovedSummary(t, open.money);
  const reason = reasonOf(open);
  const confirmAmount = open.money.payCents > 0
    ? fmtMoney(open.money.payCents, open.money.currency)
    : open.money.refundCents > 0
      ? fmtMoney(open.money.refundCents, open.money.currency)
      : fmtMoney(0, open.money.currency);

  return (
    <Card data-testid="kitchen-change-recovery" className="border-warning/40 bg-warning/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("bsChangeRecoveryTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("bsChangeRecoveryIntro")}</p>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("bsChangeCurrentTime")}</dt>
            <dd className="text-right font-medium" data-testid="change-current-time">{current}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("bsChangeRequestedTime")}</dt>
            <dd className="text-right font-medium" data-testid="change-requested-time">{requested}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("bsChangeMoneyMoved")}</dt>
            <dd className="text-right font-medium" data-testid="change-money-moved">{moneyLine}</dd>
          </div>
        </dl>
        {reason && <p className="rounded-lg border bg-background/80 p-2.5 text-sm" data-testid="change-recovery-reason">{reason}</p>}
        <div className="flex flex-wrap gap-2">
          {ACTIONS.map((action) => (
            <Button key={action} type="button" variant="outline" disabled={resolve.isPending}
              data-testid={`change-recovery-${action}`}
              onClick={() => { setError(null); setStale(false); setPending(action); }}>
              {t(`bsChangeAction_${action}`)}
            </Button>
          ))}
        </div>
        {error && (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{error}</p>
            {stale && (
              <Button type="button" size="sm" variant="outline" onClick={() => { setError(null); setStale(false); void query.refetch(); }}>
                {t("bsRefresh")}
              </Button>
            )}
          </div>
        )}
      </CardContent>

      <AlertDialog open={pending !== null} onOpenChange={(next) => { if (!next && !resolve.isPending) setPending(null); }}>
        {pending && (
          <AlertDialogContent data-testid="change-recovery-confirm">
            <AlertDialogHeader>
              <AlertDialogTitle>{t(`bsChangeAction_${pending}`)}</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2 text-left">
                <span className="block">{t(`bsChangeConfirm_${pending}`, {
                  current, requested, amount: confirmAmount, money: moneyLine,
                })}</span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={resolve.isPending}>{t("bsClose")}</AlertDialogCancel>
              <AlertDialogAction
                disabled={resolve.isPending}
                onClick={(event) => { event.preventDefault(); resolve.mutate(pending); }}
              >
                {resolve.isPending ? t("bsChangeWorking") : t("bsChangeConfirmDo")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </Card>
  );
}
