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
import { RefreshCw } from "lucide-react";
import type { AdminSection } from "./AdminSidebar";

interface AdminHeaderProps {
  activeSection: AdminSection;
  onRefresh?: () => void;
  isRefreshing?: boolean;
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
};

export function AdminHeader({ activeSection, onRefresh, isRefreshing }: AdminHeaderProps) {
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
