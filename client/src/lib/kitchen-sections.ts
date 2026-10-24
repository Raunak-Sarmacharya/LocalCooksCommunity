import { mt } from "@/i18n/manager";
import type { KitchenSection } from "@/lib/manager-kitchens-navigation";
import type { KitchenReadinessReview, ListingRequirementId } from "@shared/kitchen-listing-readiness";
import type { WeeklyTourSource } from "@shared/tour-schedule";

/** Badge beside a section in the kitchen editor's list. */
export type SectionMark = "required" | "done" | "off" | "live" | null;
export interface SectionSummary { line: string; mark: SectionMark }

export const KITCHEN_SECTION_GROUPS: Array<{ labelKey: string; sections: KitchenSection[] }> = [
  { labelKey: "ksGroupListing", sections: ["details", "photos"] },
  { labelKey: "ksGroupBooking", sections: ["availability", "policies", "arrival-departure"] },
  { labelKey: "ksGroupExtras", sections: ["storage", "equipment", "tours"] },
];

/** Requirements that live on the location, not on one kitchen's sections. */
export const LOCATION_REQUIREMENTS = ["license", "stripe", "applicationRequirements"] as const satisfies readonly ListingRequirementId[];

const SECTION_REQUIREMENTS: Partial<Record<KitchenSection, ListingRequirementId[]>> = {
  details: ["description", "rate"],
  photos: ["coverPhoto"],
  availability: ["availability"],
  policies: ["bookingRules"],
  "arrival-departure": ["visitSetup"],
};

export function money(cents: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "CAD", minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}

function clock(time: string, locale: string) {
  const [h, m] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: m ? "2-digit" : undefined }).format(new Date(2000, 0, 2, h, m || 0));
}

/** "Every day, 6 a.m.–11 p.m.", "Mon–Fri, 8 a.m.–6 p.m.", or "Open 4 days a week" when hours differ. */
export function weeklyHoursLine(days: WeeklyTourSource[], locale: string): string | null {
  const open = days.filter(day => day.isAvailable).sort((a, b) => ((a.dayOfWeek + 6) % 7) - ((b.dayOfWeek + 6) % 7));
  if (!open.length) return null;
  const sameHours = open.every(day => day.startTime === open[0].startTime && day.endTime === open[0].endTime);
  const range = `${clock(open[0].startTime, locale)}–${clock(open[0].endTime, locale)}`;
  // Monday-first run with no gaps, e.g. Mon–Fri. Sunday is day 0.
  const order = open.map(day => (day.dayOfWeek + 6) % 7);
  const contiguous = order.every((value, index) => index === 0 || value === order[index - 1] + 1);
  const weekday = (day: number) => new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(2024, 0, 7 + day));
  const daysLabel = open.length === 7 ? mt("ksEveryDay")
    : open.length === 1 ? weekday(open[0].dayOfWeek)
    : contiguous && open.length > 2 ? `${weekday(open[0].dayOfWeek)}–${weekday(open[open.length - 1].dayOfWeek)}`
    : open.length <= 3 ? open.map(day => weekday(day.dayOfWeek)).join(", ") : null;
  if (!sameHours || !daysLabel) return mt("ksDaysOpen", { count: open.length });
  return `${daysLabel}, ${range}`;
}

export function priceLine(hourlyCents: number | null, dailyCents: number | null, locale: string): string | null {
  if (hourlyCents && dailyCents) return mt("ksPriceBoth", { hourly: money(hourlyCents, locale), daily: money(dailyCents, locale) });
  if (hourlyCents) return mt("ksPriceHourly", { hourly: money(hourlyCents, locale) });
  if (dailyCents) return mt("ksPriceDaily", { daily: money(dailyCents, locale) });
  return null;
}

export interface SectionInputs {
  review?: KitchenReadinessReview;
  bookingHours?: WeeklyTourSource[];
  extras?: { storage: { total: number; listed: number }; equipment: { total: number; listed: number } };
  tours?: { enabled: boolean; ready: boolean; scheduled: boolean };
  locale: string;
}

/** What each section's row says, from the same checklist that gates listing. */
export function sectionSummary(section: KitchenSection, input: SectionInputs): SectionSummary {
  const { review, locale } = input;
  const missing = new Set(review?.checklist?.missingRequirementIds ?? []);
  const required = (SECTION_REQUIREMENTS[section] ?? []).some(id => missing.has(id));
  const draft = review?.listingStatus !== "active";
  // Only a kitchen still being set up gets ticks; a listed one stays quiet.
  const done = review && draft && SECTION_REQUIREMENTS[section] && !required ? "done" as const : null;
  const d = review?.details;
  switch (section) {
    case "details": {
      const price = d ? priceLine(d.hourlyRateCents, d.dailyRateCents, locale) : null;
      if (missing.has("rate") && missing.has("description")) return { line: mt("ksAddPriceAndDescription"), mark: "required" };
      if (missing.has("rate")) return { line: mt("ksAddPrice"), mark: "required" };
      if (missing.has("description")) return { line: mt("ksAddDescription"), mark: "required" };
      return { line: price ?? "", mark: done };
    }
    case "photos": {
      if (missing.has("coverPhoto")) return { line: mt("ksAddCover"), mark: "required" };
      const count = d ? (d.coverPhotoUrl ? 1 : 0) + d.galleryImageCount : 0;
      return { line: count < 5 ? mt("ksPhotosAddMore", { count }) : mt("ksPhotos", { count }), mark: done };
    }
    case "availability": {
      if (missing.has("availability")) return { line: mt("ksAddHours"), mark: "required" };
      return { line: weeklyHoursLine(input.bookingHours ?? [], locale) ?? "", mark: done };
    }
    case "policies":
      return { line: d ? mt("ksRulesLine", { cancel: d.cancellationPolicyHours, min: d.minimumBookingHours }) : "", mark: done };
    case "arrival-departure": {
      if (missing.has("visitSetup")) return { line: mt("ksArrivalMissing"), mark: "required" };
      const tasks = (d?.visitSetup?.arrivalRequirementCount ?? 0) + (d?.visitSetup?.departureRequirementCount ?? 0);
      return { line: tasks ? mt("ksArrivalTasks", { count: tasks }) : mt("ksArrivalWritten"), mark: done };
    }
    case "storage":
    case "equipment": {
      const counts = input.extras?.[section];
      if (!counts?.total) return { line: mt(section === "storage" ? "ksStorageHint" : "ksEquipmentHint"), mark: null };
      return { line: counts.listed === counts.total ? mt("ksListedCount", { count: counts.listed })
        : counts.listed === 0 ? mt("ksNotListedYet", { count: counts.total }) : mt("ksListedOfTotal", { listed: counts.listed, total: counts.total }), mark: null };
    }
    case "tours": {
      const tours = input.tours;
      if (tours?.enabled && tours.ready) return { line: mt(draft ? "ksToursOnceListed" : "ksToursLive"), mark: "live" };
      if (tours?.enabled || tours?.scheduled) return { line: mt("ksToursFinish"), mark: "off" };
      return { line: mt("ksToursHint"), mark: "off" };
    }
  }
}

/** Short "what to do" for each listing requirement, for the next-step line on a draft's card. */
export const REQUIREMENT_STEP_KEY: Partial<Record<ListingRequirementId, string>> = {
  description: "ksAddDescription", rate: "ksAddPrice", coverPhoto: "ksAddCover", availability: "ksAddHours",
  visitSetup: "ksArrivalMissing", license: "ksStepLicense", stripe: "ksStepStripe", applicationRequirements: "ksStepRequirements",
};

/** Steps a draft still needs: the kitchen's own sections first, then what's set for the location. */
export function listingProgress(review?: KitchenReadinessReview) {
  const requirements = review?.checklist?.requirements ?? [];
  const missing = review?.checklist?.missingRequirementIds ?? [];
  return {
    total: requirements.length,
    done: requirements.filter(item => item.met).length,
    left: missing.length,
    locationMissing: LOCATION_REQUIREMENTS.filter(id => missing.includes(id)),
  };
}
