import { useEffect, useState } from "react";
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
} from "lucide-react";

interface ChefCommandPaletteProps {
  onNavigate: (view: string) => void;
}

const navigationItems = [
  { label: "Overview", value: "overview", icon: LayoutDashboard, group: "Navigation" },
  { label: "My Application", value: "applications", icon: FileText, group: "Navigation" },
  { label: "My Kitchens", value: "kitchen-applications", icon: Building, group: "Navigation" },
  { label: "My Bookings", value: "bookings", icon: Calendar, group: "Navigation" },
  { label: "Training", value: "training", icon: BookOpen, group: "Navigation" },
  { label: "Messages", value: "messages", icon: MessageCircle, group: "Navigation" },
  { label: "Discover Kitchens", value: "discover-kitchens", icon: Search, group: "Navigation" },
  { label: "Support", value: "support", icon: Headphones, group: "Navigation" },
  { label: "Feedback", value: "feedback", icon: MessageSquare, group: "Navigation" },
];

const financialItems = [
  { label: "Transaction History", value: "transactions", icon: CreditCard, group: "Financial" },
  { label: "Resolution Center", value: "damage-claims", icon: AlertTriangle, group: "Financial" },
];

const quickActions = [
  { label: "Apply to Sell on LocalCooks", value: "applications", icon: Store, group: "Quick Actions" },
  { label: "Book a Kitchen Session", value: "discover-kitchens", icon: Calendar, group: "Quick Actions" },
  { label: "Start Live Chat", value: "support", icon: MessageCircle, group: "Quick Actions" },
];

export default function ChefCommandPalette({ onNavigate }: ChefCommandPaletteProps) {
  const [open, setOpen] = useState(false);

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

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages, actions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          {navigationItems.map((item) => (
            <CommandItem
              key={item.value}
              value={item.label}
              onSelect={() => handleSelect(item.value)}
            >
              <item.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{item.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Financial">
          {financialItems.map((item) => (
            <CommandItem
              key={item.value}
              value={item.label}
              onSelect={() => handleSelect(item.value)}
            >
              <item.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{item.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Quick Actions">
          {quickActions.map((item) => (
            <CommandItem
              key={item.label}
              value={item.label}
              onSelect={() => handleSelect(item.value)}
            >
              <item.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{item.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
