/**
 * Resources (owner mock, Oct 27; replaces Training): what you need to cook and sell in NL by where you cook, the food
 * safety videos, official links and the guide's chapters. Shown to every chef from the foot of the sidebar.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { SKILLSPASS_OFFICIAL_CERT_URL } from "@/config/skillspass";
import TrainingVideoPlayer from "@/components/training/TrainingVideoPlayer";

type Setting = "commercial" | "home";
type Tr = (key: string, options?: Record<string, unknown>) => string;

const BASICS = 14;
const HYGIENE = 8;
const TOTAL = BASICS + HYGIENE;
const LINKS = {
  approvedCourses: "https://www.gov.nl.ca/hcs/publichealth/envhealth/foodsafetytraining/",
  premises: "https://www.gov.nl.ca/dgsnl/licences/env-health/food/premises/",
  homeGuidelines: "https://www.gov.nl.ca/gs/files/HCS_home_based_food_industry.pdf",
  skillsPass: SKILLSPASS_OFFICIAL_CERT_URL,
  gst: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/account-register.html",
};
const GUIDES = [
  { key: "licences", anchor: "register-your-business" },
  { key: "homeVsCommercial", anchor: "home-vs-commercial" },
  { key: "insurance", anchor: "liability-insurance" },
  { key: "sharedKitchen", anchor: "shared-kitchen-operations" },
  { key: "taxes", anchor: "business-tax-essentials" },
  { key: "checklist", anchor: "launch-checklist" },
] as const;
const ROWS = ["training", "licence", "make", "insurance"] as const;

async function authed(path: string) {
  const token = await auth.currentUser?.getIdToken();
  return fetch(path, { headers: { Authorization: `Bearer ${token}` } });
}

export default function ChefResourcesPanel({ viewMode = "overview", onViewModeChange, kitchenSetting, onFindKitchens }: {
  viewMode?: "overview" | "player";
  onViewModeChange: (mode: "overview" | "player") => void;
  kitchenSetting: Setting | null;
  onFindKitchens: () => void;
}) {
  const { t: typedT } = useTranslation("chef");
  const t = typedT as unknown as Tr;
  const { user } = useFirebaseAuth();
  const { toast } = useToast();
  const [lane, setLane] = useState<Setting>(kitchenSetting ?? "commercial");
  const [downloading, setDownloading] = useState(false);

  const { data: progress, isLoading } = useQuery({
    queryKey: ["training-access", user?.uid],
    enabled: Boolean(user),
    queryFn: async () => {
      const response = await authed(`/api/firebase/microlearning/progress/${user!.uid}`);
      return response.ok ? response.json() : { progress: [] };
    },
  });
  const { data: completion } = useQuery({
    queryKey: ["microlearning-completion", user?.uid],
    enabled: Boolean(user),
    queryFn: async () => {
      const response = await authed(`/api/firebase/microlearning/completion/${user!.uid}`);
      return response.ok ? response.json() : null;
    },
  });

  if (viewMode === "player") return <TrainingVideoPlayer />;

  const watched = (progress?.progress ?? []) as { videoId?: string; completed?: boolean }[];
  const done = (prefix: string) => watched.filter((item) => item.completed && item.videoId?.startsWith(prefix)).length;
  const total = done("basics-") + done("howto-");
  const completed = Boolean(completion?.completion?.confirmed || completion?.confirmed);

  const downloadCertificate = async () => {
    setDownloading(true);
    try {
      const response = await authed(`/api/firebase/microlearning/certificate/${user!.uid}`);
      if (!response.ok) throw new Error(String(response.status));
      const url = URL.createObjectURL(await response.blob());
      const link = Object.assign(document.createElement("a"), { href: url, download: "local-cooks-certificate-of-completion.pdf" });
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      logger.error("Certificate download failed", error);
      toast({ title: t("res_certFailed"), variant: "destructive" });
    } finally { setDownloading(false); }
  };

  const cell = (setting: Setting, row: (typeof ROWS)[number]) => {
    const link = setting === "commercial"
      ? { training: { href: LINKS.approvedCourses, label: t("res_linkApprovedCourses") }, licence: { onClick: onFindKitchens, label: t("res_linkFindKitchen") } }[row as "training" | "licence"]
      : { training: { href: LINKS.skillsPass, label: t("res_linkSkillsPass") }, licence: { href: LINKS.premises, label: t("res_linkHowToRegister") }, make: { href: LINKS.premises, label: t("res_linkLicenceHome") } }[row as "training" | "licence" | "make"];
    return (
      <>
        <p className="font-semibold">{t(`res_${setting}_${row}`)}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{t(`res_${setting}_${row}Note`)}</p>
        {link && ("href" in link
          ? <a href={link.href} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-block text-[13px] font-semibold underline underline-offset-[3px]">{link.label}</a>
          : <button type="button" onClick={link.onClick} className="mt-1.5 text-[13px] font-semibold underline underline-offset-[3px]">{link.label}</button>)}
      </>
    );
  };

  return (
    <div className="mx-auto max-w-[1100px] space-y-4" data-testid="chef-resources">
      <div className="pb-2">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">{t("res_title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("res_lede")}</p>
      </div>

      <section className="rounded-xl border bg-card p-4 sm:p-5" aria-labelledby="res-need">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div>
            <h2 id="res-need" className="text-base font-semibold">{t("res_needTitle")}</h2>
            <p className="text-[13px] text-muted-foreground">{t("res_needSource")}</p>
          </div>
          <a href="/resources" target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold underline underline-offset-[3px]">{t("res_fullGuide")}</a>
        </div>

        {/* Phone: one kitchen at a time, opening on the chef's own. */}
        <div role="tablist" aria-label={t("res_needTitle")} className="mt-3 flex rounded-full bg-muted p-1 md:hidden">
          {(["commercial", "home"] as const).map((setting) => (
            <button key={setting} role="tab" aria-selected={lane === setting} type="button" onClick={() => setLane(setting)}
              className={cn("flex-1 rounded-full py-2 text-[13px] font-medium", lane === setting ? "bg-background shadow-sm" : "text-muted-foreground")}>
              {t(`res_tab_${setting}`)}{kitchenSetting === setting ? ` · ${t("res_yours")}` : ""}
            </button>
          ))}
        </div>
        <dl className="mt-2 divide-y md:hidden">
          {ROWS.map((row) => <div key={row} className="py-3"><dt className="text-xs text-muted-foreground">{t(`res_row_${row}`)}</dt><dd className="mt-0.5">{cell(lane, row)}</dd></div>)}
        </dl>

        {/* Desktop: both kitchens side by side, the chef's own tinted. */}
        <table className="mt-3 hidden w-full border-separate border-spacing-0 text-sm md:table">
          <thead>
            <tr>
              <th className="w-[190px]" />
              {(["commercial", "home"] as const).map((setting) => (
                <th key={setting} scope="col" className={cn("px-4 pb-2.5 pt-2.5 text-left font-semibold", kitchenSetting === setting && "rounded-t-xl bg-primary/[0.06]")}>
                  {t(`res_lane_${setting}`)}
                  {kitchenSetting === setting && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11.5px] font-semibold text-primary">{t("res_yourSetting")}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, index) => (
              <tr key={row}>
                <th scope="row" className="border-t py-3 pr-4 text-left align-top text-[13px] font-normal text-muted-foreground">{t(`res_row_${row}`)}</th>
                {(["commercial", "home"] as const).map((setting) => (
                  <td key={setting} className={cn("border-t px-4 py-3 align-top", kitchenSetting === setting && "bg-primary/[0.06]", kitchenSetting === setting && index === ROWS.length - 1 && "rounded-b-xl")}>{cell(setting, row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-12">
        <section className="rounded-xl border bg-card p-4 sm:p-5 lg:col-span-7" aria-labelledby="res-videos">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 id="res-videos" className="text-base font-semibold">{t("res_videosTitle")}</h2>
            <p className="text-[13px] text-muted-foreground">{t("res_videosSource")}</p>
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">{t("res_videosLede")}</p>
          {isLoading ? <Skeleton className="mt-4 h-24" /> : (
            <>
              <p className="mt-4 flex items-baseline gap-2 tabular-nums"><span className="text-[26px] font-semibold leading-none">{total}</span><span className="text-muted-foreground">{t("res_videosOf", { total: TOTAL })}</span></p>
              <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-primary/10" role="progressbar" aria-valuemin={0} aria-valuemax={TOTAL} aria-valuenow={total} aria-label={t("res_videosTitle")}>
                <div className="h-full rounded-full bg-primary" style={{ width: `${(total / TOTAL) * 100}%` }} />
              </div>
              <ul className="mt-3 divide-y">
                {[{ key: "basics", n: done("basics-"), of: BASICS }, { key: "hygiene", n: done("howto-"), of: HYGIENE }].map((module) => (
                  <li key={module.key} className="grid grid-cols-[1fr_auto] gap-x-3 py-2.5">
                    <span className="font-medium">{t(`res_module_${module.key}`)}</span>
                    <span className="text-[13px] tabular-nums text-muted-foreground">{t("res_moduleCount", { n: module.n, of: module.of })}</span>
                    <span className="col-span-2 text-[13px] text-muted-foreground">{t(`res_module_${module.key}Note`)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button className="rounded-full" onClick={() => onViewModeChange("player")}>
                  <Icon icon="mdi:play" className="size-4" aria-hidden />
                  {t(completed ? "res_watchAgain" : total ? "res_continue" : "res_start")}
                </Button>
                {completed && (
                  <Button variant="outline" className="rounded-full" onClick={() => void downloadCertificate()} disabled={downloading}>
                    <Icon icon="mdi:tray-arrow-down" className="size-4" aria-hidden />
                    {t("res_certDownload")}
                  </Button>
                )}
              </div>
              <p className="mt-3 text-[12.5px] text-muted-foreground">{t(completed ? "res_certNote" : "res_videosNote")}</p>
            </>
          )}
        </section>

        <section className="rounded-xl border bg-card p-4 sm:p-5 lg:col-span-5" aria-labelledby="res-links">
          <h2 id="res-links" className="text-base font-semibold">{t("res_linksTitle")}</h2>
          <ul className="mt-1 divide-y">
            {(Object.keys(LINKS) as (keyof typeof LINKS)[]).map((key) => (
              <li key={key}>
                <a href={LINKS[key]} target="_blank" rel="noopener noreferrer" className="group grid grid-cols-[1fr_auto] gap-x-3 py-2.5">
                  <span className="text-[15px] font-medium group-hover:underline group-hover:underline-offset-[3px]">{t(`res_link_${key}`)}</span>
                  <Icon icon="mdi:arrow-top-right" className="size-4 self-center text-muted-foreground" aria-hidden />
                  <span className="text-[13px] text-muted-foreground">{t(`res_link_${key}Note`)}</span>
                  <span className="sr-only">{t("res_opensNewTab")}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-xl border bg-card p-4 sm:p-5" aria-labelledby="res-guides">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="res-guides" className="text-base font-semibold">{t("res_guidesTitle")}</h2>
          <a href="/resources" target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold underline underline-offset-[3px]">{t("res_fullGuide")}</a>
        </div>
        <ul className="mt-1 grid sm:grid-cols-2 sm:gap-x-8">
          {GUIDES.map((guide) => (
            <li key={guide.key} className="border-t first:border-t-0 sm:[&:nth-child(2)]:border-t-0">
              <a href={`/resources#${guide.anchor}`} target="_blank" rel="noopener noreferrer" className="group block py-3">
                <span className="text-[15px] font-medium group-hover:underline group-hover:underline-offset-[3px]">{t(`res_guide_${guide.key}`)}</span>
                <span className="block text-[13px] text-muted-foreground">{t(`res_guide_${guide.key}Note`)}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
