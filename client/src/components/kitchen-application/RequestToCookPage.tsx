/**
 * The one-page request to cook (owner, Oct 23), the same for signed-in and signed-out customers: when (optional
 * calendar and price), your details (smart about the email), then the request form's own sections, with the kitchen
 * summary and progress in the rail. Without a confirmed email, Send emails a 6-digit code; a new account is created once
 * the code proves the inbox, and the request goes at once (owner, Oct 26; Baymard: account creation after the task).
 */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useIsChefShell } from "@/layouts/chef-shell-context";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { formatCurrency } from "@/lib/formatters";
import { formatPreferredSchedule } from "@/lib/preferred-schedule";
import KitchenApplicationForm from "./KitchenApplicationForm";
import { PreferredDaysPicker, type PreferredDaysSummary } from "./PreferredDaysPicker";
import { EmailCodeStep, RequestDetails, useConfirmByCode, type DetailsMode, type RequestIdentity } from "./RequestDetails";

type Location = { id: number; name: string; address: string; kitchenTermsUrl?: string | null } & Record<string, any>;

async function authed(path: string, init: RequestInit = {}) {
  const token = await auth.currentUser?.getIdToken();
  return fetch(path, { ...init, credentials: "include", headers: { ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
}

export function RequestToCookPage({ location, kitchen, kitchenId, emailVerified, globalApp, tourReference, sourceTourId, onCancel, onSent }: {
  location: Location;
  kitchen?: { id: number; name: string; imageUrl?: string | null } | null;
  kitchenId: string | null;
  emailVerified: boolean;
  globalApp?: any;
  tourReference?: any;
  sourceTourId?: number;
  onCancel: () => void;
  onSent: () => void;
}) {
  const { t, i18n } = useTranslation("kitchen");
  const inShell = useIsChefShell();
  const queryClient = useQueryClient();
  const { user } = useFirebaseAuth();
  const [details, setDetails] = useState<{ mode: DetailsMode; identity: RequestIdentity | null; ready: boolean }>({ mode: "email", identity: null, ready: false });
  const [schedule, setSchedule] = useState<PreferredDaysSummary | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const pending = useRef<FormData | null>(null);
  const kitchenName = kitchen?.name || location.name;

  const { data: profile } = useQuery<{ phone?: string | null }>({ queryKey: ["/api/chef/my-profile"], enabled: !!user && emailVerified,
    queryFn: async () => { const res = await authed("/api/chef/my-profile"); if (!res.ok) throw new Error("profile"); return res.json(); } });
  // Without a confirmed email the form's data waits here (not on the server) while the code is out; the code then sends it.
  const codeFlow = useConfirmByCode(async () => {
    if (!pending.current) return;
    const res = await authed("/api/firebase/chef/kitchen-applications", { method: "POST", body: pending.current });
    if (!res.ok) { setSendError((await res.json().catch(() => null))?.error || t("rtcSendFailed", { defaultValue: "We couldn’t send your request. Try again." })); return; }
    pending.current = null;
    await queryClient.invalidateQueries({ queryKey: ["/api/firebase/chef/kitchen-applications"] });
    onSent();
  });
  const submit = user && emailVerified ? undefined : async (formData: FormData) => {
    setSendError(null);
    pending.current = formData;
    await codeFlow.start(user ? null : details.identity);
  };

  const scheduleText = schedule?.days.length
    ? formatPreferredSchedule({ days: schedule.days, pricingMode: schedule.pricingMode, times: schedule.times }, i18n.language, t("fullDay", { defaultValue: "Full day" }))
    : null;
  const summary = <Card className="overflow-hidden shadow-none" data-testid="request-summary">
    {kitchen?.imageUrl && <img src={kitchen.imageUrl} alt="" className="h-36 w-full object-cover" />}
    <CardContent className="p-4">
      <p className="font-semibold">{kitchenName}</p>
      <p className="text-xs text-muted-foreground">{location.name !== kitchenName ? `${location.name} · ` : ""}{location.address}</p>
      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t("rtcPreferred", { defaultValue: "Preferred" })}</dt><dd className="text-right">{scheduleText || t("rtcNoDays", { defaultValue: "No days picked" })}</dd></div>
        {schedule?.totalCents != null && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t("rtcEstimate", { defaultValue: "Estimate" })}</dt><dd className="font-semibold tabular-nums">{formatCurrency(schedule.totalCents, "CAD", i18n.language)}</dd></div>}
      </dl>
      <p className="mt-3 border-t pt-3 text-xs leading-5 text-muted-foreground">{t("rtcNext", { defaultValue: "The kitchen reviews your request. You book and pay only after you’re approved." })}</p>
    </CardContent>
  </Card>;

  const summaryCompact = <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm" data-testid="request-summary-compact">
    <div className="min-w-0"><p className="truncate font-medium">{scheduleText || t("rtcNoDays", { defaultValue: "No days picked" })}</p>
      <p className="text-xs text-muted-foreground">{schedule?.totalCents != null ? t("rtcAbout", { defaultValue: "About {amount}", amount: formatCurrency(schedule.totalCents, "CAD", i18n.language) }) : t("rtcFree", { defaultValue: "Sending a request is free" })}</p></div>
    {kitchen?.imageUrl && <img src={kitchen.imageUrl} alt="" className="h-10 w-14 shrink-0 rounded-md object-cover" />}
  </div>;

  const before = kitchenId ? <section aria-labelledby="rtc-when">
    <h2 id="rtc-when" className="text-lg font-semibold">{t("rtcWhen", { defaultValue: "When would you like to cook?" })} <span className="text-sm font-normal text-muted-foreground">{t("rtcOptional", { defaultValue: "(optional)" })}</span></h2>
    <p className="mb-4 mt-1 text-sm text-muted-foreground">{t("rtcWhenHelp", { defaultValue: "Pick days and hours to see the price. Nothing is reserved or charged." })}</p>
    <PreferredDaysPicker kitchenId={kitchenId} onSummary={setSchedule} />
  </section> : null;

  // While the code is out only the code step shows; the form stays mounted so "Change details" loses nothing.
  const content = <>
    {codeFlow.target && <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="max-w-xl"><EmailCodeStep flow={codeFlow} newAccount={!user} /></div>
      {summary}
    </div>}
    {(sendError || codeFlow.error && !codeFlow.target) && <p role="alert" className="mb-4 text-sm text-destructive">{sendError || codeFlow.error}</p>}
    <div className={codeFlow.target ? "hidden" : undefined}>
      <KitchenApplicationForm location={location as any} globalApp={globalApp} tourReference={tourReference} sourceTourId={sourceTourId}
        onSuccess={() => onSent()} onCancel={onCancel}
        onePage={{ details: <RequestDetails profilePhone={profile?.phone} showErrors={tried} onChange={setDetails} />, detailsReady: details.ready, identity: details.identity,
          before, summary, summaryCompact, preferredDaysChosen: !!schedule?.days.length, submit, onAttempt: () => setTried(true) }} />
    </div>
  </>;

  return <div className={inShell ? "min-w-0" : "min-h-screen min-w-0 bg-white"}>
    {!inShell && <Header />}
    <main className={inShell ? "mx-auto max-w-6xl px-4 pb-12 pt-4 sm:px-6" : "mx-auto max-w-6xl px-4 pb-16 pt-[calc(var(--header-total)_+_1.5rem)] sm:px-6 sm:pt-[calc(var(--header-total)_+_2rem)]"}>
      <header className="mb-6 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("rtcTitle", { defaultValue: "Cook at {name}", name: kitchenName })}</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">{t("rtcLead", { defaultValue: "{address}. Send one request and the kitchen will get back to you.", address: location.address })}</p>
        </div>
        <Button variant="ghost" className="shrink-0 gap-2 text-muted-foreground" onClick={onCancel}><X className="h-4 w-4" aria-hidden />{t("cancelBtn", { defaultValue: "Cancel" })}</Button>
      </header>
      {content}
    </main>
  </div>;
}
