/**
 * Iconify (MDI) icons for kitchen equipment + storage.
 * Icons are registered offline so they render without the Iconify CDN/API.
 */

import { addCollection } from "@iconify/react";
import { icons as mdiIcons } from "@iconify-json/mdi";

addCollection(mdiIcons);

const EQUIPMENT_RULES: Array<{ match: RegExp; icon: string }> = [
  { match: /pizza/, icon: "mdi:pizza" },
  { match: /tandoor/, icon: "mdi:stove" },
  { match: /toaster.?oven|combi|convection|oven|salamander|broiler|bread.?proof/, icon: "mdi:toaster-oven" },
  { match: /microwave/, icon: "mdi:microwave" },
  { match: /range|stove|wok/, icon: "mdi:stove" },
  { match: /fryer|deep.?fry/, icon: "mdi:pot-steam" },
  { match: /grill|griddle|flattop|rotisserie/, icon: "mdi:grill" },
  { match: /steam|kettle|pasta.?cook|dim.?sum/, icon: "mdi:pot-steam" },
  { match: /smoker|smoking|curing/, icon: "mdi:smoke" },
  { match: /mixer|planetary/, icon: "mdi:blender" },
  { match: /food.?processor|spiral/, icon: "mdi:blender" },
  { match: /immersion|blender/, icon: "mdi:blender" },
  { match: /slicer|grinder|spiralizer/, icon: "mdi:knife" },
  { match: /juicer/, icon: "mdi:cup" },
  { match: /work.?table|cutting.?board|prep/, icon: "mdi:table-furniture" },
  { match: /sink/, icon: "mdi:countertop" },
  { match: /vacuum/, icon: "mdi:vacuum" },
  { match: /walk.?in.?freezer|reach.?in.?freezer|freezer/, icon: "mdi:snowflake" },
  { match: /walk.?in|cooler|fridge|refrigerat|blast.?chill/, icon: "mdi:fridge-outline" },
  { match: /ice.?machine|ice.?cream|soft.?serve/, icon: "mdi:ice-cream" },
  { match: /pasta.?maker|extruder|dough.?sheet/, icon: "mdi:pasta" },
  { match: /chocolate|temper/, icon: "mdi:candy" },
  { match: /sous.?vide/, icon: "mdi:thermometer-water" },
  { match: /dehydrator/, icon: "mdi:air-filter" },
  { match: /espresso|coffee/, icon: "mdi:coffee-maker" },
  { match: /dish.?wash|glass.?wash/, icon: "mdi:dishwasher" },
  { match: /sanit|spray|clean/, icon: "mdi:spray-bottle" },
];

const STORAGE_ICONS: Record<string, string> = {
  freezer: "mdi:snowflake",
  cold: "mdi:fridge-outline",
  dry: "mdi:cupboard-outline",
};

const DEFAULT_EQUIPMENT_ICON = "mdi:pot-steam-outline";
const DEFAULT_STORAGE_ICON = "mdi:archive-outline";

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").trim();
}

export function resolveEquipmentIcon(equipmentType: string, category?: string | null): string {
  const haystack = normalize([equipmentType, category].filter(Boolean).join(" "));
  for (const rule of EQUIPMENT_RULES) {
    if (rule.match.test(haystack)) return rule.icon;
  }
  return DEFAULT_EQUIPMENT_ICON;
}

/** Prefer typed key; fall back to name keywords when type is missing/custom. */
export function resolveStorageIcon(storageType: string, name?: string | null): string {
  const key = normalize(storageType).replace(/\s+/g, "");
  if (STORAGE_ICONS[key]) return STORAGE_ICONS[key];
  const haystack = normalize([storageType, name].filter(Boolean).join(" "));
  if (/freezer|frozen/.test(haystack)) return STORAGE_ICONS.freezer;
  if (/cold|cool|fridge|refrigerat|chill/.test(haystack)) return STORAGE_ICONS.cold;
  if (/dry|shelf|shelving|pantry|cabinet/.test(haystack)) return STORAGE_ICONS.dry;
  return DEFAULT_STORAGE_ICON;
}

// ponytail: keyword map only — ceiling is custom/unknown types → generic icon; upgrade path: per-listing icon field
if (import.meta.env?.DEV) {
  console.assert(
    resolveEquipmentIcon("Deep Fryer") === "mdi:pot-steam",
    "equipment icon map: fryer"
  );
  console.assert(resolveStorageIcon("freezer") === "mdi:snowflake", "storage icon map: freezer");
  console.assert(
    resolveStorageIcon("custom", "Walk-in Freezer") === "mdi:snowflake",
    "storage icon map: name fallback"
  );
}
