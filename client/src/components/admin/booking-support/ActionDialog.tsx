import { useRef, useState, type ReactNode } from "react";
import { useSupportT } from "./useSupportT";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { AppDialogBody, AppDialogContent, AppDialogFooter, AppDialogHeader } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { NativeSelect } from "./NativeSelect";
import { fmtMoney } from "./format";
import { postAction, SupportApiError, type TokenGetter } from "./api";
import {
  ACTION_SPECS, REQUEST_SOURCES, buildActionRequest, eligibleCodeTargets, initialForm, lifecycleEvents,
  pendingItems, previewForDisplay, type ActionForm,
} from "./action-form";
import type { ActionResult, AvailableSupportAction, SupportCase } from "./types";

type Props = {
  action: AvailableSupportAction | null;
  supportCase: SupportCase;
  getFirebaseToken: TokenGetter;
  onClose: () => void;
  onCaseUpdated: (next: SupportCase) => void;
};

export function ActionDialog(props: Props) {
  const { action, onClose } = props;
  return (
    <Dialog open={action !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      {action && <ActionDialogContent key={action.type} {...props} action={action} />}
    </Dialog>
  );
}

function newOperationKey(bookingId: number) {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `support-${bookingId}-${id}`;
}

function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-medium">{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ActionDialogContent({ action, supportCase: c, getFirebaseToken, onClose, onCaseUpdated }: Props & { action: AvailableSupportAction }) {
  const t = useSupportT();
  const type = action.type;
  const spec = ACTION_SPECS[type];
  // One key per dialog open. A retry of the same request reuses it, so the server never does the work twice.
  const operationKey = useRef(newOperationKey(c.bookingId)).current;
  const [form, setForm] = useState<ActionForm>(() => initialForm(type, c));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stage, setStage] = useState<"form" | "exception" | "result">("form");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  /** After an answer we never received, the request is frozen so a retry is exactly the same request. */
  const [locked, setLocked] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const set = <K extends keyof ActionForm>(key: K, value: ActionForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const err = (key: string) => (errors[key] ? t(errors[key]) : undefined);

  const actionLabel = t(`bsAction_${type}`, { defaultValue: action.label });
  const preview = previewForDisplay(type, action.moneyPreview, form.amount);
  const isGoodwill = type === "goodwill_refund";
  const currency = preview.currency;
  const limit = fmtMoney(action.moneyPreview.requiresExceptionAboveCents, currency);

  async function send(confirmException: boolean) {
    const built = buildActionRequest(type, c, form, operationKey, confirmException);
    if (!built.ok) { setErrors(built.errors); setStage("form"); return; }
    setErrors({});
    if (built.needsException && !confirmException) { setStage("exception"); return; }
    setSubmitting(true);
    setServerError(null);
    try {
      const data = await postAction(getFirebaseToken, c.bookingId, built.body);
      // The returned case is always the truth, whatever the action's status.
      onCaseUpdated(data.case);
      setResult(data);
      if (data.action.status === "verified") {
        toast.success(t("bsToastDone", { action: actionLabel }));
        onClose();
        return;
      }
      setStage("result");
    } catch (e) {
      const apiError = e instanceof SupportApiError ? e : new SupportApiError(0, "");
      if (apiError.outcomeUnknown) setLocked(true);
      setServerError(apiError.message || (apiError.status === 0 ? t("bsErrNetwork") : t("bsErrServerGeneric")));
      setStage("form");
    } finally {
      setSubmitting(false);
    }
  }

  const readOnly = locked || submitting;

  const header = (
    <AppDialogHeader title={actionLabel} description={t("bsDialogIntro", { reference: c.referenceCode })} />
  );

  if (stage === "result" && result) {
    const status = result.action.status;
    return (
      <AppDialogContent className="p-0 gap-0 overflow-hidden sm:max-w-lg">
        {header}
        <AppDialogBody>
          <div role="alert" className={`rounded-xl border p-4 ${status === "executing" ? "border-warning/40 bg-warning/10" : "border-destructive/40 bg-destructive/5"}`} data-testid="action-result">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
              <div className="space-y-2 text-sm">
                <p className="font-semibold">{t(`bsResult_${status}_title`)}</p>
                <p>{t(`bsResult_${status}_body`)}</p>
                {result.replayed && <p className="text-muted-foreground">{t("bsResultReplayed")}</p>}
              </div>
            </div>
          </div>
        </AppDialogBody>
        <AppDialogFooter><Button onClick={onClose}>{t("bsClose")}</Button></AppDialogFooter>
      </AppDialogContent>
    );
  }

  if (stage === "exception") {
    return (
      <AppDialogContent className="p-0 gap-0 overflow-hidden sm:max-w-lg">
        {header}
        <AppDialogBody>
          <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm" data-testid="exception-confirm">
            <p className="font-semibold">{t("bsExceptionQuestion", { limit })}</p>
            <p>{t("bsExceptionBody")}</p>
          </div>
        </AppDialogBody>
        <AppDialogFooter>
          <Button variant="outline" onClick={() => setStage("form")} disabled={submitting}>{t("bsBack")}</Button>
          <Button onClick={() => void send(true)} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}{t("bsExceptionConfirm")}
          </Button>
        </AppDialogFooter>
      </AppDialogContent>
    );
  }

  const row = (label: string, value: number | null, nullText: string) => (
    <div className="flex justify-between gap-3 text-sm"><dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value == null ? <span className="font-normal text-muted-foreground">{nullText}</span> : fmtMoney(value, currency)}</dd></div>
  );
  const nullText = isGoodwill ? t("bsCalcWhenAmount") : t("bsNotVerified");
  const targets = eligibleCodeTargets(c);
  const events = lifecycleEvents(c);
  const items = pendingItems(c);
  const messageOffered = spec.fields.includes("message");
  const selfArrival = type === "set_arrival_mode" && !form.allTargets && form.mode === "self";
  const visitLabel = (v: SupportCase["visits"][number]) => t("bsVisitN", { n: v.blockIndex + 1 });

  return (
    <AppDialogContent className="p-0 gap-0 overflow-hidden sm:max-w-xl">
      {header}
      <form onSubmit={(e) => { e.preventDefault(); void send(false); }} className="flex min-h-0 flex-1 flex-col">
        <AppDialogBody className="space-y-5">
          {serverError && (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="server-error">
              <p>{serverError}</p>
              {locked && <p className="mt-1 text-muted-foreground">{t("bsRetryLocked")}</p>}
            </div>
          )}
          {errors.form && <p role="alert" className="text-sm text-destructive">{t(errors.form)}</p>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("bsActingFor")} htmlFor="bs-acting">
              <NativeSelect id="bs-acting" value={form.actingFor} disabled={readOnly || spec.acting.length === 1} onChange={(e) => set("actingFor", e.target.value as ActionForm["actingFor"])}>
                {spec.acting.map((a) => <option key={a} value={a}>{t(`bsActing_${a}`)}</option>)}
              </NativeSelect>
            </Field>
            <Field label={t("bsRequestSource")} htmlFor="bs-source">
              <NativeSelect id="bs-source" value={form.requestSource} disabled={readOnly} onChange={(e) => set("requestSource", e.target.value as ActionForm["requestSource"])}>
                {REQUEST_SOURCES.map((s) => <option key={s} value={s}>{t(`bsSource_${s}`)}</option>)}
              </NativeSelect>
            </Field>
          </div>

          <Field label={t("bsReason")} htmlFor="bs-reason" error={err("reason")}>
            <NativeSelect id="bs-reason" value={form.reason} disabled={readOnly} onChange={(e) => set("reason", e.target.value)}>
              {spec.reasons.map((r) => <option key={r} value={r}>{t(`bsReason_${r}`)}</option>)}
            </NativeSelect>
            {form.reason === "other" && (
              <Input aria-label={t("bsReasonOtherLabel")} placeholder={t("bsReasonOtherPlaceholder")} value={form.reasonOther} disabled={readOnly} maxLength={90} onChange={(e) => set("reasonOther", e.target.value)} />
            )}
          </Field>

          {/* Per-action details */}
          {spec.fields.includes("items") && items.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("bsItemsLegend")}</legend>
              {items.map((i) => (
                <div key={i.key} className="flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm">
                  <span>{t(i.kind === "storage" ? "bsItemStorage" : "bsItemEquipment", { id: i.id })} · {fmtMoney(i.totalPriceCents, currency)}</span>
                  <NativeSelect aria-label={t("bsItemDecision", { id: i.id })} className="h-9 w-40" disabled={readOnly} value={form.itemDecisions[i.key]}
                    onChange={(e) => set("itemDecisions", { ...form.itemDecisions, [i.key]: e.target.value as "confirmed" | "cancelled" })}>
                    <option value="confirmed">{t("bsItemKeep")}</option>
                    <option value="cancelled">{t("bsItemRemove")}</option>
                  </NativeSelect>
                </div>
              ))}
            </fieldset>
          )}

          {spec.fields.includes("quote") && (
            c.cancellationQuote
              ? <p className="rounded-lg bg-muted/50 p-3 text-sm">{t("bsQuoteNote", { amount: fmtMoney(c.cancellationQuote.chefReceivesCents, currency) })}</p>
              : <p role="alert" className="text-sm text-destructive">{t("bsErrNoQuote")}</p>
          )}

          {spec.fields.includes("codeTarget") && c.visitCodes.length > 0 && (
            <Field label={t("bsCodeTarget")} htmlFor="bs-target" error={err("targetKey")}>
              <NativeSelect id="bs-target" value={form.targetKey} disabled={readOnly} onChange={(e) => set("targetKey", e.target.value)}>
                {targets.map((v) => <option key={v.targetKey} value={v.targetKey}>{v.visitId ? t("bsVisitN", { n: (c.visits.find((x) => x.id === v.visitId)?.blockIndex ?? 0) + 1 }) : v.targetKey}</option>)}
              </NativeSelect>
            </Field>
          )}

          {spec.fields.includes("arrival") && (
            <div className="space-y-4">
              {!form.allTargets && (
                <Field label={t("bsCodeTarget")} htmlFor="bs-target" error={err("targetKey")}>
                  <NativeSelect id="bs-target" value={form.targetKey} disabled={readOnly} onChange={(e) => set("targetKey", e.target.value)}>
                    {targets.map((v) => <option key={v.targetKey} value={v.targetKey}>{v.visitId ? t("bsVisitN", { n: (c.visits.find((x) => x.id === v.visitId)?.blockIndex ?? 0) + 1 }) : v.targetKey}</option>)}
                  </NativeSelect>
                </Field>
              )}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.allTargets} disabled={readOnly} onChange={(e) => set("allTargets", e.target.checked)} />{t("bsAllVisits")}</label>
              <Field label={t("bsArrivalMode")} htmlFor="bs-mode">
                <NativeSelect id="bs-mode" value={form.mode} disabled={readOnly} onChange={(e) => set("mode", e.target.value as "staffed" | "self")}>
                  <option value="staffed">{t("bsModeStaffed")}</option>
                  <option value="self">{t("bsModeSelf")}</option>
                </NativeSelect>
              </Field>
            </div>
          )}

          {spec.fields.includes("visit") && c.visits.length > 0 && (
            <Field label={t("bsVisit")} htmlFor="bs-visit" error={err("visitId")}>
              <NativeSelect id="bs-visit" value={form.visitId} disabled={readOnly} onChange={(e) => set("visitId", e.target.value)}>
                {c.visits.map((v) => <option key={v.id} value={String(v.id)}>{visitLabel(v)}</option>)}
              </NativeSelect>
            </Field>
          )}
          {spec.fields.includes("codeTarget") && c.visitCodes.length === 0 && c.visits.length > 0 && (
            <Field label={t("bsVisit")} htmlFor="bs-visit" error={err("visitId")}>
              <NativeSelect id="bs-visit" value={form.visitId} disabled={readOnly} onChange={(e) => set("visitId", e.target.value)}>
                {c.visits.map((v) => <option key={v.id} value={String(v.id)}>{visitLabel(v)}</option>)}
              </NativeSelect>
            </Field>
          )}

          {spec.fields.includes("actualAt") && (
            <Field label={t("bsActualAt", { zone: c.schedule.zoneLabel })} htmlFor="bs-actual" error={err("actualAt")} hint={t("bsActualAtHint", { zone: c.schedule.zoneLabel })}>
              <Input id="bs-actual" type="datetime-local" value={form.actualAt} disabled={readOnly} onChange={(e) => set("actualAt", e.target.value)} />
            </Field>
          )}

          {spec.fields.includes("attendance") && (
            <div className="space-y-3">
              <Field label={t("bsAttendanceAction")} htmlFor="bs-attendance">
                <NativeSelect id="bs-attendance" value={form.attendanceAction} disabled={readOnly} onChange={(e) => set("attendanceAction", e.target.value as ActionForm["attendanceAction"])}>
                  <option value="report_attended">{t("bsAttendance_report_attended")}</option>
                  <option value="report_no_show">{t("bsAttendance_report_no_show")}</option>
                  <option value="withdraw_attendance">{t("bsAttendance_withdraw_attendance")}</option>
                </NativeSelect>
              </Field>
              {form.attendanceAction === "report_no_show" && (
                <div>
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={form.confirmsChefAbsent} disabled={readOnly} onChange={(e) => set("confirmsChefAbsent", e.target.checked)} />{t("bsConfirmAbsent")}</label>
                  {err("confirmsChefAbsent") && <p role="alert" className="mt-1 text-xs text-destructive">{err("confirmsChefAbsent")}</p>}
                </div>
              )}
            </div>
          )}

          {spec.fields.includes("claim") && (
            <div className="space-y-3">
              <Field label={t("bsClaimTitle")} htmlFor="bs-claim-title" error={err("claimTitle")}>
                <Input id="bs-claim-title" value={form.claimTitle} disabled={readOnly} maxLength={200} onChange={(e) => set("claimTitle", e.target.value)} />
              </Field>
              <Field label={t("bsClaimDescription")} htmlFor="bs-claim-desc" error={err("claimDescription")} hint={t("bsClaimDescriptionHint")}>
                <Textarea id="bs-claim-desc" value={form.claimDescription} disabled={readOnly} maxLength={2000} onChange={(e) => set("claimDescription", e.target.value)} />
              </Field>
              <Field label={t("bsClaimAmount")} htmlFor="bs-claim-amount" error={err("claimedAmount")} hint={t("bsClaimAmountHint")}>
                <Input id="bs-claim-amount" inputMode="decimal" value={form.claimedAmount} disabled={readOnly} onChange={(e) => set("claimedAmount", e.target.value)} />
              </Field>
            </div>
          )}

          {spec.fields.includes("amount") && (
            <Field label={t("bsGoodwillAmount")} htmlFor="bs-amount" error={err("amount")}
              hint={action.moneyPreview.maximumCents != null ? t("bsGoodwillMax", { max: fmtMoney(action.moneyPreview.maximumCents, currency) }) : undefined}>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input id="bs-amount" inputMode="decimal" className="pl-7" placeholder="0.00" value={form.amount} disabled={readOnly} onChange={(e) => set("amount", e.target.value)} />
              </div>
            </Field>
          )}

          {spec.fields.includes("resend") && (
            <div className="space-y-3">
              <Field label={t("bsResendEvent")} htmlFor="bs-event" error={err("eventId")}>
                <NativeSelect id="bs-event" value={form.eventId} disabled={readOnly} onChange={(e) => set("eventId", e.target.value)}>
                  <option value="">{t("bsChoose")}</option>
                  {events.map((ev) => <option key={ev.id} value={String(ev.id)}>{ev.title}</option>)}
                </NativeSelect>
              </Field>
              <Field label={t("bsResendRecipient")} htmlFor="bs-recipient" error={err("recipientId")}>
                <NativeSelect id="bs-recipient" value={form.recipientId} disabled={readOnly} onChange={(e) => set("recipientId", e.target.value)}>
                  <option value="">{t("bsChoose")}</option>
                  {([["chef", c.parties.chef], ["manager", c.parties.manager]] as const).filter(([, p]) => p?.id).map(([role, p]) =>
                    <option key={role} value={String(p!.id)}>{t(`bsParty_${role}`)} · {p!.name || p!.email}</option>)}
                </NativeSelect>
              </Field>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={form.force} disabled={readOnly} onChange={(e) => set("force", e.target.checked)} />{t("bsResendForce")}</label>
            </div>
          )}

          {spec.fields.includes("flag") && (
            <Field label={t("bsFlagPick")} htmlFor="bs-flag" error={err("flagId")}>
              <NativeSelect id="bs-flag" value={form.flagId} disabled={readOnly} onChange={(e) => set("flagId", e.target.value)}>
                <option value="">{t("bsChoose")}</option>
                {c.flags.map((f) => <option key={f.id} value={String(f.id)}>{t(`bsFlag_${f.kind}`)}{f.providerRef ? ` · ${f.providerRef}` : ""}</option>)}
              </NativeSelect>
            </Field>
          )}

          {messageOffered && (
            <Field label={t("bsSharedMessage")} htmlFor="bs-message" error={err("message")}
              hint={selfArrival ? t("bsSharedMessageSelfHint") : t("bsSharedMessageHint")}>
              <Textarea id="bs-message" value={form.message} disabled={readOnly} maxLength={selfArrival ? 500 : 2000} onChange={(e) => set("message", e.target.value)} />
            </Field>
          )}

          {/* Money preview */}
          <section aria-label={t("bsMoneyPreview")} className="space-y-2 rounded-xl border bg-muted/30 p-3" data-testid="money-preview">
            <h4 className="text-sm font-semibold">{t("bsMoneyPreview")}</h4>
            <dl className="space-y-1">
              {row(t("bsPvChefReceives"), preview.chefReceivesCents, nullText)}
              {(preview.chefPaysCents ?? 0) > 0 && row(t("bsPvChefPays"), preview.chefPaysCents, nullText)}
              {row(t("bsPvManagerPays"), preview.managerPaysCents, nullText)}
              {row(t("bsPvLocalCooksPays"), preview.localCooksPaysCents, nullText)}
              {row(t("bsPvProcessingFee"), preview.processingFeeCents, nullText)}
            </dl>
            {!preview.providerVerified && <p className="text-xs text-muted-foreground">{t("bsPvUnverified")}</p>}
          </section>

          <Field label={t("bsInternalNote")} htmlFor="bs-note" error={err("note")} hint={t("bsInternalNoteHint")}>
            <Textarea id="bs-note" value={form.note} disabled={readOnly} maxLength={2000} onChange={(e) => set("note", e.target.value)} />
          </Field>
          <Field label={t("bsSourceRef")} htmlFor="bs-sourceref" error={err("sourceRef")}>
            <Input id="bs-sourceref" value={form.sourceRef} disabled={readOnly} maxLength={500} placeholder={t("bsSourceRefPlaceholder")} onChange={(e) => set("sourceRef", e.target.value)} />
          </Field>

          {spec.notifies && (
            <p className="flex items-start gap-2 text-sm text-muted-foreground"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{t("bsBothNotified")}</p>
          )}
        </AppDialogBody>
        <AppDialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>{t("bsCancel")}</Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {locked ? t("bsTryAgain") : t("bsSubmit")}
          </Button>
        </AppDialogFooter>
      </form>
    </AppDialogContent>
  );
}
