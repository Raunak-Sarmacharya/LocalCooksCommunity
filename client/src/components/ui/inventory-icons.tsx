import { addIcon, Icon, type IconProps } from "@iconify/react";
import { icons } from "@iconify-json/mdi";

export const EQUIPMENT_ICON_NAME = "mdi:stove";
export const STORAGE_ICON_NAME = "lucide-lab:cabinet-filing";

addIcon(EQUIPMENT_ICON_NAME, { ...icons.icons.stove, width: 24, height: 24 });
addIcon(STORAGE_ICON_NAME, {
  width: 24,
  height: 24,
  body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M4 12h16"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M10 6h4m-4 10h4"/></g>',
});

export function EquipmentIcon(props: Omit<IconProps, "icon">) {
  return <Icon icon={EQUIPMENT_ICON_NAME} aria-hidden {...props} />;
}
export function StorageIcon(props: Omit<IconProps, "icon">) {
  return <Icon icon={STORAGE_ICON_NAME} aria-hidden {...props} />;
}
