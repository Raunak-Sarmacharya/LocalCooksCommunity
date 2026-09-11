import type { ComponentPropsWithoutRef } from "react";
import { CalendarCheck2, ClipboardList, Clock, Inbox, Search, type LucideIcon } from "lucide-react";
import { InfoChip } from "@/components/chef/info-chip";
import type { KitchenActionKind, KitchenDisplayStatus } from "./status";

/** Kitchen open for new chef applications (Discover card, no app yet). */
export const acceptingRequestsIcon: LucideIcon = Inbox;

/** Icon for Book Now CTAs — calendar-check reads as “ready to schedule”. */
export const bookNowIcon: LucideIcon = CalendarCheck2;

export function kitchenActionKindIcon(kind: KitchenActionKind): LucideIcon {
  switch (kind) {
    case "book":
      return CalendarCheck2;
    case "wait":
      return Clock;
    case "complete-step":
      return ClipboardList;
    case "discover":
      return Search;
  }
}

/** Status chip with action-specific icon (Book Now ≠ Accepting Requests ≠ Check). */
export function KitchenStatusChip({
  display,
  className,
  ...props
}: {
  display: KitchenDisplayStatus;
} & Omit<ComponentPropsWithoutRef<typeof InfoChip>, "tone" | "icon" | "children" | "variant">) {
  const Icon = kitchenActionKindIcon(display.actionKind);
  return (
    <InfoChip tone={display.tone} icon={<Icon />} className={className} {...props}>
      {display.label}
    </InfoChip>
  );
}
