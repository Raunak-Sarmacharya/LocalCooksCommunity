import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  FileText,
  Building,
  Calendar,
  BookOpen,
  MessageCircle,
  Search,
  Headphones,
  CreditCard,
  AlertTriangle,
  Store,
  MessageSquare,
  DollarSign,
} from "lucide-react";
import { useChefSidebarHiddenItems } from "@/hooks/use-chef-sidebar-hidden-items";

interface ChefCommandPaletteProps {
  onNavigate: (view: string) => void;
}

const navigationItems = [
  { labelKey: "shellOverview", value: "overview", icon: LayoutDashboard, group: "shellNavigation" },
  { labelKey: "shellMyApplication", value: "applications", icon: FileText, group: "shellNavigation" },
  { labelKey: "shellMyKitchens", value: "kitchen-applications", icon: Building, group: "shellNavigation" },
  { labelKey: "shellMyBookings", value: "bookings", icon: Calendar, group: "shellNavigation" },
  { labelKey: "shellMyEarnings", value: "seller-revenue", icon: DollarSign, group: "shellNavigation" },
  { labelKey: "shellLinkedAccounts", value: "my-account", icon: Store, group: "shellNavigation" },
  { labelKey: "shellTraining", value: "training", icon: BookOpen, group: "shellNavigation" },
  { labelKey: "shellMessages", value: "messages", icon: MessageCircle, group: "shellNavigation" },
  { labelKey: "shellDiscoverKitchens", value: "discover-kitchens", icon: Search, group: "shellNavigation" },
  { labelKey: "shellSupport", value: "support", icon: Headphones, group: "shellNavigation" },
  { labelKey: "shellFeedback", value: "feedback", icon: MessageSquare, group: "shellNavigation" },
];

const financialItems = [
  { labelKey: "shellTransactions", value: "transactions", icon: CreditCard, group: "shellFinancial" },
  { labelKey: "shellResolutionCenter", value: "issues-refunds", icon: AlertTriangle, group: "shellFinancial" },
];

const quickActions = [
  { labelKey: "shellApplyToSell", value: "applications", icon: Store, group: "shellQuickActions" },
  { labelKey: "shellBookKitchenSession", value: "discover-kitchens", icon: Calendar, group: "shellQuickActions" },
  { labelKey: "shellStartLiveChat", value: "support", icon: MessageCircle, group: "shellQuickActions" },
];

export default function ChefCommandPalette({ onNavigate }: ChefCommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation("chef");
  const tr = t as unknown as TFunction;
  const hiddenItems = useChefSidebarHiddenItems();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const handleSelect = (value: string) => {
    setOpen(false);
    onNavigate(value);
  };

  const visibleNav = navigationItems.filter((item) => !hiddenItems.includes(item.value));
  const visibleFinancial = financialItems.filter((item) => !hiddenItems.includes(item.value));

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={tr("shellSearchCommand" as never)} />
      <CommandList>
        <CommandEmpty>{tr("shellNoResults" as never)}</CommandEmpty>
        <CommandGroup heading={tr("shellNavigation" as never)}>
          {visibleNav.map((item) => (
            <CommandItem
              key={item.value}
              value={tr(item.labelKey as never)}
              onSelect={() => handleSelect(item.value)}
            >
              <item.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{tr(item.labelKey as never)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={tr("shellFinancial" as never)}>
          {visibleFinancial.map((item) => (
            <CommandItem
              key={item.value}
              value={tr(item.labelKey as never)}
              onSelect={() => handleSelect(item.value)}
            >
              <item.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{tr(item.labelKey as never)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={tr("shellQuickActions" as never)}>
          {quickActions.map((item) => (
            <CommandItem
              key={item.labelKey}
              value={tr(item.labelKey as never)}
              onSelect={() => handleSelect(item.value)}
            >
              <item.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{tr(item.labelKey as never)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
