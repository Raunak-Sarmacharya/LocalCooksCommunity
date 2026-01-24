"use client"

import * as React from "react"
import {
    Calendar,
    CreditCard,
    Settings,
    User,
    MapPin,
    LayoutDashboard,
    LogOut,
    Search,
    Wrench,
    Package,
    DollarSign,
    MessageCircle,
    FileText,
    Loader2
} from "lucide-react"

import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
    CommandShortcut,
} from "@/components/ui/command"
import { useQuery } from "@tanstack/react-query"
import { auth } from "@/lib/firebase"

interface CommandMenuProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onViewChange?: (view: string) => void
    onLogout?: () => void
}

export function CommandMenu({ open, onOpenChange, onViewChange, onLogout }: CommandMenuProps) {
    React.useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onOpenChange(!open)
            }
        }

        document.addEventListener("keydown", down)
        return () => document.removeEventListener("keydown", down)
    }, [onOpenChange, open])

    const runCommand = React.useCallback((command: () => unknown) => {
        onOpenChange(false)
        command()
    }, [onOpenChange])

    // --- Dynamic Data Fetching ---

    // Fetch Manager Locations
    const { data: locations = [] } = useQuery({
        queryKey: ["/api/manager/locations/summary"],
        queryFn: async () => {
            if (!auth.currentUser) return [];
            const token = await auth.currentUser.getIdToken();
            // Using existing endpoint or fallback to simple fetch
            const res = await fetch("/api/manager/locations", {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) return [];
            return res.json();
        },
        enabled: open // Only fetch when open
    });

    return (
        <>
            <div className="hidden">
                {/* Hidden trigger */}
            </div>
            <CommandDialog open={open} onOpenChange={onOpenChange}>
                <CommandInput placeholder="Type a command or search..." />
                <CommandList>
                    <CommandEmpty>No results found.</CommandEmpty>

                    <CommandGroup heading="Suggestions">
                        <CommandItem onSelect={() => runCommand(() => onViewChange?.("overview"))}>
                            <LayoutDashboard className="mr-2 h-4 w-4" />
                            <span>Dashboard</span>
                        </CommandItem>
                        <CommandItem onSelect={() => runCommand(() => onViewChange?.("bookings"))}>
                            <Calendar className="mr-2 h-4 w-4" />
                            <span>Bookings</span>
                        </CommandItem>
                        <CommandItem onSelect={() => runCommand(() => onViewChange?.("messages"))}>
                            <MessageCircle className="mr-2 h-4 w-4" />
                            <span>Messages</span>
                        </CommandItem>
                    </CommandGroup>

                    <CommandSeparator />

                    {/* Dynamic Kitchens */}
                    {locations.length > 0 && (
                        <CommandGroup heading="Your Kitchens">
                            {locations.map((loc: any) => (
                                <CommandItem key={loc.id} onSelect={() => runCommand(() => {
                                    // Navigate to settings or specific location view if supported
                                    // For now, switch to locations view
                                    onViewChange?.("my-locations");
                                })}>
                                    <MapPin className="mr-2 h-4 w-4" />
                                    <span>{loc.name}</span>
                                    <span className="ml-2 text-xs text-muted-foreground truncate max-w-[100px]">{loc.address}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}
                    {(locations.length > 0) && <CommandSeparator />}

                    <CommandGroup heading="Management">
                        <CommandItem onSelect={() => runCommand(() => onViewChange?.("my-locations"))}>
                            <MapPin className="mr-2 h-4 w-4" />
                            <span>All Locations</span>
                        </CommandItem>
                        <CommandItem onSelect={() => runCommand(() => onViewChange?.("settings"))}>
                            <Settings className="mr-2 h-4 w-4" />
                            <span>Kitchen Settings</span>
                        </CommandItem>
                        <CommandItem onSelect={() => runCommand(() => onViewChange?.("availability"))}>
                            <Calendar className="mr-2 h-4 w-4" />
                            <span>Availability</span>
                        </CommandItem>
                        <CommandItem onSelect={() => runCommand(() => onViewChange?.("pricing"))}>
                            <DollarSign className="mr-2 h-4 w-4" />
                            <span>Pricing</span>
                        </CommandItem>
                    </CommandGroup>
                    <CommandSeparator />
                    <CommandGroup heading="Inventory">
                        <CommandItem onSelect={() => runCommand(() => onViewChange?.("storage-listings"))}>
                            <Package className="mr-2 h-4 w-4" />
                            <span>Storage Listings</span>
                        </CommandItem>
                        <CommandItem onSelect={() => runCommand(() => onViewChange?.("equipment-listings"))}>
                            <Wrench className="mr-2 h-4 w-4" />
                            <span>Equipment Listings</span>
                        </CommandItem>
                    </CommandGroup>
                    <CommandSeparator />
                    <CommandGroup heading="Business">
                        <CommandItem onSelect={() => runCommand(() => onViewChange?.("applications"))}>
                            <FileText className="mr-2 h-4 w-4" />
                            <span>Applications</span>
                        </CommandItem>
                        <CommandItem onSelect={() => runCommand(() => onViewChange?.("revenue"))}>
                            <DollarSign className="mr-2 h-4 w-4" />
                            <span>Revenue</span>
                        </CommandItem>
                        <CommandItem onSelect={() => runCommand(() => onViewChange?.("payments"))}>
                            <CreditCard className="mr-2 h-4 w-4" />
                            <span>Payments & Billing</span>
                        </CommandItem>
                    </CommandGroup>
                    <CommandSeparator />
                    <CommandGroup heading="Profile">
                        <CommandItem onSelect={() => runCommand(() => onViewChange?.("profile"))}>
                            <User className="mr-2 h-4 w-4" />
                            <span>Profile Settings</span>
                        </CommandItem>
                        {onLogout && (
                            <CommandItem onSelect={() => runCommand(() => onLogout())}>
                                <LogOut className="mr-2 h-4 w-4" />
                                <span>Log out</span>
                                <CommandShortcut>⇧⌘Q</CommandShortcut>
                            </CommandItem>
                        )}
                    </CommandGroup>
                </CommandList>
            </CommandDialog>
        </>
    )
}
