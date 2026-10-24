import { CalendarDays, EyeOff, Image as ImageIcon, Plus } from "@/components/ui/manager-icons";
import { KitchenIcon } from "@/components/ui/kitchen-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { resolveImageUrl } from "@/lib/resolve-image-url";
import { mt } from "@/i18n/manager";
import i18n from "@/i18n";
import { listingProgress, priceLine, REQUIREMENT_STEP_KEY } from "@/lib/kitchen-sections";
import type { KitchenReadinessReview } from "@shared/kitchen-listing-readiness";

export interface KitchenFacts {
  kitchenId: number;
  bookingsThisWeek: number;
  pendingRequests: number;
  /** `YYYY-MM-DDTHH:MM` in the location's clock. */
  nextBooking: string | null;
  storage: { total: number; listed: number };
  equipment: { total: number; listed: number };
}

export const EMPTY_FACTS = (kitchenId: number): KitchenFacts => ({ kitchenId, bookingsThisWeek: 0, pendingRequests: 0, nextBooking: null, storage: { total: 0, listed: 0 }, equipment: { total: 0, listed: 0 } });

export function ListingPill({ listed, hidden, className }: { listed: boolean; hidden?: boolean; className?: string }) {
  const tone = hidden ? "bg-muted text-muted-foreground" : listed ? "bg-success/10 text-success" : "bg-muted text-foreground/75";
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", tone, className)}>
      {hidden ? <EyeOff className="size-3.5" aria-hidden="true" /> : <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {mt(hidden ? "listingStatusHiddenLabel" : listed ? "listingStatusLiveLabel" : "listingStatusDraftLabel")}
    </span>
  );
}

/** "today, 9 a.m.", "tomorrow, 6 p.m." or "Mon, Oct 27, 9 a.m.", read in the location's clock. */
export function nextBookingLabel(value: string, timezone = "America/St_Johns", now = new Date(), locale = i18n.language || "en-CA") {
  const [date, time] = value.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time ?? "00:00").split(":").map(Number);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const clock = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: mm ? "2-digit" : undefined, timeZone: "UTC" }).format(Date.UTC(2000, 0, 1, hh, mm));
  const day = days === 0 || days === 1
    ? new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day")
    : new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d, 12));
  return `${day}, ${clock}`;
}

export function KitchenFactsLine({ facts, timezone, onOpenRequests, stacked, className }: { facts: KitchenFacts; timezone?: string; onOpenRequests?: () => void; stacked?: boolean; className?: string }) {
  // Stacked (cards): one fact per line, so a narrow card never ends a line on a separator.
  const dot = stacked ? <span className="basis-full" aria-hidden="true" /> : <span aria-hidden="true">·</span>;
  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground", className)}>
      <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
      <span className={facts.nextBooking ? "text-foreground" : undefined}>
        {facts.nextBooking ? mt("ksNextBooking", { when: nextBookingLabel(facts.nextBooking, timezone) }) : mt("ksNoUpcoming")}
      </span>
      {facts.bookingsThisWeek > 0 && <>{dot}<span className={stacked ? "pl-6" : undefined}>{mt("ksThisWeek", { count: facts.bookingsThisWeek })}</span></>}
      {facts.pendingRequests > 0 && <>{dot}
        {onOpenRequests
          ? <button type="button" onClick={(event) => { event.stopPropagation(); onOpenRequests(); }} className="!min-h-0 font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{mt("ksRequests", { count: facts.pendingRequests })}</button>
          : <span className={cn("font-medium text-primary", stacked && "pl-6")}>{mt("ksRequests", { count: facts.pendingRequests })}</span>}
      </>}
    </p>
  );
}

interface CardKitchen { id: number; name: string; imageUrl?: string | null; listingStatus?: "draft" | "active"; isActive?: boolean }

/** My Kitchens when a location has several: one card per kitchen, opening its editor. */
export function KitchenCards({ kitchens, locationName, reviews, facts, timezone, onOpen, onAdd }: {
  kitchens: CardKitchen[];
  locationName: string;
  reviews: Record<number, KitchenReadinessReview | undefined>;
  facts: Record<number, KitchenFacts | undefined>;
  timezone?: string;
  onOpen: (kitchenId: number) => void;
  onAdd: () => void;
}) {
  const locale = i18n.language || "en-CA";
  return (
    <section className="space-y-5" aria-label={mt("navSpaces")}>
      <p className="text-sm text-muted-foreground">{locationName} · {mt("ksKitchenCount", { count: kitchens.length })}</p>
      <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {kitchens.map(kitchen => {
          const review = reviews[kitchen.id];
          const fact = facts[kitchen.id];
          const listed = (review?.listingStatus ?? kitchen.listingStatus) === "active";
          const hidden = review?.adminHidden === true;
          const progress = listingProgress(review);
          const photos = review ? (review.details.coverPhotoUrl ? 1 : 0) + review.details.galleryImageCount : 0;
          const price = review ? priceLine(review.details.hourlyRateCents, review.details.dailyRateCents, locale) : null;
          const days = review?.details?.availabilityDayCount ?? 0;
          const extras = [
            fact?.storage.listed ? `${mt("navStorage")} · ${fact.storage.listed}` : null,
            fact?.equipment.listed ? `${mt("navEquipment")} · ${fact.equipment.listed}` : null,
            review?.details?.toursEnabled ? mt("ksToursOn") : null,
          ].filter(Boolean) as string[];
          return (
            <li key={kitchen.id}>
              <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-22px_rgba(15,23,42,0.35)] focus-within:ring-2 focus-within:ring-ring">
                <div className="relative aspect-[16/10] overflow-hidden bg-muted">
                  {kitchen.imageUrl
                    ? <img src={resolveImageUrl(kitchen.imageUrl) ?? ""} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]" />
                    : <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground"><KitchenIcon className="size-7" /><span className="text-sm">{mt("ksNoPhotoYet")}</span></div>}
                  <ListingPill listed={listed} hidden={hidden} className="absolute left-3 top-3 bg-card/95 shadow-sm backdrop-blur-sm" />
                  {photos > 0 && <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm"><ImageIcon className="size-3.5" aria-hidden="true" />{photos}</span>}
                </div>
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold tracking-tight">
                      {/* The whole card opens the kitchen; the link's box covers it. */}
                      <button type="button" onClick={() => onOpen(kitchen.id)} aria-label={mt("ksOpenKitchen", { name: kitchen.name })}
                        className="!min-h-0 text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">{kitchen.name}</button>
                    </h3>
                    {review ? <p className="truncate text-sm text-muted-foreground">
                      {[price ?? mt("ksNoPriceYet"), days ? (days === 7 ? mt("ksEveryDay") : mt("ksDaysOpen", { count: days })) : null].filter(Boolean).join(" · ")}
                    </p> : <Skeleton className="mt-1 h-4 w-40" />}
                  </div>
                  {fact && listed && <KitchenFactsLine facts={fact} timezone={timezone} stacked className="gap-y-0.5" />}
                  {(!listed && !hidden && review) || extras.length ? <div className="mt-auto border-t border-border/70 pt-3">
                    {!listed && !hidden && review ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className={progress.left ? "font-medium text-warning" : "font-medium text-success"}>{progress.left ? mt("ksStepsLeft", { count: progress.left }) : mt("ksReadyToList")}</span>
                          <span className="tabular-nums text-muted-foreground">{progress.done}/{progress.total}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
                        {(() => { const key = REQUIREMENT_STEP_KEY[review.checklist?.missingRequirementIds?.[0] as keyof typeof REQUIREMENT_STEP_KEY]; return key ? <p className="text-xs text-muted-foreground">{mt("ksNextStep", { step: mt(key) })}</p> : null; })()}
                      </div>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">{extras.map(extra => <li key={extra} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground/80">{extra}</li>)}</ul>
                    )}
                  </div> : null}
                </div>
              </article>
            </li>
          );
        })}
        <li>
          <button type="button" onClick={onAdd}
            className="flex h-full min-h-[18rem] w-full flex-col items-center justify-center gap-3 rounded-2xl border-[1.5px] border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/[0.03] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex size-11 items-center justify-center rounded-full bg-muted"><Plus className="size-5" /></span>
            <span className="font-medium">{mt("addKitchen")}</span>
          </button>
        </li>
      </ul>
    </section>
  );
}
