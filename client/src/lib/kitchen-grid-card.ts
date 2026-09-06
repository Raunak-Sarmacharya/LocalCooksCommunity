import { getEquipmentTemplateById } from "@/lib/equipment-templates";

export type KitchenGridStorageSummary = {
  hasDryStorage: boolean;
  hasColdStorage: boolean;
  hasFreezerStorage: boolean;
  totalStorageUnits: number;
};

export type KitchenGridEquipmentSummary = {
  included: number;
  rental: number;
};

/** Turn template ids / slugs into display names (e.g. commercial-oven → Commercial Oven). */
export function resolveEquipmentLabel(raw: string): string {
  const value = raw.trim();
  if (!value) return value;
  const fromTemplate = getEquipmentTemplateById(value)?.name;
  if (fromTemplate) return fromTemplate;
  // Already human ("Commercial Oven") or unknown slug
  if (/[A-Z\s/]/.test(value) && !value.includes("-") && !value.includes("_")) {
    return value;
  }
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Merge storage flags/counts across kitchens at one location. */
export function mergeStorageSummaries(
  summaries: Array<KitchenGridStorageSummary | null | undefined>
): KitchenGridStorageSummary {
  return {
    hasDryStorage: summaries.some((s) => s?.hasDryStorage),
    hasColdStorage: summaries.some((s) => s?.hasColdStorage),
    hasFreezerStorage: summaries.some((s) => s?.hasFreezerStorage),
    totalStorageUnits: summaries.reduce((n, s) => n + (s?.totalStorageUnits ?? 0), 0),
  };
}

/** Deduped equipment labels across kitchens (template ids resolved). */
export function mergeEquipmentLists(lists: Array<string[] | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list || []) {
      const label = resolveEquipmentLabel(raw);
      const key = label.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(label);
    }
  }
  return out;
}

/** Sum included/rental counts across kitchens at one location. */
export function mergeEquipmentSummaries(
  summaries: Array<KitchenGridEquipmentSummary | null | undefined>
): KitchenGridEquipmentSummary {
  return {
    included: summaries.reduce((n, s) => n + (s?.included ?? 0), 0),
    rental: summaries.reduce((n, s) => n + (s?.rental ?? 0), 0),
  };
}

/** Card line: "3 included + 2 rental". Omits a side when its count is 0. */
export function formatEquipmentBreakdown(
  summary: KitchenGridEquipmentSummary | null | undefined,
  labels: { included: string; rental: string; none: string }
): string {
  const included = summary?.included ?? 0;
  const rental = summary?.rental ?? 0;
  if (included <= 0 && rental <= 0) return labels.none;
  const parts: string[] = [];
  if (included > 0) parts.push(`${included} ${labels.included}`);
  if (rental > 0) parts.push(`${rental} ${labels.rental}`);
  return parts.join(" + ");
}

/** Storage line for cards — unit count only. */
export function formatStorageLine(
  summary: KitchenGridStorageSummary | null | undefined,
  noneLabel: string,
  spacesLabel?: string
): string {
  if (!summary || summary.totalStorageUnits <= 0) return noneLabel;
  if (spacesLabel) return `${summary.totalStorageUnits} ${spacesLabel}`;
  return String(summary.totalStorageUnits);
}

/** First equipment item(s) + leftover count, e.g. "Commercial Oven, Range/Stove +5". */
export function formatEquipmentLine(
  equipment: string[] | undefined,
  noneLabel: string
): string {
  const list = mergeEquipmentLists([equipment]);
  if (list.length === 0) return noneLabel;
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]}, ${list[1]}`;
  return `${list[0]}, ${list[1]} +${list.length - 2}`;
}
