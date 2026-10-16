/**
 * The kitchen's "More" actions for one storage rental (WP-ST11 / WP-ST9).
 *
 * The menu lists exactly the actions the server put in the DTO's `actions[]`, so a tool shows up
 * only once its endpoint exists. Selecting one opens a confirm view that states the consequence —
 * with the amount and the date — before anything is sent.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MoreHorizontal } from "@/components/ui/manager-icons";
import { formatBookingDate, formatCurrency } from "@/lib/formatters";
import { getAuthHeaders } from "@/lib/api";
import {
  actionAmountCents, actionBody, allowedActions, formatKitchenDateTime, rentalTotalCents,
  type StorageActionDef, type StorageActionField, type StorageRental,
} from "@/lib/storage-board";

type Values = Partial<Record<StorageActionField, number | string>>;

function fieldLabelKey(field: StorageActionField): string {
  switch (field) {
    case "unitIndex": return "stUnitFieldLabel";
    case "byDate": return "stDateLabel";
    case "days": return "stDaysLabel";
    case "amountCents": return "stAmountLabel";
    default: return "stNoteLabel";
  }
}

function consequenceParams(rental: StorageRental, def: StorageActionDef, values: Values, amountCents: number | null) {
  return {
    chef: rental.chef?.name ?? "",
    listing: rental.listing.name,
    unit: values.unitIndex != null ? String(values.unitIndex) : rental.unitLabel,
    start: formatBookingDate(rental.startOn),
    end: formatBookingDate(rental.paidThrough),
    days: values.days ?? def.defaults.days ?? "",
    date: typeof values.byDate === "string" && values.byDate ? formatBookingDate(values.byDate) : formatBookingDate(rental.paidThrough),
    amount: amountCents != null ? formatCurrency(amountCents) : formatCurrency(rentalTotalCents(rental)),
    action: def.action,
  };
}

export function StorageMoreActions({ rental, onDone }: { rental: StorageRental; onDone: () => void }) {
  const { t, i18n } = useTranslation("storage");
  const actions = allowedActions(rental);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<StorageActionDef | null>(null);
  const [values, setValues] = useState<Values>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => { setActive(null); setValues({}); setReason(""); setError(null); };
  const amountCents = active ? actionAmountCents(rental, active, numericValues(values)) : null;

  function numericValues(input: Values): Partial<Record<StorageActionField, number>> {
    const out: Partial<Record<StorageActionField, number>> = {};
    if (typeof input.unitIndex === "number") out.unitIndex = input.unitIndex;
    if (typeof input.days === "number") out.days = input.days;
    if (typeof input.amountCents === "number") out.amountCents = input.amountCents;
    return out;
  }

  async function submit() {
    if (!active) return;
    if (active.requiresReason && !reason.trim()) { setError(t("stReasonRequired")); return; }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/manager/storage-rentals/${rental.id}/${active.action}`, {
        method: "POST",
        headers: { ...(await getAuthHeaders()), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(actionBody(active, values, reason)),
      });
      if (!response.ok) throw new Error(t("stActionFailed"));
      setOpen(false);
      reset();
      onDone();
    } catch {
      setError(t("stActionFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => { reset(); setOpen(true); }}>
        <MoreHorizontal className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("stMore")}
      </Button>
      <Sheet open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          {active ? (
            <div className="space-y-4">
              <SheetHeader>
                <SheetTitle>{t(active.labelKey)}</SheetTitle>
                <SheetDescription>{t("stConsequenceHeading")}</SheetDescription>
              </SheetHeader>
              {active.fields.map((field) => (
                <div key={field} className="space-y-1.5">
                  <Label htmlFor={`action-${field}`}>{t(fieldLabelKey(field))}</Label>
                  {field === "note" ? (
                    <Textarea id={`action-${field}`} value={reason} onChange={(event) => setReason(event.target.value)} />
                  ) : field === "byDate" ? (
                    <Input id={`action-${field}`} type="date" value={typeof values.byDate === "string" ? values.byDate : ""}
                      onChange={(event) => setValues((prev) => ({ ...prev, byDate: event.target.value }))} />
                  ) : (
                    <Input id={`action-${field}`} type="number" inputMode="numeric" min={field === "amountCents" ? 0 : 1} step={field === "amountCents" ? 0.01 : 1}
                      value={values[field] == null ? "" : String(values[field])}
                      onChange={(event) => {
                        const raw = event.target.value;
                        const parsed = raw === "" ? undefined : Number(raw);
                        setValues((prev) => ({ ...prev, [field]: field === "amountCents" && parsed != null ? Math.round(parsed * 100) : parsed }));
                      }} />
                  )}
                </div>
              ))}
              {active.requiresReason && !active.fields.includes("note") && (
                <div className="space-y-1.5">
                  <Label htmlFor="action-reason">{t("stReasonLabel")}</Label>
                  <Textarea id="action-reason" value={reason} placeholder={t("stReasonPlaceholder")} onChange={(event) => setReason(event.target.value)} />
                </div>
              )}
              <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">{t(active.consequenceKey, consequenceParams(rental, active, values, amountCents))}</p>
              <dl className="space-y-1 text-sm">
                {amountCents != null && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{t("stAmountLabel")}</dt>
                    <dd data-testid="action-amount" className="font-medium tabular-nums">{formatCurrency(amountCents)}</dd>
                  </div>
                )}
                {typeof values.byDate === "string" && values.byDate && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{t("stDateLabel")}</dt>
                    <dd data-testid="action-date" className="font-medium">{formatBookingDate(values.byDate)}</dd>
                  </div>
                )}
              </dl>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="ghost" onClick={() => setActive(null)}>{t("stBack")}</Button>
                <Button onClick={() => void submit()} disabled={saving}>{t("stConfirm")}</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <SheetHeader>
                <SheetTitle>{t("stMoreTitle")}</SheetTitle>
                <SheetDescription>{formatKitchenDateTime(new Date().toISOString(), rental.timezone, i18n.language)}</SheetDescription>
              </SheetHeader>
              {actions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("stMoreEmpty")}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {actions.map((def) => (
                    <Button key={def.action} variant="outline" className="justify-start" onClick={() => { setActive(def); setValues({}); setReason(""); setError(null); }}>
                      {t(def.labelKey)}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
