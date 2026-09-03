import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import * as React from "react"
import { ChefSidebar } from "@/components/chef/ChefSidebar"
import { Separator } from "@/components/ui/separator"
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { useFirebaseAuth } from "@/hooks/use-auth"
import { useChefSidebarHiddenItems } from "@/hooks/use-chef-sidebar-hidden-items"
import { Command, Headphones } from "lucide-react"
import ChefNotificationCenter from "@/components/chef/ChefNotificationCenter"
import { CommandMenu } from "@/components/command-menu"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"

interface ChefDashboardLayoutProps {
    children: React.ReactNode
    activeView: string
    onViewChange: (view: string) => void
    messageBadgeCount?: number
    breadcrumbs?: Array<{ label: string; href?: string; onClick?: () => void }>
    hiddenItems?: string[]
}

// View label translation keys for breadcrumb generation
const viewLabelKeys: Record<string, string> = {
    overview: "shellOverview",
    applications: "shellMyApplication",
    "kitchen-applications": "shellMyKitchens",
    bookings: "shellMyBookings",
    training: "shellTraining",
    messages: "shellMessages",
    discover: "shellDiscoverKitchens",
    "discover-kitchens": "shellDiscoverKitchens",
    viewings: "shellKitchenTours",
    profile: "shellProfile",
    support: "shellSupport",
    feedback: "shellFeedback",
    "damage-claims": "shellDamageClaims",
    "seller-revenue": "shellMyEarnings",
    "my-account": "shellLinkedAccounts",
    transactions: "shellTransactions",
    "issues-refunds": "shellResolutionCenter",
}

export default function ChefDashboardLayout({
    children,
    activeView,
    onViewChange,
    messageBadgeCount = 0,
    breadcrumbs,
    hiddenItems = [],
}: ChefDashboardLayoutProps) {
    const { logout } = useFirebaseAuth()
    const { t } = useTranslation("chef")
    const tr = t as unknown as TFunction
    const [isCommandOpen, setIsCommandOpen] = React.useState(false)
    const autoHiddenItems = useChefSidebarHiddenItems()
    const sidebarHiddenItems = React.useMemo(
        () => Array.from(new Set([...autoHiddenItems, ...hiddenItems])),
        [autoHiddenItems, hiddenItems]
    )

    // Generate breadcrumbs based on active view if not provided
    const displayBreadcrumbs = breadcrumbs || [
        { label: t("shellDashboard"), href: "#" },
        { label: viewLabelKeys[activeView] ? tr(viewLabelKeys[activeView] as never) : activeView },
    ]

    return (
        <SidebarProvider>
            <ChefSidebar
                activeView={activeView}
                onViewChange={onViewChange}
                messageBadgeCount={messageBadgeCount}
                hiddenItems={sidebarHiddenItems}
            />
            <SidebarInset className="min-w-0 overflow-x-hidden">
                <header className="flex h-16 shrink-0 items-center justify-between gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <SidebarTrigger className="-ml-1 shrink-0" />
                        <Separator orientation="vertical" className="mr-2 h-4 shrink-0" />
                        <Breadcrumb className="min-w-0">
                            <BreadcrumbList className="flex-wrap">
                                {displayBreadcrumbs.map((crumb, index) => (
                                    <React.Fragment key={index}>
                                        <BreadcrumbItem className="hidden md:block min-w-0">
                                            {crumb.href || crumb.onClick ? (
                                                <BreadcrumbLink
                                                    href="#"
                                                    className="truncate"
                                                    onClick={(e) => {
                                                        e.preventDefault()
                                                        if (crumb.onClick) {
                                                            crumb.onClick()
                                                        } else {
                                                            onViewChange("overview")
                                                        }
                                                    }}
                                                >
                                                    {crumb.label}
                                                </BreadcrumbLink>
                                            ) : (
                                                <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                                            )}
                                        </BreadcrumbItem>
                                        {index < displayBreadcrumbs.length - 1 && (
                                            <BreadcrumbSeparator className="hidden md:block" />
                                        )}
                                    </React.Fragment>
                                ))}
                            </BreadcrumbList>
                        </Breadcrumb>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-4">
                        <Button
                            variant="outline"
                            className="relative h-9 w-9 sm:w-full justify-center sm:justify-start rounded-[0.5rem] bg-background text-sm font-normal text-muted-foreground shadow-none sm:pr-12 md:w-40 lg:w-64"
                            onClick={() => setIsCommandOpen(true)}
                        >
                            <span className="hidden sm:inline-flex">{t("shellSearch")}</span>
                            <Command className="h-4 w-4 sm:hidden" />
                            <kbd className="pointer-events-none absolute right-[0.3rem] top-[0.3rem] hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
                                <span className="text-xs">⌘</span>K
                            </kbd>
                        </Button>

                        <button
                            type="button"
                            onClick={() => onViewChange("support")}
                            aria-label={t("shellOpenSupportCenter")}
                            aria-current={activeView === "support" ? "page" : undefined}
                            title={t("shellSupport")}
                            className={cn(
                                "inline-flex items-center gap-2 h-9 rounded-full px-2.5 sm:px-3 border text-sm font-medium tracking-tight transition-colors",
                                activeView === "support"
                                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                    : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                            )}
                        >
                            <Headphones className="h-4 w-4" />
                            <span className="hidden sm:inline">{t("shellSupport")}</span>
                        </button>

                        <ChefNotificationCenter />
                    </div>
                </header>
                <main className="flex-1 min-w-0 p-4 md:p-6 lg:p-8 bg-muted/30 overflow-x-hidden">
                    <div className="mx-auto max-w-7xl w-full min-w-0 animate-fade-in space-y-6">
                        {children}
                    </div>
                </main>
            </SidebarInset>
            <CommandMenu
                open={isCommandOpen}
                onOpenChange={setIsCommandOpen}
                onViewChange={onViewChange}
                onLogout={logout}
                portalType="chef"
                hiddenItems={sidebarHiddenItems}
            />
        </SidebarProvider>
    )
}
