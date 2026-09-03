"use client"

import * as React from "react"
import {
    AlertTriangle,
    Bell,
    Boxes,
    Building2,
    Calendar,
    Check,
    ChevronRight,
    ChevronsUpDown,
    ChefHat,
    ClipboardCheck,
    ClipboardList,
    Clock,
    CreditCard,
    DollarSign,
    Eye,
    FileText,
    Globe,
    LayoutDashboard,
    LogOut,
    MapPin,
    Package,
    PackageCheck,
    Send,
    Settings,
    User as UserIcon,
    Users,
    Wrench,
} from "lucide-react"

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
    SidebarRail,
    useSidebar,
} from "@/components/ui/sidebar"
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import Logo from "@/components/ui/logo"
import { SmartImage } from "@/components/ui/smart-image";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LanguageMenuSection } from "@/components/i18n/LanguageSwitcher";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { mt } from "@/i18n/manager";

interface NavItem {
    labelKey: string;
    url: string;
    icon: React.ComponentType<{ className?: string }>;
}

interface CollapsibleNavItem {
    labelKey: string;
    icon: React.ComponentType<{ className?: string }>;
    items: NavItem[];
}

interface NavGroup {
    labelKey: string;
    items: (NavItem | CollapsibleNavItem)[];
}

function isCollapsibleItem(item: NavItem | CollapsibleNavItem): item is CollapsibleNavItem {
    return 'items' in item && !('url' in item);
}

const navData: { navMain: NavGroup[] } = {
    navMain: [
        {
            labelKey: "navOverview",
            items: [
                { labelKey: "navDashboard", url: "overview", icon: LayoutDashboard },
                { labelKey: "navMyLocations", url: "my-locations", icon: MapPin },
                { labelKey: "navMessages", url: "messages", icon: Send },
                { labelKey: "navBookings", url: "bookings", icon: Calendar },
            ],
        },
        {
            labelKey: "navProperty",
            items: [
                { labelKey: "navKitchens", url: "kitchens", icon: ChefHat },
                { labelKey: "navViewings", url: "viewings", icon: Eye },
                { labelKey: "navAvailability", url: "availability", icon: Clock },
                { labelKey: "navPricing", url: "pricing", icon: DollarSign },
                {
                    labelKey: "navPropertySettings",
                    icon: Settings,
                    items: [
                        { labelKey: "navLicense", url: "settings-license", icon: FileText },
                        { labelKey: "navBookingRules", url: "settings-booking-rules", icon: Clock },
                        { labelKey: "navFacilityDocs", url: "settings-facility-docs", icon: FileText },
                        { labelKey: "navLocation", url: "settings-location", icon: Globe },
                        { labelKey: "navCheckinCheckout", url: "settings-checkin-checkout", icon: ClipboardCheck },
                        { labelKey: "navStorageCheckinCheckout", url: "settings-storage-checkin-checkout", icon: Boxes },
                    ],
                },
            ],
        },
        {
            labelKey: "navInventory",
            items: [
                { labelKey: "navStorage", url: "storage-listings", icon: Package },
                { labelKey: "navEquipment", url: "equipment-listings", icon: Wrench },
            ],
        },
        {
            labelKey: "navBusiness",
            items: [
                { labelKey: "navApplications", url: "applications", icon: Users },
                { labelKey: "navApplicationRequirements", url: "application-requirements", icon: ClipboardList },
                { labelKey: "navRevenue", url: "revenue", icon: DollarSign },
                { labelKey: "navPayments", url: "payments", icon: CreditCard },
                { labelKey: "navOverstayPenalties", url: "overstays", icon: AlertTriangle },
                { labelKey: "navDamageClaims", url: "damage-claims", icon: FileText },
                { labelKey: "navStorageInspections", url: "storage-checkouts", icon: PackageCheck },
            ],
        },
        {
            labelKey: "navAccount",
            items: [
                { labelKey: "navNotifications", url: "notifications", icon: Bell },
            ],
        },
    ],
}

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
    activeView: string;
    onViewChange: (view: string) => void;
    locations: Array<{ id: number; name: string; address?: string; logoUrl?: string }>;
    selectedLocation: { id: number; name: string; address?: string; logoUrl?: string } | null;
    onLocationChange: (location: { id: number; name: string } | null) => void;
    onCreateLocation?: () => void;
}

export function AppSidebar({
    activeView,
    onViewChange,
    locations,
    selectedLocation,
    onLocationChange,
    onCreateLocation,
    ...props
}: AppSidebarProps) {
    const { user, logout } = useFirebaseAuth();
    const { isMobile, state, setOpenMobile } = useSidebar();

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
                <SidebarGroup className="p-0">
                    <SidebarGroupLabel className="px-2 group-data-[collapsible=icon]:hidden">
                        {mt("navMyLocations")}
                    </SidebarGroupLabel>
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <SidebarMenuButton
                                        tooltip={selectedLocation?.name || mt("shellSelectLocation")}
                                        className="h-9 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                                    >
                                        <MapPin className="size-4 shrink-0 text-primary" />
                                        <span className="truncate group-data-[collapsible=icon]:hidden">
                                            {selectedLocation ? selectedLocation.name : mt("shellSelectLocation")}
                                        </span>
                                        <ChevronsUpDown className="ml-auto size-3.5 shrink-0 opacity-60 group-data-[collapsible=icon]:hidden" />
                                    </SidebarMenuButton>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                                    align="start"
                                    side={isMobile ? "bottom" : state === "collapsed" ? "right" : "bottom"}
                                    sideOffset={4}
                                >
                                    <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                                        {mt("navMyLocations")}
                                    </DropdownMenuLabel>
                                    {locations.length > 0 ? (
                                        locations.map((loc) => {
                                            const isSelected = selectedLocation?.id === loc.id;
                                            return (
                                                <DropdownMenuItem
                                                    key={loc.id}
                                                    onClick={() => onLocationChange(loc)}
                                                    className="gap-2 p-2"
                                                >
                                                    <div className="flex size-6 items-center justify-center rounded-sm border">
                                                        {loc.logoUrl ? (
                                                            <SmartImage src={loc.logoUrl} alt={loc.name} className="size-6 rounded-sm object-cover" />
                                                        ) : (
                                                            <MapPin className="size-4 shrink-0" />
                                                        )}
                                                    </div>
                                                    <div className="flex min-w-0 flex-1 flex-col">
                                                        <span className="truncate font-medium">{loc.name}</span>
                                                        {loc.address ? (
                                                            <span className="truncate text-xs text-muted-foreground">{loc.address}</span>
                                                        ) : null}
                                                    </div>
                                                    {isSelected ? <Check className="ml-auto size-4 shrink-0 text-primary" /> : null}
                                                </DropdownMenuItem>
                                            );
                                        })
                                    ) : (
                                        <DropdownMenuItem disabled>{mt("shellNoLocationsFound")}</DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        className="gap-2 p-2 cursor-pointer"
                                        onSelect={() => onCreateLocation?.()}
                                    >
                                        <div className="flex size-6 items-center justify-center rounded-md border bg-primary/10">
                                            <Building2 className="size-4 text-primary" />
                                        </div>
                                        <span className="font-medium">{mt("shellAddNewLocation")}</span>
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarGroup>
            </SidebarHeader>
            <SidebarContent>
                {navData.navMain.map((group) => (
                    <SidebarGroup key={group.labelKey}>
                        <SidebarGroupLabel>{mt(group.labelKey)}</SidebarGroupLabel>
                        <SidebarMenu>
                            {group.items.map((item) => {
                                if (isCollapsibleItem(item)) {
                                    const isAnyChildActive = item.items.some(
                                        (subItem) => activeView === subItem.url
                                    );
                                    const parentLabel = mt(item.labelKey);
                                    return (
                                        <Collapsible
                                            key={item.labelKey}
                                            asChild
                                            defaultOpen={isAnyChildActive}
                                            className="group/collapsible"
                                        >
                                            <SidebarMenuItem>
                                                <CollapsibleTrigger asChild>
                                                    <SidebarMenuButton
                                                        tooltip={parentLabel}
                                                        className={cn(
                                                            isAnyChildActive && "bg-sidebar-accent text-sidebar-accent-foreground"
                                                        )}
                                                    >
                                                        {item.icon && <item.icon className="size-4" />}
                                                        <span>{parentLabel}</span>
                                                        <ChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                                                    </SidebarMenuButton>
                                                </CollapsibleTrigger>
                                                <CollapsibleContent>
                                                    <SidebarMenuSub>
                                                        {item.items.map((subItem) => {
                                                            const isSubActive = activeView === subItem.url;
                                                            const subLabel = mt(subItem.labelKey);
                                                            return (
                                                                <SidebarMenuSubItem key={subItem.labelKey}>
                                                                    <SidebarMenuSubButton
                                                                        asChild
                                                                        isActive={isSubActive}
                                                                    >
                                                                        <button
                                                                            onClick={() => onViewChange(subItem.url)}
                                                                            className="w-full cursor-pointer"
                                                                        >
                                                                            <subItem.icon />
                                                                            <span>{subLabel}</span>
                                                                        </button>
                                                                    </SidebarMenuSubButton>
                                                                </SidebarMenuSubItem>
                                                            );
                                                        })}
                                                    </SidebarMenuSub>
                                                </CollapsibleContent>
                                            </SidebarMenuItem>
                                        </Collapsible>
                                    );
                                }

                                const isActive = activeView === item.url;
                                const label = mt(item.labelKey);
                                return (
                                    <SidebarMenuItem key={item.labelKey}>
                                        <SidebarMenuButton
                                            isActive={isActive}
                                            onClick={() => onViewChange(item.url)}
                                            tooltip={label}
                                            className={cn(isActive && "text-sidebar-primary-foreground font-medium")}
                                        >
                                            {item.icon && <item.icon className="size-4" />}
                                            <span>{label}</span>
                                        </SidebarMenuButton>
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
