import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  FileText,
  AlertTriangle,
  Users,
  Building2,
  Gift,
  DollarSign,
  Settings,
  Clock,
  LogOut,
  BarChart3,
  Lock,
  LayoutDashboard,
} from "lucide-react";

export type AdminSection =
  | "overview"
  | "applications"
  | "kitchen-licenses"
  | "damage-claims"
  | "escalated-penalties"
  | "chef-kitchen-access"
  | "kitchen-management"
  | "promos"
  | "manager-revenues"
  | "platform-overview"
  | "platform-settings"
  | "overstay-settings"
  | "damage-claim-settings"
  | "account-settings";

interface AdminSidebarProps {
  activeSection: AdminSection;
  onSectionChange: (section: AdminSection) => void;
  onLogout: () => void;
  pendingReviewCount?: number;
  pendingLicensesCount?: number;
}

const NAV_GROUPS = [
  {
    label: "Dashboard",
    items: [
      { id: "overview" as AdminSection, label: "Overview", icon: LayoutDashboard },
    ],
  },
  {
    label: "Applications",
    items: [
      { id: "applications" as AdminSection, label: "Chef Applications", icon: Shield, badgeKey: "pendingReview" as const },
      { id: "kitchen-licenses" as AdminSection, label: "Kitchen Licenses", icon: FileText, badgeKey: "pendingLicenses" as const },
      { id: "damage-claims" as AdminSection, label: "Damage Claims", icon: AlertTriangle },
      { id: "escalated-penalties" as AdminSection, label: "Escalated", icon: AlertTriangle },
    ],
  },
  {
    label: "Management",
    items: [
      { id: "chef-kitchen-access" as AdminSection, label: "Chef Kitchen Access", icon: Users },
      { id: "kitchen-management" as AdminSection, label: "Manage Kitchens", icon: Building2 },
    ],
  },
  {
    label: "Communications",
    items: [
      { id: "promos" as AdminSection, label: "Send Promo Codes", icon: Gift },
    ],
  },
  {
    label: "Revenue",
    items: [
      { id: "manager-revenues" as AdminSection, label: "Manager Revenues", icon: DollarSign },
      { id: "platform-overview" as AdminSection, label: "Platform Overview", icon: BarChart3 },
    ],
  },
  {
    label: "Settings",
    items: [
      { id: "platform-settings" as AdminSection, label: "Platform Settings", icon: Settings },
      { id: "overstay-settings" as AdminSection, label: "Storage & Overstay", icon: Clock },
      { id: "damage-claim-settings" as AdminSection, label: "Damage Claims", icon: AlertTriangle },
      { id: "account-settings" as AdminSection, label: "Account Settings", icon: Lock },
    ],
  },
];

export function AdminSidebar({
  activeSection,
  onSectionChange,
  onLogout,
  pendingReviewCount = 0,
  pendingLicensesCount = 0,
}: AdminSidebarProps) {
  const getBadgeCount = (badgeKey?: string) => {
    if (badgeKey === "pendingReview") return pendingReviewCount;
    if (badgeKey === "pendingLicenses") return pendingLicensesCount;
    return 0;
  };

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="cursor-default hover:bg-transparent">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Shield className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Admin Panel</span>
                <span className="truncate text-xs text-muted-foreground">LocalCooks</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group, groupIndex) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const badgeCount = getBadgeCount(item.badgeKey);
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={activeSection === item.id}
                        onClick={() => onSectionChange(item.id)}
                        tooltip={item.label}
                      >
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                      {badgeCount > 0 && (
                        <SidebarMenuBadge>
                          <Badge variant="destructive" className="h-5 min-w-5 rounded-full px-1 text-[10px]">
                            {badgeCount}
                          </Badge>
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
            {groupIndex < NAV_GROUPS.length - 1 && <SidebarSeparator />}
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onLogout} tooltip="Sign Out">
              <LogOut className="size-4" />
              <span>Sign Out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
