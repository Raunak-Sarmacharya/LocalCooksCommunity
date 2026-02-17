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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useFirebaseAuth } from "@/hooks/use-auth"
import { LogOut, User as UserIcon, ChevronDown, Command } from "lucide-react"
import ChefNotificationCenter from "@/components/chef/ChefNotificationCenter"
import { CommandMenu } from "@/components/command-menu"
import { Button } from "@/components/ui/button"

interface ChefDashboardLayoutProps {
    children: React.ReactNode
    activeView: string
    onViewChange: (view: string) => void
    messageBadgeCount?: number
    breadcrumbs?: Array<{ label: string; href?: string; onClick?: () => void }>
}

// View labels for breadcrumb generation
const viewLabels: Record<string, string> = {
    overview: "Overview",
    applications: "My Application",
    "kitchen-applications": "My Kitchens",
    bookings: "My Bookings",
    training: "Training",
    messages: "Messages",
    discover: "Discover Kitchens",
    "discover-kitchens": "Discover Kitchens",
    profile: "Profile",
    support: "Support",
    feedback: "Feedback",
    "damage-claims": "Damage Claims",
}

export default function ChefDashboardLayout({
    children,
    activeView,
    onViewChange,
    messageBadgeCount = 0,
    breadcrumbs,
}: ChefDashboardLayoutProps) {
    const { user, logout } = useFirebaseAuth()
    const [isCommandOpen, setIsCommandOpen] = React.useState(false)

    // Generate breadcrumbs based on active view if not provided
    const displayBreadcrumbs = breadcrumbs || [
        { label: "Dashboard", href: "#" },
        { label: viewLabels[activeView] || activeView },
    ]

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
        <SidebarProvider>
            <ChefSidebar
                activeView={activeView}
                onViewChange={onViewChange}
                messageBadgeCount={messageBadgeCount}
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

                        {/* Notification Bell */}
                        <ChefNotificationCenter />
                        
                        <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                                <div className="flex items-center gap-2 cursor-pointer hover:bg-accent/50 p-1.5 rounded-lg transition-colors group">
                                    <Avatar className="h-8 w-8 rounded-lg border">
                                        <AvatarImage
                                            src={user?.photoURL || ""}
                                            alt={user?.displayName || "Chef"}
                                        />
                                        <AvatarFallback className="rounded-lg">
                                            {getInitials(user?.displayName)}
                                        </AvatarFallback>
                                    </Avatar>
                                    <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                                </div>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                align="end"
                                sideOffset={4}
                                forceMount
                                className="w-64 p-2 bg-background/95 backdrop-blur-sm border border-border/60 rounded-lg shadow-xl shadow-foreground/5"
                            >
                                <div className="px-3 py-2.5 mb-1">
                                    <p className="text-sm font-medium text-foreground tracking-tight leading-tight">
                                        {user?.displayName || "Chef"}
                                    </p>
                                    <p className="text-xs text-muted-foreground tracking-tight leading-tight">
                                        {user?.email}
                                    </p>
                                </div>

                                <DropdownMenuSeparator className="my-2 bg-gradient-to-r from-transparent via-border to-transparent" />

                                <div className="space-y-1">
                                    <DropdownMenuItem
                                        onClick={() => onViewChange("profile")}
                                        className="flex items-center p-3 rounded-md transition-all duration-200 cursor-pointer group hover:shadow-sm border border-transparent hover:border-border/50"
                                    >
                                        <UserIcon className="mr-2 h-4 w-4" />
                                        <span className="text-sm font-medium tracking-tight">Profile</span>
                                    </DropdownMenuItem>
                                </div>

                                <DropdownMenuSeparator className="my-2 bg-gradient-to-r from-transparent via-border to-transparent" />

                                <DropdownMenuItem
                                    onClick={() => logout()}
                                    className="flex items-center gap-3 p-3 rounded-md duration-200 bg-destructive/10 hover:bg-destructive/20 cursor-pointer border border-transparent hover:border-destructive/30 hover:shadow-sm transition-all group"
                                >
                                    <LogOut className="h-4 w-4 text-destructive group-hover:text-destructive" />
                                    <span className="text-sm font-medium text-destructive">Sign Out</span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </header>
                <main className="flex-1 p-4 md:p-6 lg:p-8 bg-muted/30">
                    <div className="mx-auto max-w-7xl animate-fade-in space-y-6">
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
            />
        </SidebarProvider>
    )
}
