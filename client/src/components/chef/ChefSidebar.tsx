"use client"

import * as React from "react"
import {
    LayoutDashboard,
    FileText,
    Building2,
    Calendar,
    BookOpen,
    MessageCircle,
    Search,
    LifeBuoy,
    Send,
    ChefHat,
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
    SidebarMenuBadge,
    SidebarRail,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import Logo from "@/components/ui/logo"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useFirebaseAuth } from "@/hooks/use-auth"

// Navigation structure for chef portal - organized by purpose
const navGroups = [
    {
        title: "Dashboard",
        items: [
            {
                id: "overview",
                label: "Overview",
                icon: LayoutDashboard,
            },
        ],
    },
    {
        title: "Sell on LocalCooks",
        items: [
            {
                id: "applications",
                label: "My Application",
                icon: FileText,
            },
            {
                id: "training",
                label: "Training",
                icon: BookOpen,
            },
        ],
    },
    {
        title: "Kitchen Access",
        items: [
            {
                id: "kitchen-applications",
                label: "My Kitchens",
                icon: Building2,
            },
            {
                id: "discover",
                label: "Discover Kitchens",
                icon: Search,
                path: "/compare-kitchens",
            },
            {
                id: "bookings",
                label: "My Bookings",
                icon: Calendar,
            },
        ],
    },
    {
        title: "Communication",
        items: [
            {
                id: "messages",
                label: "Messages",
                icon: MessageCircle,
                badge: 0,
            },
        ],
    },
]

const navSecondary = [
    {
        id: "support",
        label: "Support",
        icon: LifeBuoy,
    },
    {
        id: "feedback",
        label: "Feedback",
        icon: Send,
    },
]

interface ChefSidebarProps extends React.ComponentProps<typeof Sidebar> {
    activeView: string
    onViewChange: (view: string) => void
    messageBadgeCount?: number
}

export function ChefSidebar({
    activeView,
    onViewChange,
    messageBadgeCount = 0,
    ...props
}: ChefSidebarProps) {
    const { user } = useFirebaseAuth()

    // Get user initials for avatar fallback
    const getInitials = (name: string | null | undefined) => {
        if (!name) return "CH"
        const parts = name.split(" ")
        if (parts.length >= 2) {
            return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
        }
        return name.slice(0, 2).toUpperCase()
    }

    return (
        <Sidebar collapsible="icon" {...props}>
            {/* Header with Logo */}
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            size="lg"
                            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                        >
                            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                                <Logo variant="white" className="size-5" />
                            </div>
                            <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                                <span className="truncate font-semibold text-[#F51042] font-logo text-lg tracking-tight">
                                    LocalCooks
                                </span>
                                <span className="truncate text-[10px] font-medium text-muted-foreground uppercase tracking-wider leading-none">
                                    for chefs
                                </span>
                            </div>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            {/* Main Navigation Content */}
            <SidebarContent>
                {navGroups.map((group) => (
                    <SidebarGroup key={group.title}>
                        <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
                        <SidebarMenu>
                            {group.items.map((item) => {
                                const isActive = activeView === item.id
                                const badge = item.id === "messages" ? messageBadgeCount : undefined

                                return (
                                    <SidebarMenuItem key={item.id}>
                                        <SidebarMenuButton
                                            isActive={isActive}
                                            onClick={() => {
                                                if (item.path) {
                                                    // External navigation (like discover kitchens)
                                                    window.location.href = item.path
                                                } else {
                                                    onViewChange(item.id)
                                                }
                                            }}
                                            tooltip={item.label}
                                            className={cn(
                                                isActive && "text-sidebar-primary-foreground font-medium"
                                            )}
                                        >
                                            {item.icon && <item.icon />}
                                            <span>{item.label}</span>
                                            {badge !== undefined && badge > 0 && (
                                                <SidebarMenuBadge className="bg-destructive text-destructive-foreground">
                                                    {badge}
                                                </SidebarMenuBadge>
                                            )}
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                )
                            })}
                        </SidebarMenu>
                    </SidebarGroup>
                ))}

                {/* Secondary Navigation */}
                <SidebarGroup className="mt-auto">
                    <SidebarGroupLabel>Help</SidebarGroupLabel>
                    <SidebarMenu>
                        {navSecondary.map((item) => (
                            <SidebarMenuItem key={item.id}>
                                <SidebarMenuButton
                                    onClick={() => onViewChange(item.id)}
                                    tooltip={item.label}
                                >
                                    {item.icon && <item.icon />}
                                    <span>{item.label}</span>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        ))}
                    </SidebarMenu>
                </SidebarGroup>
            </SidebarContent>

            {/* Footer with User Avatar */}
            <SidebarFooter>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            size="lg"
                            onClick={() => onViewChange("profile")}
                            tooltip="Profile"
                            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                        >
                            <Avatar className="h-8 w-8 rounded-lg">
                                <AvatarImage
                                    src={user?.photoURL || ""}
                                    alt={user?.displayName || "Chef"}
                                />
                                <AvatarFallback className="rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                                    {getInitials(user?.displayName)}
                                </AvatarFallback>
                            </Avatar>
                            <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                                <span className="truncate font-semibold">
                                    {user?.displayName || "Chef"}
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                    {user?.email || "chef@localcooks.ca"}
                                </span>
                            </div>
                            <ChefHat className="ml-auto size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>

            <SidebarRail />
        </Sidebar>
    )
}
