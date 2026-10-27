/**
 * Selling › Getting started (owner mock, Oct 27): one tracker from applying to an open shop, the same steps Home shows.
 * The current step says what happens next and holds the one thing to do. Shop, payouts and menu live in the shop.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InfoChip } from "@/components/chef/info-chip";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { openChefShopHome, openChefShopPayouts, useShopStatus } from "@/components/chef/seller-revenue/hooks/useSellerRevenue";
import { ChoicePills } from "@/components/application/ChoicePills";
import { KitchenSettingFields, type KitchenSetting } from "@/components/application/KitchenPreferenceForm";
import { DocumentName, UploadDocumentButton } from "@/components/application/SellerDocumentRow";
import { asFieldPhone } from "@/components/application/PersonalInfoForm";
import { sellerDocuments, sellerProgress, type SellerDocument, type SellerStepId } from "@shared/seller-application";
import type { Application, SellerContactMethod, SellerContactTime } from "@shared/schema";
import kitchenImage from "@/assets/commercial-kitchen.jpg";

interface SellerApplicationTabContentProps {
  applications: Application[];
  /** Chefs who don't book kitchens yet see a card for it. */
  showKitchenCard?: boolean;
  onStartApplication: () => void;
  onCancelApplication: (type: "chef", id: number) => void;
  onDiscoverKitchens: () => void;
}

const STEPS: SellerStepId[] = ["apply", "call", "documents", "shop", "paid", "open"];

async function sendJson(method: string, url: string, body: unknown) {
  const token = await auth.currentUser?.getIdToken();
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || response.statusText);
  return data;
}

function docChip(doc: SellerDocument, t: Tr) {
  const map = {
    missing: { tone: "neutral", label: t("sell_docStateMissing") }, requested: { tone: "warning", label: t("sell_docStateRequested") },
    uploaded: { tone: "progress", label: t("sell_docStateUploaded") }, approved: { tone: "success", label: t("sell_docStateApproved") },
    rejected: { tone: "danger", label: t("sell_docStateRejected") },
  } as const;
  return map[doc.state];
}

/** Step and state keys are built at runtime ("sell_title_" + step), so this page translates with plain string keys. */
type Tr = (key: string, options?: Record<string, unknown> | string) => string;

export default function SellerApplicationTabContent({ applications, showKitchenCard, onStartApplication, onCancelApplication, onDiscoverKitchens }: SellerApplicationTabContentProps) {
  const { t: typedT, i18n } = useTranslation("chef");
  const t = typedT as unknown as Tr;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const app = [...applications].sort((a, b) => new Date(b.createdAt as unknown as string).getTime() - new Date(a.createdAt as unknown as string).getTime())[0];
  const { data: shopStatus } = useShopStatus(Boolean(app?.phpShopCreated));
  const progress = app ? sellerProgress(app, { stripeConnected: Boolean(shopStatus?.phpShopStripeAccountId) }) : null;
  const closed = progress && progress.outcome !== "active";
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/firebase/applications/my"] });
  const date = (value: unknown) => new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric" }).format(new Date(value as string));
  const contactLine = app?.contactMethod
    ? [t(`sell_contactBy_${app.contactMethod}`), app.contactTime && app.contactTime !== "any" ? t(`sell_timeShort_${app.contactTime}`) : null].filter(Boolean).join(", ")
    : null;

  const upload = (doc: SellerDocument) => async (url: string) => {
    try {
      await sendJson("PATCH", `/api/firebase/applications/${app!.id}/documents`, { [`${doc.field}Url`]: url });
      await refresh();
      toast({ title: t("sell_docSentTitle"), description: t("sell_docSentBody") });
    } catch (error) {
      toast({ title: t("sell_uploadFailed"), description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const stepBody = (id: SellerStepId, state: "done" | "current" | "upcoming") => {
    if (!app) return id === "apply"
      ? { note: t("sell_apply_noteStart"), action: <Button className="mt-3 rounded-xl" onClick={onStartApplication} data-testid="seller-start-application">{t("sell_startApplication")}</Button> }
      : { note: t(`sell_${id}_noteAhead`) };
    switch (id) {
      case "apply": return { note: t("sell_apply_noteSent", { date: date(app.createdAt) }) };
      case "call": return state === "current"
        ? { note: contactLine ? t("sell_call_noteCurrent", { how: contactLine, phone: asFieldPhone(app.phone) }) : t("sell_call_noteCurrentNoPref"), aside: !closed && app.status === "inReview" ? <button type="button" onClick={() => setEditing(true)} className="text-sm font-semibold underline underline-offset-4">{t("sell_change")}</button> : null }
        : { note: state === "done" ? undefined : t("sell_call_noteAhead") };
      case "documents": {
        const docs = sellerDocuments(app);
        const list = (
          <ul className="mt-3 divide-y rounded-xl shadow-[inset_0_0_0_1px_hsl(var(--border))]">
            {docs.map((doc) => {
              const chip = docChip(doc, t);
              const canUpload = !closed && doc.state !== "approved";
              return (
                <li key={doc.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <DocumentName kind={doc.kind} recommended={doc.recommended} />
                  <span className="flex items-center gap-3">
                    <InfoChip tone={chip.tone}>{chip.label}</InfoChip>
                    {canUpload && <UploadDocumentButton onUploaded={upload(doc)} replace={doc.state === "uploaded"} variant={doc.state === "requested" || doc.state === "rejected" ? "default" : "outline"} />}
                  </span>
                </li>
              );
            })}
          </ul>
        );
        const note = progress!.owed.length ? t("sell_documents_noteOwed", { count: progress!.owed.length })
          : state === "current" ? t("sell_documents_noteChecking")
          : state === "done" ? (docs.some((doc) => doc.url) ? t("sell_documents_noteDone") : t("sell_documents_noteNotNeeded"))
          : t("sell_documents_noteAhead");
        return { note: [note, app.documentsRequestNote && progress!.owed.length ? `“${app.documentsRequestNote}”` : null].filter(Boolean).join(" "), action: state !== "current" && !docs.some((doc) => doc.url) ? null : list };
      }
      case "shop": return { note: state === "current" ? t("sell_shop_noteCurrent") : state === "done" ? t("sell_shop_noteDone") : t("sell_shop_noteAhead") };
      case "paid": return state === "current"
        ? { note: t("sell_paid_noteCurrent"), action: <Button className="mt-3 rounded-xl" onClick={openChefShopPayouts}>{t("sell_paid_cta")}<Icon icon="mdi:open-in-new" className="size-4" aria-hidden /></Button> }
        : { note: state === "done" ? t("sell_paid_noteDone") : t("sell_paid_noteAhead") };
      case "open": return state === "current"
        ? { note: t("sell_open_noteCurrent"), action: <Button className="mt-3 rounded-xl" onClick={() => openChefShopHome()}>{t("sell_open_cta")}<Icon icon="mdi:open-in-new" className="size-4" aria-hidden /></Button> }
        : { note: t("sell_open_noteAhead") };
    }
  };

  const title = !app ? t("sell_titleNone")
    : progress!.outcome === "rejected" ? t("sell_titleRejected")
    : progress!.outcome === "cancelled" ? t("sell_titleCancelled")
    : t(`sell_title_${progress!.current}`);
  const lede = !app ? t("sell_ledeNone")
    : progress!.outcome === "rejected" ? t("sell_ledeRejected")
    : progress!.outcome === "cancelled" ? t("sell_ledeCancelled")
    : t(`sell_lede_${progress!.current}`);

  return (
    <div className="mx-auto grid max-w-[1100px] gap-7 lg:grid-cols-[minmax(0,1fr)_320px]" data-testid="seller-getting-started">
      <section className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] sm:text-[26px]">{title}</h1>
        <p className="mt-1.5 text-muted-foreground text-pretty">{lede}</p>
        {closed ? (
          <Button className="mt-5 rounded-xl" onClick={onStartApplication}>{t("sell_startNew")}</Button>
        ) : (
          <ol className="mt-6 rounded-2xl bg-background px-4 shadow-[inset_0_0_0_1px_hsl(var(--border))] sm:px-6" aria-label={t("sell_trackerLabel")}>
            {STEPS.map((id, index) => {
              const state = progress?.steps[index].state ?? (id === "apply" ? "current" : "upcoming");
              const body = stepBody(id, state);
              return (
                <li key={id} className="grid grid-cols-[28px_1fr_auto] gap-x-3.5 border-b py-4 last:border-b-0 sm:gap-x-4" aria-current={state === "current" ? "step" : undefined} data-step={id} data-state={state}>
                  <span aria-hidden className={cn("mt-px grid size-[26px] place-items-center rounded-full text-[12.5px] font-bold",
                    state === "done" ? "bg-foreground text-background" : state === "current" ? "bg-primary text-primary-foreground" : "text-muted-foreground shadow-[inset_0_0_0_1.5px_hsl(var(--border))]")}>
                    {state === "done" ? <Icon icon="mdi:check" className="size-3.5" /> : index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className={cn("text-[15px]", state === "upcoming" ? "font-medium text-foreground/75" : "font-semibold")}>
                      {t(`sell_step_${id}`)}<span className="sr-only"> · {t(`sell_stepState_${state}`)}</span>
                    </p>
                    {body.note && <p className={cn("mt-0.5 text-sm text-pretty", state === "current" ? "text-foreground/85" : "text-muted-foreground")}>{body.note}</p>}
                    {body.action}
                  </div>
                  <div>{body.aside}</div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <aside className="space-y-4">
        {app && !closed && (
          <div className="rounded-2xl bg-background p-5 shadow-[inset_0_0_0_1px_hsl(var(--border))]">
            <h2 className="text-[15px] font-semibold">{t("sell_yourApplication")}</h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t("sell_rowKitchen")}</dt>
              <dd className="text-right">{app.kitchenPreference === "commercial" && app.commercialKitchen === "localcooks" ? t("sell_kitchenLocalCooks") : t(`sell_kitchenShort_${app.kitchenPreference}`)}</dd>
              {app.foodTypes?.length ? <><dt className="text-muted-foreground">{t("sell_rowSelling")}</dt><dd className="text-right first-letter:uppercase">{app.foodTypes.map((type) => t(`sell_foodShort_${type}`)).join(", ")}</dd></> : null}
              {contactLine && <><dt className="text-muted-foreground">{t("sell_rowContact")}</dt><dd className="text-right">{contactLine}</dd></>}
              <dt className="text-muted-foreground">{t("sell_rowReference")}</dt><dd className="text-right">#{app.id}</dd>
            </dl>
            {app.status === "inReview" && (
              <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
                <button type="button" onClick={() => setEditing(true)} className="text-sm font-semibold underline underline-offset-4">{t("sell_editApplication")}</button>
                <button type="button" onClick={() => onCancelApplication("chef", app.id)} className="text-sm text-muted-foreground hover:text-foreground">{t("cancelApplication", "Cancel application")}</button>
              </div>
            )}
          </div>
        )}
        {showKitchenCard && (
          <div className="overflow-hidden rounded-2xl bg-background shadow-[inset_0_0_0_1px_hsl(var(--border))]">
            <img src={kitchenImage} alt="" className="h-28 w-full object-cover" />
            <div className="p-5">
              <h2 className="text-[15px] font-semibold">{t("sell_kitchenCardTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("sell_kitchenCardBody")}</p>
              <button type="button" onClick={onDiscoverKitchens} className="mt-3 text-sm font-semibold underline underline-offset-4">{t("sell_kitchenCardCta")}</button>
            </div>
          </div>
        )}
      </aside>

      {app && editing && <EditApplicationDialog app={app} onClose={() => setEditing(false)} onSaved={refresh} />}
    </div>
  );
}

function EditApplicationDialog({ app, onClose, onSaved }: { app: Application; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const { t: typedT } = useTranslation("chef");
  const t = typedT as unknown as Tr;
  const { toast } = useToast();
  const [contactMethod, setContactMethod] = useState<SellerContactMethod | undefined>(app.contactMethod ?? undefined);
  const [contactTime, setContactTime] = useState<SellerContactTime | undefined>(app.contactTime ?? undefined);
  const [setting, setSetting] = useState<KitchenSetting>({ kitchenPreference: app.kitchenPreference, commercialKitchen: app.commercialKitchen ?? undefined, foodTypes: app.foodTypes ?? [] });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await sendJson("PATCH", `/api/firebase/applications/${app.id}/details`, { contactMethod, contactTime, ...setting });
      await onSaved();
      onClose();
    } catch (error) {
      toast({ title: t("sell_saveFailed"), description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto rounded-2xl sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle>{t("sell_editApplication")}</DialogTitle>
          <DialogDescription>{t("sell_editLede")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <fieldset className="space-y-2.5">
            <legend className="text-sm font-medium">{t("sell_contactQuestion")}</legend>
            <ChoicePills label={t("sell_contactQuestion")} value={contactMethod} onChange={(value: SellerContactMethod) => setContactMethod(value)}
              options={(["call", "text", "email"] as const).map((value) => ({ value, label: t(`sell_contact${value[0].toUpperCase()}${value.slice(1)}`) }))} />
          </fieldset>
          <fieldset className="space-y-2.5">
            <legend className="text-sm font-medium">{t("sell_bestTime")}</legend>
            <ChoicePills label={t("sell_bestTime")} value={contactTime} onChange={(value: SellerContactTime) => setContactTime(value)}
              options={(["morning", "afternoon", "evening", "any"] as const).map((value) => ({ value, label: t(`sell_time${value[0].toUpperCase()}${value.slice(1)}`) }))} />
          </fieldset>
          <KitchenSettingFields value={setting} onChange={setSetting} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" className="rounded-xl" onClick={onClose} disabled={saving}>{t("sell_cancel")}</Button>
          <Button className="rounded-xl" onClick={() => void save()} disabled={saving}>{t("sell_save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
