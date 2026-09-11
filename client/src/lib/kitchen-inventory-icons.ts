/**
 * Iconify icons for kitchen equipment + storage.
 * Icons are registered offline so they render without the Iconify CDN/API.
 */

import { addCollection, addIcon } from "@iconify/react";
import { icons as mdiIcons } from "@iconify-json/mdi";

addCollection(mdiIcons);

addIcon("fluent:person-link-28-regular", {
  body: '<path fill="currentColor" d="M20 16a3 3 0 0 1 2.959 2.5h-1.544c-.19-.54-.68-.937-1.27-.993L20 17.5H6a1.5 1.5 0 0 0-1.493 1.355L4.5 19v.715c0 2.674 3.389 4.785 8.5 4.785h.166c.146.537.384 1.036.696 1.48Q13.438 26 13 26c-5.79 0-10-2.567-10-6.285V19a3 3 0 0 1 3-3zM13 2a6 6 0 1 1 0 12a6 6 0 0 1 0-12m0 1.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 0 0 0-9M17.75 21a2.25 2.25 0 0 0 0 4.5h.5a.75.75 0 0 1 0 1.5h-.5a3.75 3.75 0 1 1 0-7.5h.5a.75.75 0 0 1 0 1.5zM17 23.25a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1-.75-.75m6.25 2.25a2.25 2.25 0 0 0 0-4.5h-.5a.75.75 0 0 1 0-1.5h.5a3.75 3.75 0 1 1 0 7.5h-.5a.75.75 0 0 1 0-1.5z" />',
  width: 28,
  height: 28,
});

/** Booking “Select equipment” — Solar oven mitts (offline; not in @iconify-json/mdi). */
addIcon("solar:oven-mitts-minimalistic-outline", {
  body: '<path fill="currentColor" fill-rule="evenodd" d="M9.48097 4.56453C9.04458 3.40843 8.13142 2.73659 7.22433 2.75023C6.00496 2.76856 4.78618 4.06644 4.81639 5.98744L4.81654 5.99695L4.78429 9.34779C4.78392 9.38646 4.78359 9.42466 4.78326 9.46241C4.77769 10.1056 4.77324 10.6189 4.58657 11.0882C4.47936 11.3577 4.31892 11.5901 4.13332 11.8188C3.95406 12.0396 3.71912 12.2951 3.43686 12.6019L3.42117 12.619C2.85715 13.2322 2.75 13.5144 2.75 13.7454C2.75 13.9191 2.8108 14.1274 3.09598 14.4929C3.39409 14.8749 3.85492 15.3277 4.54313 16.0006L8.1119 19.4899C8.79988 20.1626 9.2633 20.6134 9.65466 20.9054C10.0281 21.1839 10.2493 21.25 10.4426 21.25C10.6359 21.25 10.8571 21.1839 11.2305 20.9054C11.6219 20.6134 12.0853 20.1626 12.7733 19.4899L19.554 12.8602C21.8153 10.6492 21.8153 7.07159 19.554 4.86057C17.2832 2.64033 13.5946 2.64033 11.3238 4.86057L9.89629 6.25629C9.60012 6.54587 9.12528 6.54052 8.8357 6.24435C8.54612 5.94818 8.55147 5.47334 8.84764 5.18376L9.48097 4.56453ZM10.6255 3.46692C9.93458 2.16287 8.69904 1.22789 7.20178 1.2504C4.88003 1.2853 3.28246 3.56209 3.31643 6.00118L3.28436 9.33336C3.27652 10.1482 3.26263 10.3582 3.19279 10.5337C3.16627 10.6004 3.11205 10.6968 2.96862 10.8735C2.82216 11.054 2.6191 11.2753 2.31716 11.6035C1.72229 12.2503 1.25 12.9035 1.25 13.7454C1.25 14.3894 1.52567 14.9188 1.91343 15.4157C2.28112 15.8869 2.81601 16.4098 3.45707 17.0366L7.10017 20.5985C7.74162 21.2257 8.27633 21.7486 8.75776 22.1077C9.26635 22.4871 9.79971 22.75 10.4426 22.75C11.0855 22.75 11.6188 22.4871 12.1274 22.1077C12.6089 21.7486 13.1436 21.2257 13.785 20.5985L20.6026 13.9328C23.4658 11.1333 23.4658 6.58745 20.6026 3.78804C17.8629 1.10934 13.4953 1.0023 10.6255 3.46692ZM5.98068 12.8722C6.27026 12.576 6.7451 12.5706 7.04127 12.8602L11.3238 17.0474C11.62 17.337 11.6253 17.8118 11.3357 18.108C11.0462 18.4042 10.5713 18.4095 10.2752 18.1199L5.99262 13.9328C5.69645 13.6432 5.6911 13.1683 5.98068 12.8722Z" clip-rule="evenodd"/>',
  width: 24,
  height: 24,
});

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
