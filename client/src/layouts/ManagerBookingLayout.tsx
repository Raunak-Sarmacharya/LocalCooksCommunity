import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import * as React from "react"
import { Separator } from "@/components/ui/separator"
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import AnimatedBackgroundOrbs from "@/components/ui/AnimatedBackgroundOrbs"
import { useLocation } from "wouter"
import { AppSidebar } from "@/components/app-sidebar"
import { useTranslation } from "react-i18next"

interface ManagerBookingLayoutProps {
    children: React.ReactNode
    breadcrumbs?: Array<{ label: string; href?: string; onClick?: () => void }>
}

export default function ManagerBookingLayout({
    children,
    breadcrumbs,
}: ManagerBookingLayoutProps) {
    const { t } = useTranslation("manager")
    const [, navigate] = useLocation()
    const displayBreadcrumbs = breadcrumbs ?? [{ label: t("shellDashboard") }]

    const handleViewChange = (view: string) => {
        navigate(`/manager/dashboard?view=${view}`, { replace: true })
    }

    return (
        <SidebarProvider>
            <AppSidebar
                activeView="bookings"
                onViewChange={handleViewChange}
                locations={[]}
                selectedLocation={null}
                onLocationChange={() => navigate("/manager/dashboard")}
            />
            <SidebarInset>
                <header className="flex h-16 shrink-0 items-center justify-between gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
                    <div className="flex items-center gap-2">
                        <SidebarTrigger className="-ml-1" />
                        <Separator orientation="vertical" className="mr-2 h-4" />
                        <Breadcrumb>
                            <BreadcrumbList>
                                {displayBreadcrumbs.map((crumb, index) => (
                                    <React.Fragment key={index}>
                                        <BreadcrumbItem className="hidden md:block">
                                            {crumb.href || crumb.onClick ? (
                                                <BreadcrumbLink
                                                    href="#"
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
                                                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
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
                <main className="flex-1 p-4 md:p-6 lg:p-8 bg-muted/10 relative overflow-hidden">
                    <AnimatedBackgroundOrbs variant="both" intensity="subtle" />
                    <div className="mx-auto max-w-7xl animate-fade-in space-y-6 relative z-10">
                        {children}
                    </div>
                </main>
            </SidebarInset>
        </SidebarProvider>
    )
}
