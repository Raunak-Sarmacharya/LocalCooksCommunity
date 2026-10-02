import * as React from "react"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AppSidebar } from "@/components/app-sidebar"
import NotificationCenter from "@/components/manager/NotificationCenter"
import { CommandMenu } from "@/components/command-menu"
import { useFirebaseAuth } from "@/hooks/use-auth"
import { useManagerDashboard } from "@/hooks/use-manager-dashboard"
import { useLocation, useSearch } from "wouter"
import { useTranslation } from "react-i18next"
import { Icon } from "@iconify/react"
import { cn } from "@/lib/utils"
import { mt } from "@/i18n/manager"
import { SCROLL_AREA_FLUID_CONTENT } from "@/lib/scroll-area-classes"
import { Search, UtensilsCrossed } from "@/components/ui/manager-icons"
import type { ManagerBreadcrumb } from "@/lib/manager-kitchens-navigation"
import type { ManagerGettingStartedProps } from "@/components/manager/ManagerGettingStarted"

/**
 * The scope a page can read from the shell.
 *
 * Exported because the render-prop form of `children` hands this to the page, and the pages that
 * migrated off `ManagerPageLayout` destructure exactly these four fields.
 */
export interface ManagerShellScope {
    selectedLocationId: number | null
    selectedKitchenId: number | null
    /**
     * The selected location's hourly booking ceiling, or null when no location is selected.
     *
     * Exposed because it is a policy the KITCHEN pricing page has to reason about: a day rate
     * below `dailyBookingLimit × hourlyRate` is cheaper than the longest hourly booking, so the
     * day rate stops being a discount and starts undercutting the hourly one.
     */
    dailyBookingLimit: number | null
    isLoading: boolean
}

interface ManagerShellProps {
    /** The nav key to highlight. Also names the mobile header when `title` is absent. */
    activeView: string
    /**
     * Where a sidebar click goes. Defaults to `/manager/dashboard?view=<view>` — the shape every
     * standalone manager route wants, and the reason `ManagerBookingLayout` existed separately.
     */
    onViewChange?: (view: string) => void
    title?: string
    description?: string
    breadcrumbs?: ManagerBreadcrumb[]
    /**
     * Render the location (+ optional kitchen) scope picker above the content.
     *
     * The dashboard does NOT want this — it owns its own picker and its own `?view=`/`?kit=`
     * handling — so it is off by default and only the migrated standalone routes turn it on.
     */
    showScopePicker?: boolean
    showKitchenSelector?: boolean
    showBookings?: boolean
    showStorageBookings?: boolean
    showApplications?: boolean
    showRevenue?: boolean
    /** Controlled scope. Only read when `showScopePicker` is false. */
    locations?: Array<{ id: number; name: string }>
    selectedLocation?: { id: number; name: string } | null
    onLocationChange?: (location: { id: number; name: string } | null) => void
    onCreateLocation?: () => void
    managerGettingStarted?: ManagerGettingStartedProps
    children: React.ReactNode | ((scope: ManagerShellScope) => React.ReactNode)
}

/**
 * ManagerShell — the ONE shell for every manager surface.
 *
 * Before this existed the manager app ran four shells (`DashboardLayout`, `ManagerBookingLayout`,
 * `ManagerPageLayout`, and two routes on a bare `ManagerHeader`), each with its own header, its own
 * idea of what "mobile" means, and its own nav. The bare-header routes mounted no sidebar at all,
 * so on a phone there was no way off the page.
 *
 * The structure is deliberately identical to `ChefDashboardLayout`: viewport-height inset, a
 * `shrink-0` header, and `<main>` as the only vertical scroller. `h-svh` (not `h-screen`) is what
 * keeps the header put on a mobile browser whose address bar hides on scroll.
 */
export function ManagerShell({
    activeView,
    onViewChange,
    title,
    description,
    breadcrumbs,
    showScopePicker = false,
    showKitchenSelector = true,
    showBookings = true,
    showStorageBookings = true,
    showApplications = true,
    showRevenue = true,
    locations: controlledLocations,
    selectedLocation: controlledSelectedLocation,
    onLocationChange: controlledOnLocationChange,
    onCreateLocation,
    managerGettingStarted,
    children,
}: ManagerShellProps) {
    const { t } = useTranslation("manager")
    const [locationPath, navigate] = useLocation()
    const searchString = useSearch()
    const { logout } = useFirebaseAuth()

    const [isCommandOpen, setIsCommandOpen] = React.useState(false)

    const {
        locations: dashboardLocations,
        isLoadingLocations,
        kitchens,
        isLoadingKitchens,
    } = useManagerDashboard()

    /**
     * The shell's own scope state, mirrored into `?loc=` / `?kit=`.
     *
     * Lifted from `ManagerPageLayout`, which was the only place a manager could pick a location or
     * kitchen on these routes. Kept as shell state rather than page state so the four migrated
     * routes stop each rendering a second, divergent copy of the same picker.
     */
    const [scopeLocationId, setScopeLocationId] = React.useState<number | null>(null)
    const [scopeKitchenId, setScopeKitchenId] = React.useState<number | null>(null)

    const params = React.useMemo(() => new URLSearchParams(searchString), [searchString])
    const urlLocationId = Number.parseInt(params.get("loc") ?? "", 10) || null
    const urlKitchenId = Number.parseInt(params.get("kit") ?? "", 10) || null

    // URL -> state. Guarded on `showScopePicker` so the dashboard's own `?view=`/`?kit=` handling
    // is never second-guessed by the shell.
    React.useEffect(() => {
        if (!showScopePicker) return
        if (urlLocationId !== scopeLocationId) setScopeLocationId(urlLocationId)
    }, [showScopePicker, urlLocationId, scopeLocationId])

    React.useEffect(() => {
        if (!showScopePicker) return
        if (urlKitchenId !== scopeKitchenId) setScopeKitchenId(urlKitchenId)
    }, [showScopePicker, urlKitchenId, scopeKitchenId])

    /**
     * Select a location as soon as one exists — the FIRST one, not only when there is exactly one.
     *
     * The `=== 1` this replaces left a manager with two or more locations unselected until they
     * chose, and the dashboard had the identical condition and the identical problem. What matters
     * is what `null` MEANS afterwards: an unselected location is no longer "has not chosen yet" —
     * it is "has none". That is the only reading the pages under this shell can act on.
     */
    React.useEffect(() => {
        if (!showScopePicker) return
        if (!isLoadingLocations && dashboardLocations.length > 0 && !scopeLocationId) {
            setScopeLocationId(dashboardLocations[0].id)
        }
    }, [showScopePicker, isLoadingLocations, dashboardLocations, scopeLocationId])

    /**
     * Select a kitchen for the same reason, and this one was missing entirely.
     *
     * Without it `scopeKitchenId` stayed null for a manager who HAD a kitchen but had not picked
     * one, so every page fell through to its own "select a location and kitchen" copy, naming an
     * action the shell could not perform. A URL `?kit=` still wins: this only runs while nothing
     * is selected.
     */
    React.useEffect(() => {
        if (!showScopePicker) return
        if (scopeKitchenId) return
        const first = kitchens.find((kitchen) => kitchen.locationId === scopeLocationId)
        if (first) setScopeKitchenId(first.id)
    }, [showScopePicker, kitchens, scopeLocationId, scopeKitchenId])

    // State -> URL. `history.replaceState` rather than a route change so a picker selection does
    // not push a history entry the back button has to walk through.
    React.useEffect(() => {
        if (!showScopePicker) return
        const next = new URLSearchParams(searchString)
        let updated = false

        if (scopeLocationId && scopeLocationId !== urlLocationId) {
            next.set("loc", String(scopeLocationId))
            updated = true
        } else if (!scopeLocationId && next.has("loc")) {
            next.delete("loc")
            updated = true
        }

        if (scopeKitchenId && scopeKitchenId !== urlKitchenId) {
            next.set("kit", String(scopeKitchenId))
            updated = true
        } else if (!scopeKitchenId && next.has("kit")) {
            next.delete("kit")
            updated = true
        }

        if (updated) {
            const nextSearch = next.toString()
            window.history.replaceState(null, "", locationPath + (nextSearch ? `?${nextSearch}` : ""))
        }
    }, [showScopePicker, scopeLocationId, scopeKitchenId, searchString, urlLocationId, urlKitchenId, locationPath])

    const handleViewChange = React.useCallback(
        (view: string) => {
            if (onViewChange) {
                onViewChange(view)
                return
            }
            navigate(`/manager/dashboard?view=${view}`, { replace: true })
        },
        [navigate, onViewChange]
    )

    const handleScopeLocationChange = (value: string) => {
        setScopeLocationId(Number.parseInt(value, 10))
        setScopeKitchenId(null)
    }

    const handleScopeKitchenChange = (value: string) => {
        setScopeKitchenId(Number.parseInt(value, 10))
    }

    const availableKitchens = kitchens.filter((kitchen) => kitchen.locationId === scopeLocationId)

    const displayBreadcrumbs = breadcrumbs ?? []

    /**
     * The location the header's notification centre scopes to.
     *
     * The shell's own picker wins when it is on screen; otherwise the page's controlled value, which
     * is what the dashboard passes down.
     */
    const activeLocationId = showScopePicker ? scopeLocationId : controlledSelectedLocation?.id ?? null

    const dailyBookingLimit =
        dashboardLocations.find((location) => location.id === activeLocationId)?.defaultDailyBookingLimit ?? null

    const scope: ManagerShellScope = {
        selectedLocationId: activeLocationId,
        selectedKitchenId: showScopePicker ? scopeKitchenId : null,
        dailyBookingLimit,
        isLoading: isLoadingLocations || isLoadingKitchens,
    }

    const mobileTitle = title || displayBreadcrumbs.at(-1)?.label || t("navDashboard")

    return (
        <SidebarProvider className="[--radius:0.75rem]">
            <AppSidebar
                activeView={activeView}
                onViewChange={handleViewChange}
                locations={controlledLocations ?? dashboardLocations}
                selectedLocation={controlledSelectedLocation ?? null}
                onLocationChange={controlledOnLocationChange ?? (() => { })}
                onCreateLocation={onCreateLocation}
                breadcrumbs={displayBreadcrumbs}
                managerGettingStarted={managerGettingStarted}
                showBookings={showBookings}
                showStorageBookings={showStorageBookings}
                showApplications={showApplications}
                showRevenue={showRevenue}
            />
            {/*
              Viewport-height inset, `shrink-0` header, `<main>` is the only vertical scroller.
              Without `h-svh overflow-hidden` the inset grows with content, the WINDOW scrolls, and
              the header rides away with the page.
            */}
            <SidebarInset className="min-w-0 h-svh overflow-hidden">
                <header className="flex h-14 sm:h-16 shrink-0 items-center justify-between gap-2 border-b px-3 sm:px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <SidebarTrigger className="-ml-1 shrink-0" />
                        <Separator orientation="vertical" className="mr-2 h-4 shrink-0 hidden sm:block" />
                        {/*
                          Below `md` the header carries the page name itself. The content block below
                          is `hidden md:block`, so the title is never rendered twice.
                        */}
                        <span className="min-w-0 truncate text-sm font-semibold md:hidden">{mobileTitle}</span>
                        <Breadcrumb className="hidden md:block min-w-0">
                            <BreadcrumbList className="flex-nowrap overflow-hidden">
                                {displayBreadcrumbs.map((crumb, index) => (
                                    <div key={index} className="flex items-center gap-2 min-w-0">
                                        <BreadcrumbItem className="min-w-0">
                                            {crumb.onClick ? (
                                                <BreadcrumbLink
                                                    href="#"
                                                    className="truncate"
                                                    onClick={(e) => {
                                                        e.preventDefault()
                                                        crumb.onClick?.()
                                                    }}
                                                >
                                                    {crumb.label}
                                                </BreadcrumbLink>
                                            ) : (
                                                <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                                            )}
                                        </BreadcrumbItem>
                                        {index < displayBreadcrumbs.length - 1 && (
                                            <BreadcrumbSeparator className="shrink-0" />
                                        )}
                                    </div>
                                ))}
                            </BreadcrumbList>
                        </Breadcrumb>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 sm:gap-4">
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 shrink-0 rounded-lg text-muted-foreground md:hidden"
                            onClick={() => setIsCommandOpen(true)}
                            aria-label={t("shellSearch")}
                        >
                            <Search className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            className="hidden md:flex relative h-9 justify-start rounded-[0.5rem] bg-background text-sm font-normal text-muted-foreground shadow-none sm:pr-12 md:w-40 lg:w-64 max-w-full"
                            onClick={() => setIsCommandOpen(true)}
                        >
                            <span className="truncate">{t("shellSearch")}</span>
                            <kbd className="pointer-events-none absolute right-[0.3rem] top-[0.3rem] hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
                                <span className="text-xs">⌘</span>K
                            </kbd>
                        </Button>

                        {/* Support — same control as the chef dashboard header, so the two shells read as one product. */}
                        <button
                            type="button"
                            onClick={() => handleViewChange("support")}
                            aria-label={mt("shellOpenSupportCenter")}
                            aria-current={activeView === "support" ? "page" : undefined}
                            title={mt("navSupport")}
                            className={cn(
                                "inline-flex items-center gap-2 h-9 rounded-full px-2.5 sm:px-3 border text-sm font-medium tracking-tight transition-colors",
                                activeView === "support"
                                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                    : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                            )}
                        >
                            <Icon icon="mdi:headphones" className="h-4 w-4" aria-hidden />
                            <span className="hidden sm:inline">{mt("navSupport")}</span>
                        </button>

                        <NotificationCenter
                            locationId={activeLocationId ?? undefined}
                            onViewAll={() => handleViewChange("notifications")}
                        />
                    </div>
                </header>

                {/*
                  Scope picker. A second bar rather than a header slot on purpose: it STACKS on a
                  phone, where two side-by-side selects inside the 56px header would each be about
                  120px wide. `showKitchenSelector` only gates the kitchen half — the location half
                  is always meaningful on the routes that ask for this bar.
                */}
                {showScopePicker && (
                    <div className="shrink-0 border-b bg-muted/30 px-3 py-2.5 sm:px-4">
                        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2.5 sm:flex-row sm:items-end sm:gap-3">
                            <div className="min-w-0 space-y-1 sm:w-[15rem]">
                                <Label
                                    htmlFor="manager-scope-location"
                                    className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                                >
                                    {mt("location")}
                                </Label>
                                {isLoadingLocations ? (
                                    <Skeleton className="h-9 w-full" />
                                ) : (
                                    <Select
                                        value={scopeLocationId ? String(scopeLocationId) : ""}
                                        onValueChange={handleScopeLocationChange}
                                        disabled={dashboardLocations.length === 0}
                                    >
                                        <SelectTrigger id="manager-scope-location" className="h-9 w-full bg-background">
                                            <SelectValue placeholder={mt("selectLocation")} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {dashboardLocations.map((location) => (
                                                <SelectItem key={location.id} value={String(location.id)}>
                                                    {location.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>

                            {showKitchenSelector && (
                                <div
                                    className={cn(
                                        "min-w-0 space-y-1 sm:w-[15rem]",
                                        !scopeLocationId && "pointer-events-none opacity-50"
                                    )}
                                >
                                    <Label
                                        htmlFor="manager-scope-kitchen"
                                        className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                                    >
                                        <UtensilsCrossed className="h-3 w-3" aria-hidden />
                                        {mt("kitchen")}
                                    </Label>
                                    {isLoadingKitchens ? (
                                        <Skeleton className="h-9 w-full" />
                                    ) : availableKitchens.length === 0 && scopeLocationId ? (
                                        <div className="flex h-9 items-center rounded-md border border-destructive/20 bg-destructive/10 px-3 text-xs text-destructive">
                                            {mt("noKitchensFoundHere")}
                                        </div>
                                    ) : (
                                        <Select
                                            value={scopeKitchenId ? String(scopeKitchenId) : ""}
                                            onValueChange={handleScopeKitchenChange}
                                            disabled={!scopeLocationId || availableKitchens.length === 0}
                                        >
                                            <SelectTrigger id="manager-scope-kitchen" className="h-9 w-full bg-background">
                                                <SelectValue
                                                    placeholder={
                                                        scopeLocationId ? mt("selectKitchen") : mt("chooseLocationFirst")
                                                    }
                                                />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {availableKitchens.map((kitchen) => (
                                                    <SelectItem key={kitchen.id} value={String(kitchen.id)}>
                                                        {kitchen.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <ScrollArea className={cn("flex-1 min-h-0 min-w-0 bg-muted/30", SCROLL_AREA_FLUID_CONTENT)}>
                    <main className="min-w-0 p-4 md:p-6 lg:p-8 [&_p]:[text-wrap:pretty]">
                        <div className="mx-auto w-full max-w-7xl min-w-0 animate-fade-in space-y-6">
                            {/*
                              Desktop page header. `hidden md:block` because the header bar above
                              already shows the same name below `md` — rendering both is the
                              duplication the old `ManagerPageLayout` had.
                            */}
                            {(title || description) && (
                                <div className="hidden md:block space-y-1.5 border-b pb-4">
                                    {title && <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>}
                                    {description && <p className="text-muted-foreground">{description}</p>}
                                </div>
                            )}
                            {typeof children === "function" ? children(scope) : children}
                        </div>
                    </main>
                </ScrollArea>
            </SidebarInset>
            <CommandMenu
                open={isCommandOpen}
                onOpenChange={setIsCommandOpen}
                onViewChange={handleViewChange}
                onLogout={logout}
                portalType="manager"
                hiddenItems={[
                    ...(!showBookings ? ["bookings"] : []),
                    ...(!showApplications ? ["applications"] : []),
                    ...(!showRevenue ? ["revenue"] : []),
                ]}
            />
        </SidebarProvider>
    )
}

export default ManagerShell
