import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import * as React from "react"
import { Separator } from "@/components/ui/separator"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import AnimatedBackgroundOrbs from "@/components/ui/AnimatedBackgroundOrbs"
import { useLocation } from "wouter"
import { AppSidebar } from "@/components/app-sidebar"
import { useTranslation } from "react-i18next"
import { useManagerDashboard } from "@/hooks/use-manager-dashboard"

interface ManagerBookingLayoutProps {
    children: React.ReactNode
    breadcrumbs?: Array<{ label: string; href?: string; onClick?: () => void }>
    /** Location of the booking currently being viewed — preselects sidebar location */
    bookingLocationId?: number | null
}

export default function ManagerBookingLayout({
    children,
    breadcrumbs,
    bookingLocationId = null,
}: ManagerBookingLayoutProps) {
    const { t } = useTranslation("manager")
    const [, navigate] = useLocation()
    const displayBreadcrumbs = breadcrumbs ?? []
    const { locations } = useManagerDashboard()

    const selectedLocation = React.useMemo(() => {
        if (bookingLocationId == null || locations.length === 0) return null
        return locations.find((loc) => Number(loc.id) === Number(bookingLocationId)) ?? null
    }, [bookingLocationId, locations])

    const handleViewChange = (view: string) => {
        navigate(`/manager/dashboard?view=${view}`, { replace: true })
    }

    const handleLocationChange = (loc: { id: number; name: string } | null) => {
        if (!loc) {
            navigate("/manager/dashboard")
            return
        }
        navigate(`/manager/dashboard?view=bookings&locationId=${loc.id}`)
    }

    return (
        <SidebarProvider>
            <AppSidebar
                activeView="bookings"
                onViewChange={handleViewChange}
                locations={locations}
                selectedLocation={selectedLocation}
                onLocationChange={handleLocationChange}
            />
            {/*
              Same scroll shell as DashboardLayout: viewport-height inset, header
              shrink-0, `<main>` is the only vertical scroller. Without `h-svh
              overflow-hidden`, the inset grows with content, the WINDOW scrolls,
              and sticky header rides away with the page.
            */}
            <SidebarInset className="min-w-0 h-svh overflow-hidden">
                <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 min-w-0">
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
                                                    onClick={(e: React.MouseEvent) => {
                                                        e.preventDefault()
                                                        if (crumb.onClick) {
                                                            crumb.onClick()
                                                        } else if (crumb.href) {
                                                            navigate(crumb.href)
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
                </header>
                <main className="relative flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden bg-muted/10 p-4 md:p-6 lg:p-8">
                    <AnimatedBackgroundOrbs variant="both" intensity="subtle" />
                    <div className="relative z-10 mx-auto w-full max-w-7xl min-w-0 animate-fade-in space-y-6">
                        {children}
                    </div>
                </main>
            </SidebarInset>
        </SidebarProvider>
    )
}
