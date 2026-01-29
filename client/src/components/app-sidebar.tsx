"use client"

import * as React from "react"
import {
    BookOpen,
    Calendar,
    Clock,
    CreditCard,
    DollarSign,
    MapPin,
    Package,
    Settings,
    Users,
    Wrench,
    ChevronsUpDown,
    Sparkles,
    LifeBuoy,
    Send
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
    SidebarRail,
    SidebarSeparator,
} from "@/components/ui/sidebar"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import Logo from "@/components/ui/logo"

// Define the navigation items structure
const data = {
    navMain: [
        {
            title: "Overview",
            items: [
                {
                    title: "Dashboard",
                    url: "overview",
                    icon: MapPin,
                },
                {
                    title: "My Locations",
                    url: "my-locations",
                    icon: MapPin,
                },
                {
                    title: "Messages",
                    url: "messages",
                    icon: Send, // Using Send as a proxy for MessageCircle if not imported, or update imports
                },
                {
                    title: "Bookings",
                    url: "bookings",
                    icon: Calendar,
                },
            ],
        },
        {
            title: "Property",
            items: [
                {
                    title: "Settings",
                    url: "settings",
                    icon: Settings,
                },
                {
                    title: "Availability",
                    url: "availability",
                    icon: Clock,
                },
                {
                    title: "Pricing",
                    url: "pricing",
                    icon: DollarSign,
                },
            ],
        },
        {
            title: "Inventory",
            items: [
                {
                    title: "Storage",
                    url: "storage-listings",
                    icon: Package,
                },
                {
                    title: "Equipment",
                    url: "equipment-listings",
                    icon: Wrench,
                },
            ],
        },
        {
            title: "Business",
            items: [
                {
                    title: "Applications",
                    url: "applications",
                    icon: Users,
                },
                {
                    title: "Revenue",
                    url: "revenue",
                    icon: DollarSign,
                },
                {
                    title: "Payments",
                    url: "payments",
                    icon: CreditCard,
                },
            ],
        },
    ],
    navSecondary: [
        {
            title: "Support",
            url: "support", // Use a generic support view or modal
            icon: LifeBuoy,
        },
        {
            title: "Feedback",
            url: "feedback",
            icon: Send,
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
    return (
        <Sidebar collapsible="icon" {...props}>
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                                <Logo variant="white" className="size-5" />
                            </div>
                            <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                                <span className="truncate font-semibold text-[#F51042] font-logo text-lg tracking-tight">LocalCooks</span>
                                <span className="truncate text-[10px] font-medium text-muted-foreground uppercase tracking-wider leading-none">for kitchens</span>
                            </div>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
                {data.navMain.map((group) => (
                    <SidebarGroup key={group.title}>
                        <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
                        <SidebarMenu>
                            {group.items.map((item) => {
                                const isActive = activeView === item.url;
                                return (
                                    <SidebarMenuItem key={item.title}>
                                        <SidebarMenuButton
                                            isActive={isActive}
                                            onClick={() => onViewChange(item.url)}
                                            tooltip={item.title}
                                            className={cn(isActive && "text-sidebar-primary-foreground font-medium")}
                                        >
                                            {item.icon && <item.icon />}
                                            <span>{item.title}</span>
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
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <SidebarMenuButton
                                    size="lg"
                                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                                >
                                    <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                                        {selectedLocation?.logoUrl ? (
                                            <img src={selectedLocation.logoUrl} alt={selectedLocation.name} className="size-8 rounded-lg object-cover" />
                                        ) : (
                                            <MapPin className="size-4" />
                                        )}
                                    </div>
                                    <div className="grid flex-1 text-left text-sm leading-tight">
                                        <span className="truncate font-semibold">
                                            {selectedLocation ? selectedLocation.name : "Select Location"}
                                        </span>
                                        <span className="truncate text-xs">
                                            {selectedLocation?.address || "No location selected"}
                                        </span>
                                    </div>
                                    <ChevronsUpDown className="ml-auto" />
                                </SidebarMenuButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                                align="start"
                                side="bottom"
                                sideOffset={4}
                            >
                                {locations.length > 0 ? (
                                    locations.map((loc) => (
                                        <DropdownMenuItem
                                            key={loc.id}
                                            onClick={() => onLocationChange(loc)}
                                            className="gap-2 p-2"
                                        >
                                            <div className="flex size-6 items-center justify-center rounded-sm border">
                                                {loc.logoUrl ? (
                                                    <img src={loc.logoUrl} alt={loc.name} className="size-6 rounded-sm object-cover" />
                                                ) : (
                                                    <MapPin className="size-4 shrink-0" />
                                                )}
                                            </div>
                                            {loc.name}
                                        </DropdownMenuItem>
                                    ))
                                ) : (
                                    <DropdownMenuItem disabled>No locations found</DropdownMenuItem>
                                )}
                                <SidebarSeparator />
                                <DropdownMenuItem className="gap-2 p-2" onClick={onCreateLocation}>
                                    <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                                        <Sparkles className="size-4" />
                                    </div>
                                    <div className="font-medium text-muted-foreground">Add new location</div>
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
