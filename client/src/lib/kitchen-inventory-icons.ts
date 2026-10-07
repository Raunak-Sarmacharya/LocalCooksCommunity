import { EQUIPMENT_ICON_NAME, STORAGE_ICON_NAME } from "@/components/ui/inventory-icons";
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

/** Match listing types before falling back to a category glyph. */
export function resolveEquipmentIcon(equipmentType: string, category?: string | null): string {
  const type = (equipmentType || "").toLowerCase().replace(/[_-]/g, " ");
  const rules: [RegExp, string][] = [
    [/oven|rotisserie|salamander|broiler/, "mdi:stove"],
    [/range|stove|burner|wok/, "mdi:gas-burner"],
    [/grill|griddle|flattop/, "mdi:grill"],
    [/fryer/, "mdi:pot"],
    [/steamer|kettle|pasta cooker/, "mdi:pot-steam"],
    [/smoker/, "mdi:smoke"],
    [/mixer/, "mdi:blender"],
    [/blender|processor|juicer/, "mdi:blender-outline"],
    [/slicer|grinder|spiralizer|cutting/, "mdi:knife"],
    [/sink|dishwash/, "mdi:dishwasher"],
    [/table|station/, "mdi:table-furniture"],
    [/freezer|chiller/, "mdi:snowflake"],
    [/cooler|refrigerat|fridge/, "mdi:fridge-outline"],
    [/ice machine/, "mdi:ice-pop"],
    [/scale/, "mdi:scale"],
    [/sealer/, "mdi:package-variant-closed"],
    [/pasta maker|extruder/, "mdi:noodles"],
    [/coffee|espresso/, "mdi:coffee-maker"],
    [/sous vide/, "mdi:thermometer"],
  ];
  const match = rules.find(([pattern]) => pattern.test(type));
  if (match) return match[1];
  return ({ cooking: "mdi:gas-burner", "food-prep": "mdi:knife", refrigeration: "mdi:fridge-outline", cleaning: "mdi:spray-bottle", specialty: "mdi:chef-hat" } as Record<string, string>)[category || ""] || EQUIPMENT_ICON_NAME;
}

export function resolveStorageIcon(storageType: string, name?: string | null): string {
  const type = (storageType || "").toLowerCase();
  if (/freez/.test(type)) return "mdi:snowflake";
  if (/cold|cool|refrigerat/.test(type)) return "mdi:fridge-outline";
  const label = (name || "").toLowerCase();
  if (/shel|rack/.test(label)) return "mdi:bookshelf";
  if (/cabinet|locker/.test(label)) return "mdi:locker";
  if (/dry/.test(type)) return "mdi:warehouse";
  return STORAGE_ICON_NAME;
}
