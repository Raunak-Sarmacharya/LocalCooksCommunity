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
    Store,
    MessageCircle,
    FileText,
    Loader2,
    Hash,
    ExternalLink,
    AlertTriangle,
    BookOpen,
    Building2,
    Shield,
    BarChart3,
    Users,
    Gift,
    Clock,
    Bell,
    ClipboardList,
    PackageCheck,
    Mail,
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
import { useLocation } from "wouter"
import { useTranslation } from "react-i18next"
import { mt } from "@/i18n/manager"

export type PortalType = 'chef' | 'manager' | 'admin'

interface CommandMenuProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onViewChange?: (view: string) => void
    onLogout?: () => void
    portalType?: PortalType
    hiddenItems?: string[]
}

// Reference code pattern: KB-XXXXXX, SB-XXXXXX, EXT-XXXXXX, OP-XXXXXX, DC-XXXXXX
const REFERENCE_CODE_PATTERN = /^(KB|SB|EXT|OP|DC)-[A-Z0-9]{3,8}$/i

const REFERENCE_TYPE_LABELS: Record<string, string> = {
    kitchen_booking: "Kitchen Booking",
    storage_booking: "Storage Booking",
    storage_extension: "Storage Extension",
    overstay_penalty: "Overstay Penalty",
    damage_claim: "Damage Claim",
}

export function CommandMenu({ open, onOpenChange, onViewChange, onLogout, portalType = 'manager', hiddenItems = [] }: CommandMenuProps) {
    const [, navigate] = useLocation()
    const { t } = useTranslation("chef")
    const [searchValue, setSearchValue] = React.useState("")
    const [refLookupResult, setRefLookupResult] = React.useState<{
        type: string; id: number; referenceCode: string; url: string;
    } | null>(null)
    const [refLookupLoading, setRefLookupLoading] = React.useState(false)
    const [refLookupError, setRefLookupError] = React.useState<string | null>(null)

    // Reset state when dialog closes
    React.useEffect(() => {
        if (!open) {
            setSearchValue("")
            setRefLookupResult(null)
            setRefLookupLoading(false)
            setRefLookupError(null)
        }
    }, [open])

    // Normalize search: strip leading # and whitespace for ref code matching
    const normalizedSearch = searchValue.trim().replace(/^#/, '').trim().toUpperCase()
    const isRefCodeSearch = REFERENCE_CODE_PATTERN.test(normalizedSearch)

    // Debounced reference code lookup
    React.useEffect(() => {
        if (!isRefCodeSearch) {
            setRefLookupResult(null)
            setRefLookupError(null)
            return
        }

        const controller = new AbortController()
        const timer = setTimeout(async () => {
            setRefLookupLoading(true)
            setRefLookupError(null)
            try {
                if (!auth.currentUser) return
                const token = await auth.currentUser.getIdToken()
                const res = await fetch(`/api/bookings/by-reference/${normalizedSearch}`, {
                    headers: { Authorization: `Bearer ${token}` },
                    signal: controller.signal,
                })
                if (res.ok) {
                    const data = await res.json()
                    setRefLookupResult(data)
                    setRefLookupError(null)
                } else {
                    setRefLookupResult(null)
                    setRefLookupError(res.status === 404 ? mt("cmdNoBookingForRef") : mt("cmdLookupFailed"))
                }
            } catch (err: any) {
                if (err.name !== "AbortError") {
                    setRefLookupResult(null)
                    setRefLookupError(mt("cmdLookupFailed"))
                }
            } finally {
                setRefLookupLoading(false)
            }
        }, 300)

        return () => {
            clearTimeout(timer)
            controller.abort()
        }
    }, [normalizedSearch, isRefCodeSearch])

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

    // --- Dynamic Data Fetching (Manager only) ---
    const { data: locations = [] } = useQuery({
        queryKey: ["/api/manager/locations/summary"],
        queryFn: async () => {
            if (!auth.currentUser) return [];
            const token = await auth.currentUser.getIdToken();
            const res = await fetch("/api/manager/locations", {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) return [];
            return res.json();
        },
        enabled: open && portalType === 'manager'
    });

    return (
        <>
            <div className="hidden">
                {/* Hidden trigger */}
            </div>
            <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={!isRefCodeSearch}>
                <CommandInput
                    placeholder={portalType === 'admin' ? mt("shellSearchCommand") : portalType === 'manager' ? mt("shellSearchCommand") : t("shellSearchCommand")}
                    value={searchValue}
                    onValueChange={setSearchValue}
                />
                <CommandList>
                    <CommandEmpty>
                        {refLookupLoading ? (
                            <div className="flex items-center justify-center gap-2 py-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="text-sm text-muted-foreground">{mt("cmdLookingUpRef")}</span>
                            </div>
                        ) : refLookupError ? (
                            <div className="text-sm text-muted-foreground">{refLookupError}</div>
                        ) : (
                            mt("shellNoResults", { defaultValue: t("shellNoResults") })
                        )}
                    </CommandEmpty>

                    {/* ═══ Reference Code Lookup Result ═══ */}
                    {refLookupResult && (
                        <>
                            <CommandGroup heading={mt("cmdReferenceCodeMatch")}>
                                <CommandItem
                                    onSelect={() => runCommand(() => {
                                        const url = refLookupResult.url
                                        if (portalType === 'admin' && url.startsWith('/admin?')) {
                                            // For admin: push URL with search param, then switch section via callback
                                            window.history.pushState({}, '', url)
                                            const params = new URLSearchParams(url.split('?')[1])
                                            const section = params.get('section')
                                            if (section) onViewChange?.(section)
                                        } else {
                                            navigate(url)
                                        }
                                    })}
                                    className="flex items-center gap-2"
                                >
                                    <Hash className="mr-1 h-4 w-4 text-primary" />
                                    <div className="flex flex-col">
                                        <span className="font-mono font-semibold text-primary">{refLookupResult.referenceCode}</span>
                                        <span className="text-xs text-muted-foreground">
                                            {REFERENCE_TYPE_LABELS[refLookupResult.type] || refLookupResult.type} · ID #{refLookupResult.id}
                                        </span>
                                    </div>
                                    <ExternalLink className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                                </CommandItem>
                            </CommandGroup>
                            <CommandSeparator />
                        </>
                    )}
                    {refLookupLoading && isRefCodeSearch && (
                        <CommandGroup heading={mt("cmdReferenceCodeLookup")}>
                            <CommandItem disabled>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                <span className="text-muted-foreground">{mt("cmdSearching")}</span>
                            </CommandItem>
                        </CommandGroup>
                    )}

                    {/* ═══ CHEF Portal Navigation ═══ */}
                    {portalType === 'chef' && (
                        <>
                            <CommandGroup heading={t("shellNavigation")}>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("overview"))}>
                                    <LayoutDashboard className="mr-2 h-4 w-4" />
                                    <span>{t("shellOverview")}</span>
                                </CommandItem>
                                {!hiddenItems.includes("bookings") && (
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("bookings"))}>
                                    <Calendar className="mr-2 h-4 w-4" />
                                    <span>{t("shellMyBookings")}</span>
                                </CommandItem>
                                )}
                                {!hiddenItems.includes("kitchen-applications") && (
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("kitchen-applications"))}>
                                    <Building2 className="mr-2 h-4 w-4" />
                                    <span>{t("shellMyKitchens")}</span>
                                </CommandItem>
                                )}
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("discover-kitchens"))}>
                                    <Search className="mr-2 h-4 w-4" />
                                    <span>{t("shellDiscoverKitchens")}</span>
                                </CommandItem>
                                {!hiddenItems.includes("messages") && (
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("messages"))}>
                                    <MessageCircle className="mr-2 h-4 w-4" />
                                    <span>{t("shellMessages")}</span>
                                </CommandItem>
                                )}
                            </CommandGroup>
                            <CommandSeparator />
                            <CommandGroup heading={t("shellAccount")}>
                                {!hiddenItems.includes("applications") && (
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("applications"))}>
                                    <FileText className="mr-2 h-4 w-4" />
                                    <span>{t("shellMyApplication")}</span>
                                </CommandItem>
                                )}
                                {!hiddenItems.includes("my-account") && (
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("my-account"))}>
                                    <Store className="mr-2 h-4 w-4" />
                                    <span>{t("shellLinkedAccounts")}</span>
                                </CommandItem>
                                )}
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("training"))}>
                                    <BookOpen className="mr-2 h-4 w-4" />
                                    <span>{t("shellTraining")}</span>
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("transactions"))}>
                                    <CreditCard className="mr-2 h-4 w-4" />
                                    <span>{t("shellMyTransactions")}</span>
                                </CommandItem>
                                {!hiddenItems.includes("issues-refunds") && (
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("issues-refunds"))}>
                                    <AlertTriangle className="mr-2 h-4 w-4" />
                                    <span>{t("shellResolutionCenter")}</span>
                                </CommandItem>
                                )}
                            </CommandGroup>
                            <CommandSeparator />
                            <CommandGroup heading={t("shellProfile")}>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("profile"))}>
                                    <User className="mr-2 h-4 w-4" />
                                    <span>{t("shellProfile")}</span>
                                </CommandItem>
                                {onLogout && (
                                    <CommandItem onSelect={() => runCommand(() => onLogout())}>
                                        <LogOut className="mr-2 h-4 w-4" />
                                        <span>{t("shellSignOut")}</span>
                                        <CommandShortcut>⇧⌘Q</CommandShortcut>
                                    </CommandItem>
                                )}
                            </CommandGroup>
                        </>
                    )}

                    {/* ═══ MANAGER Portal Navigation ═══ */}
                    {portalType === 'manager' && (
                        <>
                            <CommandGroup heading={mt("cmdSuggestions")}>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("overview"))}>
                                    <LayoutDashboard className="mr-2 h-4 w-4" />
                                    <span>{mt("navDashboard")}</span>
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("bookings"))}>
                                    <Calendar className="mr-2 h-4 w-4" />
                                    <span>{mt("navBookings")}</span>
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("messages"))}>
                                    <MessageCircle className="mr-2 h-4 w-4" />
                                    <span>{mt("navMessages")}</span>
                                </CommandItem>
                            </CommandGroup>
                            <CommandSeparator />
                            {locations.length > 0 && (
                                <CommandGroup heading={mt("cmdYourKitchens")}>
                                    {locations.map((loc: any) => (
                                        <CommandItem key={loc.id} onSelect={() => runCommand(() => {
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
                            <CommandGroup heading={mt("cmdManagement")}>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("my-locations"))}>
                                    <MapPin className="mr-2 h-4 w-4" />
                                    <span>{mt("cmdAllLocations")}</span>
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("settings"))}>
                                    <Settings className="mr-2 h-4 w-4" />
                                    <span>{mt("cmdKitchenSettings")}</span>
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("availability"))}>
                                    <Calendar className="mr-2 h-4 w-4" />
                                    <span>{mt("navAvailability")}</span>
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("pricing"))}>
                                    <DollarSign className="mr-2 h-4 w-4" />
                                    <span>{mt("navPricing")}</span>
                                </CommandItem>
                            </CommandGroup>
                            <CommandSeparator />
                            <CommandGroup heading={mt("cmdInventory")}>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("storage-listings"))}>
                                    <Package className="mr-2 h-4 w-4" />
                                    <span>{mt("cmdStorageListings")}</span>
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("equipment-listings"))}>
                                    <Wrench className="mr-2 h-4 w-4" />
                                    <span>{mt("cmdEquipmentListings")}</span>
                                </CommandItem>
                            </CommandGroup>
                            <CommandSeparator />
                            <CommandGroup heading={mt("cmdBusiness")}>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("applications"))}>
                                    <FileText className="mr-2 h-4 w-4" />
                                    <span>{mt("navApplications")}</span>
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("revenue"))}>
                                    <DollarSign className="mr-2 h-4 w-4" />
                                    <span>{mt("navRevenue")}</span>
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("payments"))}>
                                    <CreditCard className="mr-2 h-4 w-4" />
                                    <span>{mt("cmdPaymentsBilling")}</span>
                                </CommandItem>
                            </CommandGroup>
                            <CommandSeparator />
                            <CommandGroup heading={mt("shellProfile")}>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("profile"))}>
                                    <User className="mr-2 h-4 w-4" />
                                    <span>{mt("cmdProfileSettings")}</span>
                                </CommandItem>
                                {onLogout && (
                                    <CommandItem onSelect={() => runCommand(() => onLogout())}>
                                        <LogOut className="mr-2 h-4 w-4" />
                                        <span>{mt("shellSignOut")}</span>
                                        <CommandShortcut>⇧⌘Q</CommandShortcut>
                                    </CommandItem>
                                )}
                            </CommandGroup>
                        </>
                    )}

                    {/* ═══ ADMIN Portal Navigation ═══ */}
                    {portalType === 'admin' && (
                        <>
                            <CommandGroup heading="Dashboard">
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("overview"))}>
                                    <LayoutDashboard className="mr-2 h-4 w-4" />
                                    <span>Overview</span>
                                </CommandItem>
                            </CommandGroup>
                            <CommandSeparator />
                            <CommandGroup heading="Applications">
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("applications"))}>
                                    <Shield className="mr-2 h-4 w-4" />
                                    <span>Chef Applications</span>
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("kitchen-licenses"))}>
                                    <FileText className="mr-2 h-4 w-4" />
                                    <span>Kitchen Licenses</span>
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("damage-claims"))}>
                                    <AlertTriangle className="mr-2 h-4 w-4" />
                                    <span>Damage Claims</span>
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("escalated-penalties"))}>
                                    <AlertTriangle className="mr-2 h-4 w-4" />
                                    <span>Escalated Penalties</span>
                                </CommandItem>
                            </CommandGroup>
                            <CommandSeparator />
                            <CommandGroup heading="Management">
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("chef-kitchen-access"))}>
                                    <Users className="mr-2 h-4 w-4" />
                                    <span>Chef Kitchen Access</span>
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("kitchen-management"))}>
                                    <Building2 className="mr-2 h-4 w-4" />
                                    <span>Manage Kitchens</span>
                                </CommandItem>
                            </CommandGroup>
                            <CommandSeparator />
                            <CommandGroup heading="Communications">
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("promos"))}>
                                    <Gift className="mr-2 h-4 w-4" />
                                    <span>Send Promo Codes</span>
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("email-log"))}>
                                    <Mail className="mr-2 h-4 w-4" />
                                    <span>Email Log</span>
                                </CommandItem>
                            </CommandGroup>
                            <CommandSeparator />
                            <CommandGroup heading="Revenue">
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("transactions"))}>
                                    <CreditCard className="mr-2 h-4 w-4" />
                                    <span>Transactions</span>
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("manager-revenues"))}>
                                    <DollarSign className="mr-2 h-4 w-4" />
                                    <span>Manager Revenues</span>
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("platform-overview"))}>
                                    <BarChart3 className="mr-2 h-4 w-4" />
                                    <span>Platform Overview</span>
                                </CommandItem>
                            </CommandGroup>
                            <CommandSeparator />
                            <CommandGroup heading="Settings">
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("platform-settings"))}>
                                    <Settings className="mr-2 h-4 w-4" />
                                    <span>Platform Settings</span>
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("account-settings"))}>
                                    <User className="mr-2 h-4 w-4" />
                                    <span>Account Settings</span>
                                </CommandItem>
                            </CommandGroup>
                            <CommandSeparator />
                            {onLogout && (
                                <CommandGroup heading="Account">
                                    <CommandItem onSelect={() => runCommand(() => onLogout())}>
                                        <LogOut className="mr-2 h-4 w-4" />
                                        <span>Sign Out</span>
                                        <CommandShortcut>⇧⌘Q</CommandShortcut>
                                    </CommandItem>
                                </CommandGroup>
                            )}
                        </>
                    )}
                </CommandList>
            </CommandDialog>
        </>
    )
}
