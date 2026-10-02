import { addIcon, Icon, type IconProps } from "@iconify/react";

// Register the requested name locally with Pinhead's equivalent published glyph, so it works offline.
export const KITCHEN_ICON_NAME = "pinhead:spoon-beside-table-knife-in-gable-roofed-shelter";

addIcon(KITCHEN_ICON_NAME, {
  width: 15,
  height: 15,
  body: '<path fill="currentColor" d="M7.5 0L15 4v2.5l-1-.53V15h-2V4.9L7.5 2.5L3 4.9V15H1V5.97L0 6.5V4zm-2 5C6.07 5 7 6.29 7 8s-1 2-1 2v5H5v-5l-.07-.03C4.69 9.87 4 9.43 4 8c0-1.71.93-3 1.5-3M8 5c1.25 0 2.5 1.75 2.5 4v2.5H9V15H8z"/>',
});

export function KitchenIcon(props: Omit<IconProps, "icon">) {
  return <Icon icon={KITCHEN_ICON_NAME} aria-hidden {...props} />;
}
