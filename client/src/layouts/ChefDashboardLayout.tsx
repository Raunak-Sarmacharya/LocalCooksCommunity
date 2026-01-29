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
import AnimatedBackgroundOrbs from "@/components/ui/AnimatedBackgroundOrbs"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useFirebaseAuth } from "@/hooks/use-auth"
import { LogOut, User as UserIcon, ChevronDown } from "lucide-react"
import ChefNotificationCenter from "@/components/chef/ChefNotificationCenter"

interface ChefDashboardLayoutProps {
    children: React.ReactNode
    activeView: string
    onViewChange: (view: string) => void
    messageBadgeCount?: number
    breadcrumbs?: Array<{ label: string; href?: string }>
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
    profile: "Profile",
    support: "Support",
    feedback: "Feedback",
}

export default function ChefDashboardLayout({
    children,
    activeView,
    onViewChange,
    messageBadgeCount = 0,
    breadcrumbs,
}: ChefDashboardLayoutProps) {
    const { user, logout } = useFirebaseAuth()

    // Generate breadcrumbs based on active view if not provided
    const displayBreadcrumbs = breadcrumbs || [
        { label: "Chef Portal", href: "#" },
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
                                            {crumb.href ? (
                                                <BreadcrumbLink
                                                    href="#"
                                                    onClick={(e) => {
                                                        e.preventDefault()
                                                        onViewChange("overview")
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
                            <DropdownMenuContent className="w-56" align="end" forceMount>
                                <DropdownMenuLabel className="font-normal">
                                    <div className="flex flex-col space-y-1">
                                        <p className="text-sm font-medium leading-none">
                                            {user?.displayName || "Chef"}
                                        </p>
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
        </SidebarProvider>
    )
}
