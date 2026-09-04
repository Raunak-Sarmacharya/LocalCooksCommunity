import { getEquipmentTemplateById } from "@/lib/equipment-templates";

export type KitchenGridStorageSummary = {
  hasDryStorage: boolean;
  hasColdStorage: boolean;
  hasFreezerStorage: boolean;
  totalStorageUnits: number;
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

/**
 * Storage line for cards.
 * Types first (Dry / Cold / Freezer); leftover types as +N.
 * Single type with multiple units → "Dry +2".
 */
export function formatStorageLine(
  summary: KitchenGridStorageSummary | null | undefined,
  labels: { dry: string; cold: string; freezer: string; none: string }
): string {
  if (!summary || summary.totalStorageUnits <= 0) return labels.none;
  const types: string[] = [];
  if (summary.hasDryStorage) types.push(labels.dry);
  if (summary.hasColdStorage) types.push(labels.cold);
  if (summary.hasFreezerStorage) types.push(labels.freezer);

  if (types.length === 0) {
    // Units exist but type flags missing — show count, not a blank em dash
    return `${summary.totalStorageUnits}`;
  }
  if (types.length === 1) {
    if (summary.totalStorageUnits > 1) {
      return `${types[0]} +${summary.totalStorageUnits - 1}`;
    }
    return types[0];
  }
  return `${types[0]} +${types.length - 1}`;
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
