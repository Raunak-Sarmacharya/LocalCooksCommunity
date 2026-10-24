import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, ChevronRight } from "@/components/ui/manager-icons";
import { cn } from "@/lib/utils";
import { mt } from "@/i18n/manager";
import { KITCHEN_SECTION_GROUPS, listingProgress, type SectionSummary } from "@/lib/kitchen-sections";
import type { KitchenSection, KitchensNavigationTarget } from "@/lib/manager-kitchens-navigation";
import type { KitchenReadinessReview } from "@shared/kitchen-listing-readiness";

export function sectionLabel(section: KitchenSection) {
  switch (section) {
    case "details": return `${mt("details")} & ${mt("navPricing")}`;
    case "photos": return mt("photos");
    case "availability": return mt("navAvailability");
    case "policies": return mt("navBookingRules");
    case "arrival-departure": return mt("navKitchenArrivalDeparture");
    case "storage": return mt("navStorage");
    case "equipment": return mt("navEquipment");
    case "tours": return mt("kitchenTours");
  }
}

const LOCATION_STEP: Record<string, { key: string; view: KitchensNavigationTarget }> = {
  license: { key: "ksStepLicense", view: "settings-license" },
  stripe: { key: "ksStepStripe", view: "payments" },
  applicationRequirements: { key: "ksStepRequirements", view: "application-requirements" },
};

const LINK = "!min-h-0 font-medium text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Mark({ summary }: { summary: SectionSummary }) {
  if (summary.mark === "required") return <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{mt("ksRequired")}</span>;
  if (summary.mark === "done") return <span className="flex size-5 items-center justify-center rounded-full bg-success/10 text-success" aria-hidden="true"><Check className="size-3.5" /></span>;
  if (summary.mark === "live") return <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">{mt("ksLive")}</span>;
  if (summary.mark === "off") return <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{mt("ksOff")}</span>;
  return null;
}

/**
 * The kitchen editor's sections as a vertical tab list: each row says where that part stands, so the
 * manager doesn't open a tab to find out. On a phone it is the first screen and rows open full-screen.
 */
export function KitchenSectionNav({ summaries, review, locationName, onNavigate, onSelect, className }: {
  summaries: Record<KitchenSection, SectionSummary>;
  review?: KitchenReadinessReview;
  locationName: string;
  onNavigate: (view: KitchensNavigationTarget) => void;
  /** Also fires when the row is already selected, so a phone can open it. */
  onSelect: (section: KitchenSection) => void;
  className?: string;
}) {
  const draft = review && review.listingStatus !== "active" && !review.adminHidden;
  const progress = listingProgress(review);
  return (
    <div className={cn("space-y-5", className)}>
      {draft && (
        <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <p className="font-semibold tracking-tight">{progress.left ? mt("ksStepsLeft", { count: progress.left }) : mt("ksReadyToList")}</p>
          <div className="my-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
          <p className="text-sm text-muted-foreground">{mt(progress.left ? "ksDraftNote" : "ksReadyNote")}</p>
          {progress.locationMissing.length > 0 && (
            <div className="mt-3 space-y-1.5 border-t border-border/70 pt-3 text-sm">
              <p className="text-muted-foreground">{mt("ksLocationSteps", { location: locationName })}</p>
              <ul className="space-y-1">
                {progress.locationMissing.map(id => (
                  <li key={id}><button type="button" className={cn(LINK, "inline-flex items-center gap-1")} onClick={() => onNavigate(LOCATION_STEP[id].view)}>
                    {mt(LOCATION_STEP[id].key)}<ChevronRight className="size-3.5" aria-hidden="true" />
                  </button></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <TabsList aria-label={mt("ksSectionsLabel")} className="flex h-auto w-full flex-col items-stretch gap-5 rounded-none bg-transparent p-0 text-foreground">
        {KITCHEN_SECTION_GROUPS.map(group => (
          <div key={group.labelKey} role="presentation" className="space-y-1">
            <p role="presentation" className="px-3 pb-1 text-xs font-semibold text-muted-foreground">{mt(group.labelKey)}</p>
            <div role="presentation" className="overflow-hidden rounded-2xl border border-border/80 bg-card lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent">
              {group.sections.map(section => {
                const summary = summaries[section];
                return (
                  <TabsTrigger key={section} value={section} onClick={() => onSelect(section)}
                    className="group grid w-full !min-h-0 grid-cols-[1fr_auto] items-center gap-x-3 whitespace-normal rounded-none border-b border-border/70 px-4 py-3 text-left font-normal shadow-none transition-[background-color,box-shadow] last:border-b-0 hover:bg-muted/50 data-[state=active]:bg-transparent data-[state=active]:shadow-none lg:rounded-xl lg:border lg:border-transparent lg:px-3 lg:py-2.5 lg:last:border-b lg:last:border-transparent lg:data-[state=active]:border-border/80 lg:data-[state=active]:bg-card lg:data-[state=active]:shadow-[0_6px_18px_-14px_rgba(15,23,42,0.45)]">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">{sectionLabel(section)}</span>
                      {summary.line && <span className="block truncate text-[13px] text-muted-foreground">{summary.line}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <Mark summary={summary} />
                      <ChevronRight className="size-4 text-muted-foreground/60 lg:hidden" aria-hidden="true" />
                    </span>
                  </TabsTrigger>
                );
              })}
            </div>
          </div>
        ))}
      </TabsList>
      <p className="px-3 text-[13px] leading-5 text-muted-foreground">
        {mt("ksSharedFooter", { location: locationName })}{" "}
        <button type="button" className={LINK} onClick={() => onNavigate("application-requirements")}>{mt("navApplicationRequirements")}</button>,{" "}
        <button type="button" className={LINK} onClick={() => onNavigate("location")}>{mt("ksLocationSettings")}</button>.
      </p>
    </div>
  );
}
