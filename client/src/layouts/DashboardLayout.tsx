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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { LogOut, User as UserIcon, ChevronDown, Command } from "lucide-react";
import { CommandMenu } from "@/components/command-menu";
import { Button } from "@/components/ui/button";
import NotificationCenter from "@/components/manager/NotificationCenter";

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
    breadcrumbs = [{ label: "Dashboard" }]
}: DashboardLayoutProps) {
    // Generate breadcrumbs based on active view if not provided
    const displayBreadcrumbs = breadcrumbs.length > 0 ? breadcrumbs : [
        { label: "Dashboard", href: "#" },
        { label: activeView.charAt(0).toUpperCase() + activeView.slice(1).replace("-", " ") }
    ];

    const [isCommandOpen, setIsCommandOpen] = React.useState(false);

    const { user, logout } = useFirebaseAuth();

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
            <SidebarInset>
                <header className="flex h-16 shrink-0 items-center justify-between gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
                    <div className="flex items-center gap-2">
                        <SidebarTrigger className="-ml-1" />
                        <Separator orientation="vertical" className="mr-2 h-4" />
                        <Breadcrumb>
                            <BreadcrumbList>
                                {displayBreadcrumbs.map((crumb, index) => (
                                    <div key={index} className="flex items-center gap-2">
                                        <BreadcrumbItem className="hidden md:block">
                                            {crumb.href ? (
                                                <BreadcrumbLink href="#" onClick={(e) => { e.preventDefault(); /* handle click */ }}>
                                                    {crumb.label}
                                                </BreadcrumbLink>
                                            ) : (
                                                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
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

                    <div className="flex items-center gap-4">
                        <Button
                            variant="outline"
                            className="hidden md:flex relative h-9 w-full justify-start rounded-[0.5rem] bg-background text-sm font-normal text-muted-foreground shadow-none sm:pr-12 md:w-40 lg:w-64"
                            onClick={() => setIsCommandOpen(true)}
                        >
                            <span className="hidden lg:inline-flex">Search...</span>
                            <span className="inline-flex lg:hidden">Search...</span>
                            <kbd className="pointer-events-none absolute right-[0.3rem] top-[0.3rem] hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
                                <span className="text-xs">⌘</span>K
                            </kbd>
                        </Button>
                        
                        {/* Notification Center */}
                        <NotificationCenter locationId={selectedLocation?.id} />
                        
                        <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                                <div className="flex items-center gap-2 cursor-pointer hover:bg-accent/50 p-1.5 rounded-lg transition-colors group">
                                    <Avatar className="h-8 w-8 rounded-lg border">
                                        <AvatarImage src={user?.photoURL || ""} alt={user?.displayName || ""} />
                                        <AvatarFallback className="rounded-lg">CN</AvatarFallback>
                                    </Avatar>
                                    <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                                </div>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-56" align="end" forceMount>
                                <DropdownMenuLabel className="font-normal">
                                    <div className="flex flex-col space-y-1">
                                        <p className="text-sm font-medium leading-none">{user?.displayName || "Manager"}</p>
                                        <p className="text-xs leading-none text-muted-foreground">
                                            {user?.email}
                                        </p>
                                    </div>
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => onViewChange("profile")}>
                                    <UserIcon className="mr-2 h-4 w-4" />
                                    <span>Profile</span>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => logout()}>
                                    <LogOut className="mr-2 h-4 w-4" />
                                    <span>Log out</span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </header>
                <main className="flex-1 p-4 md:p-6 lg:p-8 bg-muted/10 relative overflow-hidden">
                    <AnimatedBackgroundOrbs variant="both" intensity="subtle" />
                    <div className="mx-auto max-w-7xl animate-fade-in space-y-6 relative z-10">
                        {children}
                    </div>
                </main>
            </SidebarInset>
            <CommandMenu
                open={isCommandOpen}
                onOpenChange={setIsCommandOpen}
                onViewChange={onViewChange}
                onLogout={logout}
            />
        </SidebarProvider>
    )
}
