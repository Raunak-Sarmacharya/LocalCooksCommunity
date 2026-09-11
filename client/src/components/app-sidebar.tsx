"use client"

import * as React from "react"
import { AlertTriangle, Bell, Boxes, Calendar, ChevronsUpDown, ClipboardCheck, Clock, DollarSign, Eye, FileText, LayoutDashboard, LogOut, ArchiveCheck, Package, Send, Settings, Storefront, User as UserIcon, Users } from "@/components/ui/manager-icons"

import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarRail, useSidebar } from "@/components/ui/sidebar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import Logo from "@/components/ui/logo"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LanguageMenuSection } from "@/components/i18n/LanguageSwitcher";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { mt } from "@/i18n/manager";
import type { ManagerBreadcrumb } from "@/lib/manager-kitchens-navigation";

interface NavItem {
    labelKey: string;
    url: string;
    icon: React.ComponentType<{ className?: string }>;
    children?: NavItem[];
}

interface NavGroup {
    labelKey: string;
    items: NavItem[];
}

const navData: { navMain: NavGroup[] } = {
    navMain: [
        {
            labelKey: "navWorkspace",
            items: [
                { labelKey: "navDashboard", url: "overview", icon: LayoutDashboard },
                { labelKey: "navBookings", url: "bookings", icon: Calendar },
                { labelKey: "navRequests", url: "applications", icon: Users },
                {
                    labelKey: "navSpaces",
                    url: "kitchens",
                    icon: Storefront,
                    children: [
                        { labelKey: "navAvailability", url: "availability", icon: Clock },
                        { labelKey: "navCheckinCheckout", url: "settings-checkin-checkout", icon: ClipboardCheck },
                        { labelKey: "navDamageClaims", url: "damage-claims", icon: FileText },
                    ],
                },
                {
                    labelKey: "navStorageBookings",
                    url: "storage-bookings",
                    icon: Package,
                    children: [
                        { labelKey: "navStorageCheckinCheckout", url: "settings-storage-checkin-checkout", icon: Boxes },
                        { labelKey: "navOverstayPenalties", url: "overstays", icon: AlertTriangle },
                        { labelKey: "navStorageInspections", url: "storage-checkouts", icon: ArchiveCheck },
                    ],
                },
                { labelKey: "navSettings", url: "settings", icon: Settings },
            ],
        },

        {
            labelKey: "navMoney",
            items: [
                { labelKey: "navRevenue", url: "revenue", icon: DollarSign },
            ],
        },
        {
            labelKey: "navInbox",
            items: [
                { labelKey: "navMessages", url: "messages", icon: Send },
                { labelKey: "navNotifications", url: "notifications", icon: Bell },
            ],
        },
    ],
}

const SETTINGS_VIEWS = new Set([
    "settings",
    "settings-license",
    "settings-booking-rules",
    "settings-facility-docs",
    "settings-location",
    "application-requirements",
]);

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
    activeView: string;
    onViewChange: (view: string) => void;
    locations: Array<{ id: number; name: string; address?: string; logoUrl?: string }>;
    selectedLocation: { id: number; name: string; address?: string; logoUrl?: string } | null;
    onLocationChange: (location: { id: number; name: string } | null) => void;
    onCreateLocation?: () => void;
    breadcrumbs?: ManagerBreadcrumb[];
}

export function AppSidebar({
    activeView,
    onViewChange,
    breadcrumbs,
    locations: _locations,
    selectedLocation: _selectedLocation,
    onLocationChange: _onLocationChange,
    onCreateLocation: _onCreateLocation,
    ...props
}: AppSidebarProps) {
    const { user, logout } = useFirebaseAuth();
    const { isMobile, state, setOpenMobile } = useSidebar();
    const activeChildView = breadcrumbs?.[breadcrumbs.length - 1]?.navId;

    const handleAccountAction = (view: string) => {
        onViewChange(view);
        if (isMobile) setOpenMobile(false);
    };

    const initials = user?.displayName
        ? user.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()
        : "KM";

    return (
        <Sidebar collapsible="icon" {...props}>
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" className="pointer-events-none">
                            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                                <Logo variant="white" className="size-5" />
                            </div>
                            <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                                <span className="truncate font-semibold text-[#F51042] font-logo text-lg tracking-tight">LocalCooks</span>
                                <span className="truncate text-[10px] font-medium text-muted-foreground uppercase tracking-wider leading-none">{mt("shellForKitchens")}</span>
                            </div>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent className="gap-0">
                {navData.navMain.map((group) => (
                    <SidebarGroup key={group.labelKey} className="px-2 py-0.5">
                        <SidebarMenu className="gap-0.5">
                            {group.items.map((item) => {
                                const isActive = activeView === item.url || (item.url === "settings" && SETTINGS_VIEWS.has(activeView));
                                const label = mt(item.labelKey);
                                return (
                                    <SidebarMenuItem key={item.labelKey}>
                                        <SidebarMenuButton
                                            isActive={isActive}
                                            onClick={() => handleAccountAction(item.url)}
                                            tooltip={label}
                                            className={cn(isActive && "text-sidebar-primary-foreground font-medium")}
                                        >
                                            {item.icon && <item.icon className="size-4" />}
                                            <span>{label}</span>
                                        </SidebarMenuButton>
                                        {item.children && (
                                            <SidebarMenuSub className="mx-2 mb-0 mt-0 translate-x-0 gap-0 border-l border-sidebar-border/80 px-2 py-0">
                                                {item.children.map((child) => (
                                                    <SidebarMenuSubItem key={child.url}>
                                                        <SidebarMenuSubButton asChild isActive={activeChildView === child.url}>
                                                            <button onClick={() => handleAccountAction(child.url)} className="w-full cursor-pointer">
                                                                <child.icon />
                                                                <span>{mt(child.labelKey)}</span>
                                                            </button>
                                                        </SidebarMenuSubButton>
                                                    </SidebarMenuSubItem>
                                                ))}
                                            </SidebarMenuSub>
                                        )}
                                    </SidebarMenuItem>
                                );
                            })}
                        </SidebarMenu>
                    </SidebarGroup>
                ))}
            </SidebarContent>
            <SidebarFooter>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                                <SidebarMenuButton
                                    size="lg"
                                    tooltip={mt("shellProfile")}
                                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                                >
                                    <Avatar className="h-8 w-8 rounded-lg">
                                        <AvatarImage src={user?.photoURL || ""} alt={user?.displayName || mt("shellProfile")} />
                                        <AvatarFallback className="rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                                            {initials}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                                        <span className="truncate font-semibold">{user?.displayName || mt("shellManagerFallback")}</span>
                                        <span className="truncate text-xs text-muted-foreground">{user?.email || ""}</span>
                                    </div>
                                    <ChevronsUpDown className="ml-auto size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
                                </SidebarMenuButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                className="w-64 rounded-lg p-2"
                                align="end"
                                side={isMobile ? "bottom" : state === "collapsed" ? "right" : "top"}
                                sideOffset={4}
                            >
                                <div className="mb-1 px-3 py-2.5">
                                    <p className="text-sm font-medium leading-tight">{user?.displayName || mt("shellManagerFallback")}</p>
                                    <p className="text-xs leading-tight text-muted-foreground">{user?.email || ""}</p>
                                </div>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => handleAccountAction("profile")} className="cursor-pointer">
                                    <UserIcon className="mr-2 h-4 w-4" />
                                    {mt("shellProfile")}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <LanguageMenuSection />
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    onClick={() => logout()}
                                    className="cursor-pointer text-destructive focus:text-destructive"
                                >
                                    <LogOut className="mr-2 h-4 w-4" />
                                    {mt("shellSignOut")}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    )
}
