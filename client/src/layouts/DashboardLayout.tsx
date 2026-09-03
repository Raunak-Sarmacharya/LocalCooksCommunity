import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import * as React from "react";
import { AppSidebar } from "@/components/app-sidebar"
import { Separator } from "@/components/ui/separator"
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import AnimatedBackgroundOrbs from "@/components/ui/AnimatedBackgroundOrbs";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { CommandMenu } from "@/components/command-menu";
import { Button } from "@/components/ui/button";
import NotificationCenter from "@/components/manager/NotificationCenter";
import { useTranslation } from "react-i18next";

interface DashboardLayoutProps {
    children: React.ReactNode;
    activeView: string;
    onViewChange: (view: string) => void;
    locations: Array<any>;
    selectedLocation: any;
    onLocationChange: (location: any) => void;
    onCreateLocation?: () => void;
    breadcrumbs?: Array<{ label: string; href?: string }>;
}

export default function DashboardLayout({
    children,
    activeView,
    onViewChange,
    locations,
    selectedLocation,
    onLocationChange,
    onCreateLocation,
    breadcrumbs
}: DashboardLayoutProps) {
    const { t } = useTranslation("manager");
    const displayBreadcrumbs = breadcrumbs ?? [{ label: t("shellDashboard") }];

    const [isCommandOpen, setIsCommandOpen] = React.useState(false);

    const { logout } = useFirebaseAuth();

    return (
        <SidebarProvider>
            <AppSidebar
                activeView={activeView}
                onViewChange={onViewChange}
                locations={locations}
                selectedLocation={selectedLocation}
                onLocationChange={onLocationChange}
                onCreateLocation={onCreateLocation}
            />
            <SidebarInset className="min-w-0 overflow-x-hidden">
                <header className="flex h-16 shrink-0 items-center justify-between gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <SidebarTrigger className="-ml-1 shrink-0" />
                        <Separator orientation="vertical" className="mr-2 h-4 shrink-0" />
                        <Breadcrumb className="min-w-0">
                            <BreadcrumbList className="flex-wrap">
                                {displayBreadcrumbs.map((crumb, index) => (
                                    <div key={index} className="flex items-center gap-2 min-w-0">
                                        <BreadcrumbItem className="hidden md:block min-w-0">
                                            {crumb.href ? (
                                                <BreadcrumbLink href="#" className="truncate" onClick={(e) => { e.preventDefault(); /* handle click */ }}>
                                                    {crumb.label}
                                                </BreadcrumbLink>
                                            ) : (
                                                <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                                            )}
                                        </BreadcrumbItem>
                                        {index < displayBreadcrumbs.length - 1 && (
                                            <BreadcrumbSeparator className="hidden md:block" />
                                        )}
                                    </div>
                                ))}
                            </BreadcrumbList>
                        </Breadcrumb>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
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
                        
                        {/* Notification Center */}
                        <NotificationCenter locationId={selectedLocation?.id} />

                    </div>
                </header>
                <main className="flex-1 min-w-0 p-4 md:p-6 lg:p-8 bg-muted/10 relative overflow-x-hidden overflow-y-auto">
                    <AnimatedBackgroundOrbs variant="both" intensity="subtle" />
                    <div className="mx-auto max-w-7xl w-full min-w-0 animate-fade-in space-y-6 relative z-10">
                        {children}
                    </div>
                </main>
            </SidebarInset>
            <CommandMenu
                open={isCommandOpen}
                onOpenChange={setIsCommandOpen}
                onViewChange={onViewChange}
                onLogout={logout}
                portalType="manager"
            />
        </SidebarProvider>
    )
}
