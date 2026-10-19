/**
 * One pending storage request on the kitchen's Storage board (WP-ST11).
 *
 * The board answers requests before anything else: this card carries the chef, the dates, the total,
 * the answer deadline and the two decisions. Approve and Decline are gated on the DTO's `actions[]`,
 * and a decline always carries a reason.
 */
import { useRef, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Clock } from "@/components/ui/manager-icons";
import { formatBookingDate, formatCurrency } from "@/lib/formatters";
import { getAuthHeaders } from "@/lib/api";
import { formatKitchenDateTime, formatStorageDate, rentalTotalCents, type StorageRental } from "@/lib/storage-board";

export function StorageRequestCard({ rental, onDone }: { rental: StorageRental; onDone: () => void }) {
  const { t, i18n } = useTranslation("storage");
  const returnFocus = useRef<HTMLElement | null>(null);
  const chef = rental.chef?.name || t('stTheChef');
  const [decision, setDecision] = useState<"approve" | "decline" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const total = rentalTotalCents(rental);
  const payoutLine = rental.estimatedPayoutCents != null
    ? t("stRequestPayout", { total: formatCurrency(total), payout: formatCurrency(rental.estimatedPayoutCents) })
    : t("stRequestTotal", { amount: formatCurrency(total) });
  const canApprove = rental.actions.includes("approve");
  const canDecline = rental.actions.includes("decline");

  const close = () => { setDecision(null); setReason(""); setError(null); };

  async function submit() {
    if (!decision) return;
    if (decision === "decline" && !reason.trim()) { setError(t("stReasonRequired")); return; }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/manager/storage-rentals/${rental.id}/${decision}`, {
        method: "POST",
        headers: { ...(await getAuthHeaders()), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(decision === "decline" ? { reason: reason.trim() } : {}),
      });
      if (!response.ok) throw new Error(t("stDecisionFailed"));
      close();
      onDone();
    } catch {
      setError(t("stDecisionFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="shadow-none">
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-1.5 font-medium">
            <Avatar className="h-7 w-7"><AvatarFallback className="text-xs">{chef.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()}</AvatarFallback></Avatar>
            <span className="truncate">{chef}</span>
          </div>
          <p className="truncate text-sm text-muted-foreground">{rental.listing.name} · {t("stUnitLabel", { index: rental.unitLabel })}</p>
          <p className="text-sm">{formatStorageDate(rental.startOn, i18n.language)} – {formatStorageDate(rental.paidThrough, i18n.language)} · {t("stTermDays", { days: rental.terms.reduce((sum, term) => sum + term.days, 0) })}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span>{payoutLine}</span>
            {rental.responseDeadline && (
              <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {t("stAnswerBy", { time: formatKitchenDateTime(rental.responseDeadline, rental.timezone, i18n.language) })}
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canApprove && <Button className="h-11 shadow-none hover:shadow-none" size="sm" onClick={event => { returnFocus.current = event.currentTarget; close(); setDecision("approve"); }}>{t("stApprove")}</Button>}
          {canDecline && <Button className="h-11" size="sm" variant="outline" onClick={event => { returnFocus.current = event.currentTarget; close(); setDecision("decline"); }}>{t("stDecline")}</Button>}
          <Button asChild className="h-11" size="sm" variant="ghost"><Link href={`/manager/storage/${rental.id}`}>{t("stViewUnit")}</Link></Button>
        </div>
      </CardContent>

      <Sheet open={decision !== null} onOpenChange={(next) => { if (!next) close(); }}>
        <SheetContent hideClose side="right" className="w-full overflow-y-auto sm:max-w-md" onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}>
          {decision && (
            <div className="space-y-4">
              <SheetHeader>
                <SheetTitle>{decision === "approve" ? t("stApproveTitle") : t("stDeclineTitle")}</SheetTitle>
                <SheetDescription>
                  {decision === "approve"
                    ? t("stApproveBody", { chef: rental.chef?.name ?? "", listing: rental.listing.name, amount: formatCurrency(total), unit: rental.unitLabel, start: formatBookingDate(rental.startOn), end: formatBookingDate(rental.paidThrough) })
                    : t("stDeclineBody", { chef: rental.chef?.name ?? "", listing: rental.listing.name, amount: formatCurrency(total) })}
                </SheetDescription>
              </SheetHeader>
              {decision === "approve" && <p className="text-sm font-medium">{payoutLine}</p>}
              {decision === "decline" && (
                <div className="space-y-1.5">
                  <Label htmlFor="decline-reason">{t("stReasonLabel")}</Label>
                  <Textarea id="decline-reason" value={reason} placeholder={t("stReasonPlaceholder")} onChange={(event) => setReason(event.target.value)} />
                </div>
              )}
              <dl className="space-y-1 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{t("stAmountLabel")}</dt>
                  <dd data-testid="decision-amount" className="font-medium tabular-nums">{formatCurrency(total)}</dd>
                </div>
              </dl>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <div className="flex flex-col-reverse gap-2 [&>button]:min-h-11 sm:flex-row sm:justify-end">
                <Button variant="ghost" onClick={close}>{t("stCancel")}</Button>
                <Button onClick={() => void submit()} disabled={saving}>
                  {decision === "approve" ? t("stApproveSubmit") : t("stDeclineSubmit")}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}
