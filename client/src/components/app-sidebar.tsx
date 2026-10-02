"use client"

import * as React from "react"
import { ChevronRight, ChevronsUpDown, LogOut, User as UserIcon } from "@/components/ui/manager-icons"

import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarRail, useSidebar } from "@/components/ui/sidebar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import Logo from "@/components/ui/logo"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LanguageMenuSection } from "@/components/i18n/LanguageSwitcher";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { mt } from "@/i18n/manager";
import type { ManagerBreadcrumb } from "@/lib/manager-kitchens-navigation";
import ManagerGettingStarted, { type ManagerGettingStartedProps } from "@/components/manager/ManagerGettingStarted";
import type { GettingStartedItemId } from "@/lib/manager-getting-started";
import { managerNavIcons } from "@/lib/manager-nav-icons";

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
                { labelKey: "navDashboard", url: "overview", icon: managerNavIcons.overview },
                { labelKey: "navSpaces", url: "kitchens", icon: managerNavIcons.kitchens },
                {
                    labelKey: "navBookings",
                    url: "bookings",
                    icon: managerNavIcons.bookings,
                    children: [
                        { labelKey: "navDamageClaims", url: "damage-claims", icon: managerNavIcons["damage-claims"] },
                    ],
                },
                {
                    labelKey: "navStorageBookings",
                    url: "storage-bookings",
                    icon: managerNavIcons["storage-bookings"],
                },
                {
                    labelKey: "navRequests",
                    url: "applications",
                    icon: managerNavIcons.applications,
                    children: [
                        { labelKey: "navApplicationRequirements", url: "application-requirements", icon: managerNavIcons["application-requirements"] },
                    ],
                },
                { labelKey: "navRevenue", url: "revenue", icon: managerNavIcons.revenue },
                {
                    labelKey: "navMessages",
                    url: "messages",
                    icon: managerNavIcons.messages,
                    children: [
                        { labelKey: "facilityDocuments", url: "settings-facility-docs", icon: managerNavIcons["settings-facility-docs"] },
                    ],
                },
                { labelKey: "kitchenLicense", url: "settings-license", icon: managerNavIcons["settings-license"] },
            ],
        },
    ],
}

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
    showBookings?: boolean;
    showStorageBookings?: boolean;
    showApplications?: boolean;
    showRevenue?: boolean;
    activeView: string;
    onViewChange: (view: string) => void;
    locations: Array<{ id: number; name: string; address?: string; logoUrl?: string }>;
    selectedLocation: { id: number; name: string; address?: string; logoUrl?: string } | null;
    onLocationChange: (location: { id: number; name: string } | null) => void;
    onCreateLocation?: () => void;
    breadcrumbs?: ManagerBreadcrumb[];
    /**
     * The Getting Started checklist, already built.
     *
     * The sidebar renders it and nothing else — the rules live in `lib/manager-getting-started.ts`
     * and the destinations in the dashboard, which owns `handleViewChange` and its dirty-form
     * guards. This replaced the wizard's `setupSteps`, which the banner and this list used to share.
     */
    managerGettingStarted?: ManagerGettingStartedProps;
}

export function AppSidebar({
    activeView,
    onViewChange,
    breadcrumbs,
    locations: _locations,
    selectedLocation: _selectedLocation,
    onLocationChange: _onLocationChange,
    onCreateLocation: _onCreateLocation,
    managerGettingStarted,
    showBookings = true,
    showStorageBookings = true,
    showApplications = true,
    showRevenue = true,
    ...props
}: AppSidebarProps) {
    const { user, logout } = useFirebaseAuth();
    const { isMobile, state, setOpenMobile } = useSidebar();
    const [openParent, setOpenParent] = React.useState<string | null>(null);
    const activeChildView = breadcrumbs?.[breadcrumbs.length - 1]?.navId ?? activeView;

    React.useEffect(() => {
        if (!openParent) return;
        const parent = navData.navMain.flatMap((group) => group.items).find((item) => item.url === openParent);
        if (activeView !== openParent && !parent?.children?.some((child) => child.url === activeView)) {
            setOpenParent(null);
        }
    }, [activeView, openParent]);

    const handleAccountAction = (view: string, keepParentOpen = false) => {
        onViewChange(view);
        if (!keepParentOpen) setOpenParent(null);
        if (isMobile) setOpenMobile(false);
    };

    const handleParentAction = (view: string) => {
        onViewChange(view);
    };

    /**
     * "Getting started" rows deep-link into the page that completes them.
     *
     * The DASHBOARD owns the destination — it owns `handleViewChange` and the dirty-form guards
     * that stop a row navigating away from unsaved work — so this only forwards, and closes the
     * mobile drawer, which the dashboard cannot see.
     */
    const handleGettingStartedItem = (id: GettingStartedItemId) => {
        managerGettingStarted?.onSelectItem?.(id);
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
                        <SidebarMenu className="gap-1.5">
                            {group.items.filter((item) => (item.url !== "bookings" || showBookings) && (item.url !== "storage-bookings" || showStorageBookings) && (item.url !== "applications" || showApplications) && (item.url !== "revenue" || showRevenue)).map((item) => {
                                // Highlight only the destination, including breadcrumb child destinations.
                                const isActive = activeView === item.url && !item.children?.some((child) => child.url === activeChildView);
                                const hasActiveChild = !!item.children?.some((child) => child.url === activeView);
                                const label = mt(item.labelKey);
                                const content = (
                                    <SidebarMenuItem key={item.labelKey}>
                                        {item.children ? (
                                            <CollapsibleTrigger asChild>
                                                <SidebarMenuButton
                                                    isActive={isActive}
                                                    onClick={() => handleParentAction(item.url)}
                                                    tooltip={label}
                                                    className={cn(isActive && "font-medium", hasActiveChild && !isActive && "font-medium text-sidebar-foreground")}
                                                >
                                                    <item.icon className="size-4" />
                                                    <span>{label}</span>
                                                    <ChevronRight className="ml-auto size-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                                                </SidebarMenuButton>
                                            </CollapsibleTrigger>
                                        ) : (
                                            <SidebarMenuButton
                                                isActive={isActive}
                                                onClick={() => handleAccountAction(item.url)}
                                                tooltip={label}
                                                className={cn(isActive && "font-medium")}
                                            >
                                                <item.icon className="size-4" />
                                                <span>{label}</span>
                                            </SidebarMenuButton>
                                        )}
                                        {item.children && (
                                            <CollapsibleContent>
                                                <SidebarMenuSub className="mx-2 mb-1 mt-1 translate-x-0 gap-1 border-l border-sidebar-border/80 px-2 py-1">
                                                    {item.children.map((child) => (
                                                        <SidebarMenuSubItem key={child.url}>
                                                            <SidebarMenuSubButton
                                                                asChild
                                                                size="sm"
                                                                isActive={activeChildView === child.url}
                                                                className="h-auto min-h-11 py-2 text-[12px] leading-snug md:min-h-9 md:py-2 [&>span:last-child]:whitespace-normal [&>span:last-child]:break-words"
                                                            >
                                                                <button onClick={() => handleAccountAction(child.url, true)} className="w-full cursor-pointer text-left">
                                                                    <child.icon />
                                                                    <span>{mt(child.labelKey)}</span>
                                                                </button>
                                                            </SidebarMenuSubButton>
                                                        </SidebarMenuSubItem>
                                                    ))}
                                                </SidebarMenuSub>
                                            </CollapsibleContent>
                                        )}
                                    </SidebarMenuItem>
                                );
                                return item.children ? (
                                    <Collapsible
                                        key={item.labelKey}
                                        asChild
                                        open={openParent === item.url}
                                        onOpenChange={(open) => setOpenParent(open ? item.url : null)}
                                        className="group/collapsible"
                                    >
                                        {content}
                                    </Collapsible>
                                ) : content;
                            })}
                        </SidebarMenu>
                    </SidebarGroup>
                ))}
            </SidebarContent>
            <SidebarFooter>
                {/*
                  Getting Started lives in the FOOTER rather than in `SidebarContent`.

                  The panel opens as a portalled flyout, so nothing here is clipped either way — but
                  the footer groups the checklist with the account menu, which is where a persistent
                  progress widget belongs, and it drops the `mt-auto` hack the nav list needed.
                */}
                {managerGettingStarted?.items.length ? (
                    <ManagerGettingStarted
                        {...managerGettingStarted}
                        onSelectItem={handleGettingStartedItem}
                    />
                ) : null}
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
