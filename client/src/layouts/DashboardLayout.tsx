import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import * as React from "react";
import { AppSidebar } from "@/components/app-sidebar"
import { Separator } from "@/components/ui/separator"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { useFirebaseAuth } from "@/hooks/use-auth";
import { CommandMenu } from "@/components/command-menu";
import { Button } from "@/components/ui/button";
import NotificationCenter from "@/components/manager/NotificationCenter";
import { useTranslation } from "react-i18next";
import type { ManagerBreadcrumb } from "@/lib/manager-kitchens-navigation";
import type { ManagerSetupStep } from "@/hooks/use-onboarding-status";
import { Icon } from "@iconify/react";
import { cn } from "@/lib/utils";
import { mt } from "@/i18n/manager";

interface DashboardLayoutProps {
    children: React.ReactNode;
    activeView: string;
    onViewChange: (view: string) => void;
    locations: Array<any>;
    selectedLocation: any;
    onLocationChange: (location: any) => void;
    onCreateLocation?: () => void;
    breadcrumbs?: ManagerBreadcrumb[];
    managerSetupSteps?: ManagerSetupStep[];
    managerImprovementSteps?: string[];
    onImproveManagerListing?: (task: string) => void;
}

export default function DashboardLayout({
    children,
    activeView,
    onViewChange,
    locations,
    selectedLocation,
    onLocationChange,
    onCreateLocation,
    breadcrumbs,
    managerSetupSteps,
    managerImprovementSteps,
    onImproveManagerListing,
}: DashboardLayoutProps) {
    const { t } = useTranslation("manager");
    const displayBreadcrumbs = breadcrumbs ?? [];

    const [isCommandOpen, setIsCommandOpen] = React.useState(false);

    const { logout } = useFirebaseAuth();

    return (
        <SidebarProvider className="[--radius:0.75rem]">
            <AppSidebar
                activeView={activeView}
                onViewChange={onViewChange}
                locations={locations}
                selectedLocation={selectedLocation}
                onLocationChange={onLocationChange}
                onCreateLocation={onCreateLocation}
                breadcrumbs={displayBreadcrumbs}
                managerSetupSteps={managerSetupSteps}
                managerImprovementSteps={managerImprovementSteps}
                onImproveManagerListing={onImproveManagerListing}
            />
            {/*
              The app frame is viewport-height, and `<main>` below is the scroll container.

              It used to be `min-w-0 overflow-x-hidden` with no height. Two consequences:
              the inset grew with its content so the WINDOW scrolled instead of `<main>`;
              and `overflow-x-hidden` forces the computed `overflow-y` to `auto`, which
              makes this element a scroll container — so the header's `sticky top-0` was
              resolving against a box that never scrolls. The header therefore scrolled
              away with the page.

              `h-svh` matches the fixed `h-svh` sidebar this sits next to, and makes the
              header a plain `shrink-0` flex child that cannot scroll at all.
            */}
            <SidebarInset className="min-w-0 h-svh overflow-hidden">
                {/*
                  Constant height. It used to shrink to `h-12` when the sidebar collapsed
                  (`group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12`) with a
                  `transition-[width,height]` animating it. Collapsing the nav is a change
                  to the SIDE of the screen; it should not resize the top bar or reflow the
                  controls in it — the search field and the Support / notifications buttons
                  all got vertically squeezed for no reason. `sticky` is kept as a fallback
                  in case the shell's height constraint above is ever relaxed.
                */}
                <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <SidebarTrigger className="-ml-1 shrink-0" />
                        <Separator orientation="vertical" className="mr-2 h-4 shrink-0" />
                        <Breadcrumb className="min-w-0">
                            <BreadcrumbList className="flex-wrap">
                                {displayBreadcrumbs.map((crumb, index) => (
                                    <div key={index} className="flex items-center gap-2 min-w-0">
                                        <BreadcrumbItem className="hidden md:block min-w-0">
                                            {crumb.onClick ? (
                                                <BreadcrumbLink href="#" className="truncate" onClick={(e) => { e.preventDefault(); crumb.onClick?.(); }}>
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
                        
                        {/* Support — same control as the chef dashboard header, so
                            the two shells read as one product. */}
                        <button
                            type="button"
                            onClick={() => onViewChange("support")}
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

                        {/* Notification Center */}
                        <NotificationCenter
                            locationId={selectedLocation?.id}
                            onViewAll={() => onViewChange("notifications")}
                        />

                    </div>
                </header>
                <main className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden bg-muted/30 p-4 md:p-6 lg:p-8">
                    <div className="mx-auto w-full max-w-7xl min-w-0 animate-fade-in space-y-6">
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
