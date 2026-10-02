import { StorageIcon } from "@/components/ui/inventory-icons";
import { ChefApplicationIcon } from "@/components/ui/application-icons";
import { AlertTriangle, CalendarDays, ClipboardCheck, DollarSign, KitchenTour, FileText, LayoutDashboard, MessageSquare, Shield } from "@/components/ui/manager-icons";
import { SiStripe } from "react-icons/si";
import { KitchenIcon } from "@/components/ui/kitchen-icon";

/** One glyph per manager destination, shared by the sidebar and command menu. */
export const managerNavIcons = {
  overview: LayoutDashboard,
  kitchens: KitchenIcon,
  bookings: CalendarDays,
  viewings: KitchenTour,
  "tour-availability": KitchenTour,
  payments: SiStripe,
  "damage-claims": FileText,
  "storage-bookings": StorageIcon,
  "settings-storage-checkin-checkout": StorageIcon,
  overstays: AlertTriangle,
  "storage-checkouts": StorageIcon,
  applications: ChefApplicationIcon,
  "application-requirements": ClipboardCheck,
  revenue: DollarSign,
  messages: MessageSquare,
  "settings-facility-docs": FileText,
  "settings-license": Shield,
} as const;
