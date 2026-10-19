import { PhotoRequirementUploader, flattenPhotos } from "@/components/booking/PhotoRequirementUploader";
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
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatBookingDate, formatCurrency } from "@/lib/formatters";
import { getAuthHeaders } from "@/lib/api";
import {
  actionAmountCents, actionBody, allowedActions, rentalTotalCents,
  type StorageActionDef, type StorageActionField, type StorageRental,
} from "@/lib/storage-board";

type Values = Partial<Record<StorageActionField, number | string>>;

function fieldLabelKey(field: StorageActionField): string {
  switch (field) {
    case "unitIndex": return "stUnitFieldLabel";
    case "byDate": return "stDateLabel";
    case "days": return "stDaysLabel";
    case "amountCents": return "stAmountLabel";
    case "photoUrls": return "stPhotosLabel";
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
  const { t } = useTranslation("storage");
  const actions = allowedActions(rental);
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<StorageActionDef | null>(null);
  const [values, setValues] = useState<Values>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ amountCents: number; date?: string; byDate?: string } | null>(null);
  const [operationKey, setOperationKey] = useState('');

  const reset = () => { setActive(null); setValues({}); setReason(""); setError(null); setPhotos({}); };
  const needsPreview = active && ['move-out-by', 'refund', 'offer-extension'].includes(active.action);
  const amountCents = needsPreview ? preview?.amountCents ?? null : active ? actionAmountCents(rental, active, numericValues(values)) : null;
  async function loadPreview() {
    if (!active) return;
    setSaving(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (values.byDate) params.set('date', String(values.byDate));
      if (values.days) params.set('days', String(values.days));
      if (values.amountCents !== undefined) params.set('amountCents', String(values.amountCents));
      const response = await fetch(`/api/manager/storage-rentals/${rental.id}/${active.action}/preview?${params}`, { headers: await getAuthHeaders(), credentials: 'include' });
      if (!response.ok) throw Error();
      const result = await response.json();
      setPreview(result);
      if (active.action === 'refund' && !values.amountCents) setValues(prev => ({ ...prev, amountCents: result.amountCents }));
    } catch { setError(t('stActionFailed')); } finally { setSaving(false); }
  }

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
    if (active.fields.includes("photoUrls") && !flattenPhotos(photos).length) { setError(t("stPhotoEvidenceRequired")); return; }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/manager/storage-rentals/${rental.id}/${active.action}`, {
        method: "POST",
        headers: { ...(await getAuthHeaders()), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...actionBody(active, values, reason), operationKey,
          ...(active.fields.includes("photoUrls") ? { photoUrls: flattenPhotos(photos) } : {}),
          ...(active.action === 'removal/record' ? { itemIndexes: rental.removalItemIndexes, note: reason } : {}) }),
      });
      if (!response.ok) throw new Error(t("stActionFailed"));
      const result = await response.json();
      if (result?.recoveryRequired) throw new Error(t('stActionFailed'));
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
      {actions.map(def => <Button key={def.action} variant="outline" size="sm" onClick={() => {
        reset(); setActive(def); setValues({ ...def.defaults, ...(def.action === 'holdover-charge' ? { amountCents: rental.holdoverChargeCents ?? rental.accruedCents } : {}) });
        setPreview(null); setOperationKey(crypto.randomUUID()); setOpen(true);
      }}>{t(def.labelKey as never)}</Button>)}
      <Sheet open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          {active ? (
            <div className="space-y-4">
              <SheetHeader>
                <SheetTitle>{t(active.labelKey as never)}</SheetTitle>
                <SheetDescription>{t("stConsequenceHeading")}</SheetDescription>
              </SheetHeader>
              {active.fields.map((field) => (
                <div key={field} className="space-y-1.5">
                  <Label htmlFor={`action-${field}`}>{t(fieldLabelKey(field) as never)}</Label>
                  {field === 'photoUrls' ? <PhotoRequirementUploader requirements={[]} photos={photos} onPhotosChange={setPhotos} uploadFolder="storage-handover" disabled={saving} genericInstruction={t("stPhotosLabel")} /> : field === "note" ? (
                    <Textarea id={`action-${field}`} value={reason} onChange={(event) => setReason(event.target.value)} />
                  ) : field === "byDate" ? (
                    <DateField id={`action-${field}`} minToday={false} value={typeof values.byDate === "string" ? values.byDate : ""}
                      placeholder={t(fieldLabelKey(field) as never)}
                      onChange={(value) => { setPreview(null); setValues((prev) => ({ ...prev, byDate: value })); }} />
                  ) : (
                    <Input id={`action-${field}`} type="number" inputMode="numeric" min={field === "amountCents" ? 0 : 1} step={field === "amountCents" ? 0.01 : 1}
                      value={values[field] == null ? "" : String(field === 'amountCents' ? Number(values[field]) / 100 : values[field])}
                      onChange={(event) => {
                        setPreview(null);
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
              <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">{needsPreview && !preview ? t('stPreviewPrompt') : t(active.consequenceKey as never, consequenceParams(rental, active, values, amountCents))}</p>
              <dl className="space-y-1 text-sm">
                <div>{t('stDatePaidThrough', { date: formatBookingDate(rental.paidThrough) })}</div>
                {preview?.date && <div>{formatBookingDate(preview.date)}</div>}
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
                <Button variant="ghost" onClick={() => { setOpen(false); reset(); }}>{t("stCancel")}</Button>
                {needsPreview && !preview ? <Button onClick={() => void loadPreview()} disabled={saving}>{t('stPreview')}</Button>
                  : <Button onClick={() => void submit()} disabled={saving}>{t("stConfirm")}</Button>}
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
