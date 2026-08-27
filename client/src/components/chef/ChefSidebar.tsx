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
    AlertTriangle,
    ChefHat,
    DollarSign,
    Store,
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
    useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import Logo from "@/components/ui/logo"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useFirebaseAuth } from "@/hooks/use-auth"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher"

function sectionHasHeader(title: string | undefined, itemCount: number) {
    return Boolean(title) && itemCount > 1
}

// Type definition for navigation items
interface NavItem {
    id: string
    labelKey: string
    icon: React.ComponentType<{ className?: string }>
    path?: string
    badge?: number
}

interface NavSection {
    titleKey?: string
    items: NavItem[]
}

const navSections: NavSection[] = [
    {
        items: [
            { id: "overview", labelKey: "shellOverview", icon: LayoutDashboard },
            { id: "applications", labelKey: "shellMyApplication", icon: FileText },
            { id: "training", labelKey: "shellTraining", icon: BookOpen },
        ],
    },
    {
        titleKey: "shellSelling",
        items: [
            { id: "seller-revenue", labelKey: "shellMyEarnings", icon: DollarSign },
            { id: "my-account", labelKey: "shellLinkedAccounts", icon: Store },
        ],
    },
    {
        titleKey: "shellKitchens",
        items: [
            { id: "kitchen-applications", labelKey: "shellMyKitchens", icon: Building2 },
            { id: "discover-kitchens", labelKey: "shellDiscoverKitchens", icon: Search },
            { id: "bookings", labelKey: "shellMyBookings", icon: Calendar },
        ],
    },
    {
        titleKey: "shellInbox",
        items: [
            { id: "messages", labelKey: "shellMessages", icon: MessageCircle, badge: 0 },
            { id: "issues-refunds", labelKey: "shellResolutionCenter", icon: AlertTriangle },
        ],
    },
]

interface ChefSidebarProps extends React.ComponentProps<typeof Sidebar> {
    activeView: string
    onViewChange: (view: string) => void
    messageBadgeCount?: number
    hiddenItems?: string[]
}

export function ChefSidebar({
    activeView,
    onViewChange,
    messageBadgeCount = 0,
    hiddenItems = [],
    ...props
}: ChefSidebarProps) {
    const { user } = useFirebaseAuth()
    const { t } = useTranslation("chef")
    const tr = t as unknown as TFunction
    const { isMobile, setOpenMobile } = useSidebar()

    // Get user initials for avatar fallback
    const getInitials = (name: string | null | undefined) => {
        if (!name) return "CH"
        const parts = name.split(" ")
        if (parts.length >= 2) {
            return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
        }
        return name.slice(0, 2).toUpperCase()
    }

    const handleViewChange = (view: string) => {
        onViewChange(view)
        if (isMobile) {
            setOpenMobile(false)
        }
    }

    const { ungroupedItems, groupedSections } = React.useMemo(() => {
        const prepared = navSections
            .map((section) => ({
                ...section,
                visibleItems: section.items.filter((item) => !hiddenItems.includes(item.id)),
            }))
            .filter((section) => section.visibleItems.length > 0)

        return {
            ungroupedItems: prepared
                .filter((section) => !sectionHasHeader(section.titleKey, section.visibleItems.length))
                .flatMap((section) => section.visibleItems),
            groupedSections: prepared.filter((section) =>
                sectionHasHeader(section.titleKey, section.visibleItems.length)
            ),
        }
    }, [hiddenItems])

    const renderNavItem = (item: NavItem) => {
        const isActive = activeView === item.id
        const badge = item.id === "messages" ? messageBadgeCount : undefined
        const label = tr(item.labelKey as never)

        return (
            <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                    isActive={isActive}
                    onClick={() => {
                        if (item.path) {
                            if (isMobile) {
                                setOpenMobile(false)
                            }
                            window.location.href = item.path
                        } else {
                            handleViewChange(item.id)
                        }
                    }}
                    tooltip={label}
                    className={cn(
                        isActive && "text-sidebar-primary-foreground font-medium"
                    )}
                >
                    {item.icon && <item.icon />}
                    <span>{label}</span>
                    {badge !== undefined && badge > 0 && (
                        <SidebarMenuBadge className="bg-destructive text-destructive-foreground">
                            {badge}
                        </SidebarMenuBadge>
                    )}
                </SidebarMenuButton>
            </SidebarMenuItem>
        )
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
                                <span className="truncate font-semibold text-primary font-logo text-lg tracking-tight">
                                    LocalCooks
                                </span>
                                <span className="truncate text-xs font-medium text-muted-foreground uppercase tracking-wider leading-none">
                                    {t("shellForChefs")}
                                </span>
                            </div>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            {/* Main Navigation Content */}
            <SidebarContent className="gap-0">
                {ungroupedItems.length > 0 && (
                    <SidebarGroup className="px-2 py-1">
                        <SidebarMenu className="gap-0.5">
                            {ungroupedItems.map(renderNavItem)}
                        </SidebarMenu>
                    </SidebarGroup>
                )}
                {groupedSections.map((section) => (
                    <SidebarGroup key={section.titleKey} className="px-2 py-3">
                        <SidebarGroupLabel className="h-7 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {tr(section.titleKey as never)}
                        </SidebarGroupLabel>
                        <SidebarMenu className="gap-0.5">
                            {section.visibleItems.map(renderNavItem)}
                        </SidebarMenu>
                    </SidebarGroup>
                ))}
            </SidebarContent>

            {/* Footer with User Avatar */}
            <SidebarFooter>
                <SidebarMenu>
                    <SidebarMenuItem className="px-2 pb-2 group-data-[collapsible=icon]:hidden">
                        <LanguageSwitcher className="w-full justify-start h-9 border-border bg-background shadow-sm" />
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            size="lg"
                            onClick={() => handleViewChange("profile")}
                            tooltip={t("shellProfile")}
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
