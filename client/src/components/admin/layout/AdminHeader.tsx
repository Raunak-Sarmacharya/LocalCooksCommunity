import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { RefreshCw, Search } from "lucide-react";
import type { AdminSection } from "./AdminSidebar";

interface AdminHeaderProps {
  activeSection: AdminSection;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onSearchClick?: () => void;
}

const SECTION_META: Record<AdminSection, { category: string; title: string }> = {
  overview: { category: "Dashboard", title: "Overview" },
  applications: { category: "Applications", title: "Chef Applications" },
  "kitchen-licenses": { category: "Applications", title: "Kitchen Licenses" },
  "damage-claims": { category: "Applications", title: "Damage Claims" },
  "escalated-penalties": { category: "Applications", title: "Escalated Penalties" },
  "chef-kitchen-access": { category: "Management", title: "Chef Kitchen Access" },
  "kitchen-management": { category: "Management", title: "Manage Kitchens" },
  promos: { category: "Communications", title: "Send Promo Codes" },
  "manager-revenues": { category: "Revenue", title: "Manager Revenues" },
  "platform-overview": { category: "Revenue", title: "Platform Overview" },
  "platform-settings": { category: "Settings", title: "Platform Settings" },
  "overstay-settings": { category: "Settings", title: "Storage & Overstay" },
  "damage-claim-settings": { category: "Settings", title: "Damage Claims" },
  "account-settings": { category: "Settings", title: "Account Settings" },
  transactions: { category: "Revenue", title: "Transaction History" },
  "overstay-penalties-history": { category: "Revenue", title: "Overstay Penalties" },
  "damage-claims-history": { category: "Revenue", title: "Damage Claims History" },
  "security-settings": { category: "Settings", title: "Security & Rate Limits" },
};

export function AdminHeader({ activeSection, onRefresh, isRefreshing, onSearchClick }: AdminHeaderProps) {
  const meta = SECTION_META[activeSection];

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem className="hidden md:block">
            <span className="text-muted-foreground">{meta.category}</span>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{meta.title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-2">
        {onSearchClick && (
          <Button
            variant="outline"
            className="hidden md:flex relative h-8 justify-start rounded-[0.5rem] bg-background text-sm font-normal text-muted-foreground shadow-none sm:pr-12 w-48 lg:w-64"
            onClick={onSearchClick}
          >
            <Search className="mr-2 h-3.5 w-3.5" />
            <span>Search or lookup ref...</span>
            <kbd className="pointer-events-none absolute right-[0.3rem] top-[0.25rem] hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
              <span className="text-xs">⌘</span>K
            </kbd>
          </Button>
        )}
        {onRefresh && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="h-8 w-8"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            <span className="sr-only">Refresh</span>
          </Button>
        )}
      </div>
    </header>
  );
}
