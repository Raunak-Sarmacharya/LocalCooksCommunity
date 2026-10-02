import { addIcon, getIcon, Icon, type IconProps } from "@iconify/react";
import { KITCHEN_ICON_NAME } from "./kitchen-icon";

export const KITCHEN_APPLICATION_ICON = "localcooks:kitchen-application";

// The entity identifies the application type; the trailing document identifies the request.
function registerApplicationIcon(name: string, body: string, width: number, height: number) {
  addIcon(name, {
    width: 24,
    height: 24,
    body: `<g transform="translate(0 2) scale(${15 / width} ${20 / height})">${body}</g><path fill="currentColor" d="M17 6h4l3 3v13h-7zm1.5 1.5v13H22.5V10H20V7.5z"/>`,
  });
}
const kitchen = getIcon(KITCHEN_ICON_NAME)!;
registerApplicationIcon(KITCHEN_APPLICATION_ICON, kitchen.body, kitchen.width!, kitchen.height!);

export function KitchenApplicationIcon(props: Omit<IconProps, "icon">) {
  return <Icon icon={KITCHEN_APPLICATION_ICON} aria-hidden {...props} />;
}

export const CHEF_APPLICATION_ICON = "material-symbols:inbox-text-person-rounded";
addIcon(CHEF_APPLICATION_ICON, {"width": 24, "height": 24, "body": "<path fill=\"currentColor\" d=\"M18 16q-.825 0-1.412-.587T16 14t.588-1.412T18 12t1.413.588T20 14t-.587 1.413T18 16m.075 1q.7 0 1.375.138t1.325.437q.5.225.863.638t.362.962q0 .35-.238.588t-.587.237H14.8q-.35 0-.575-.238T14 19.176q0-.55.35-.975t.85-.625q.675-.275 1.413-.425t1.462-.15M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v4.025q0 .425-.288.7T20 10t-.712-.288T19 9V5H5v9h3.55q.275 0 .513.138t.362.362q.225.375.538.688t.712.512q.2.1.3.288t.075.387q-.075.8.025 1.588t.375 1.537q.2.55-.05 1.025t-.75.475zM8 8.75h8q.425 0 .713-.288T17 7.75t-.288-.712T16 6.75H8q-.425 0-.712.288T7 7.75t.288.713T8 8.75m0 3.5h5.6q.425 0 .713-.288t.287-.712t-.287-.712t-.713-.288H8q-.425 0-.712.288T7 11.25t.288.713t.712.287\"/>"});

export function ChefApplicationIcon(props: Omit<IconProps, "icon">) {
  return <Icon icon={CHEF_APPLICATION_ICON} aria-hidden {...props} />;
}
