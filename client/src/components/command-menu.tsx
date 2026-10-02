import { StorageIcon as Package, EquipmentIcon as Wrench } from "@/components/ui/inventory-icons";
"use client"

import * as React from "react"
import { Calendar, CreditCard, Settings, User, MapPin, LayoutDashboard, LogOut, Search, DollarSign, FileText, Loader2, Hash, ExternalLink, AlertTriangle, Building2, Shield, BarChart3, Users, Gift, Clock, Bell, ClipboardList, PackageCheck, Mail, ChevronRight } from "lucide-react"
import { Icon } from "@iconify/react"
import { findChefNavItem } from "@/lib/chef-nav-sections"
import { managerNavIcons } from "@/lib/manager-nav-icons"

import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command"
import { useQuery } from "@tanstack/react-query"
import { auth } from "@/lib/firebase"
import { useLocation } from "wouter"
import { useTranslation } from "react-i18next"
import { mt } from "@/i18n/manager"
import type { GlobalSearchResponse, GlobalSearchResult } from "@shared/search"

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
const REFERENCE_CODE_PATTERN = /^((KB|SB|EXT|OP|DC)-[A-Z0-9]{3,8}|\d+)$/i

const REFERENCE_TYPE_LABELS: Record<string, string> = {
    kitchen_booking: "Kitchen Booking",
    storage_booking: "Storage Booking",
    storage_extension: "Storage Extension",
    overstay_penalty: "Overstay Penalty",
    damage_claim: "Damage Claim",
}

const SEARCH_TYPE_LABELS: Record<GlobalSearchResult["type"], string> = {
    navigation: "Page",
    location: "Location",
    kitchen: "Kitchen",
    storage: "Storage",
    equipment: "Equipment",
}

function HighlightText({ text, query }: { text: string; query: string }) {
    const terms = query.trim().split(/\s+/).filter((term) => term.length > 1)
    if (!terms.length) return <>{text}</>
    const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    const pattern = new RegExp(`(${escaped.join("|")})`, "gi")
    return <>{text.split(pattern).map((part, index) =>
        terms.some((term) => part.localeCompare(term, undefined, { sensitivity: "accent" }) === 0)
            ? <mark key={`${part}-${index}`} className="rounded-sm bg-primary/15 px-0.5 text-foreground">{part}</mark>
            : <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
    )}</>
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
    const [debouncedSearch, setDebouncedSearch] = React.useState("")
    const hasBackendQuery = searchValue.trim().length >= 2
    const searchReady = debouncedSearch === searchValue.trim()

    React.useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedSearch(searchValue.trim()), 250)
        return () => window.clearTimeout(timer)
    }, [searchValue])

    const {
        data: globalSearch,
        isFetching: globalSearchLoading,
        isError: globalSearchFailed,
    } = useQuery<GlobalSearchResponse>({
        queryKey: ["/api/search", portalType, debouncedSearch],
        queryFn: async ({ signal }) => {
            const user = auth.currentUser
            if (!user) throw new Error("Authentication required")
            const token = await user.getIdToken()
            const params = new URLSearchParams({ q: debouncedSearch, portal: portalType, limit: "6" })
            const response = await fetch(`/api/search?${params}`, {
                headers: { Authorization: `Bearer ${token}` },
                signal,
            })
            if (!response.ok) throw new Error("Search request failed")
            return response.json()
        },
        enabled: open && debouncedSearch.length >= 2 && !!auth.currentUser,
        staleTime: 30_000,
    })

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
        enabled: open && portalType === 'manager' && !hasBackendQuery
    });

    const searchResults = searchReady ? (globalSearch?.results ?? []).filter((result) =>
        result.type !== "navigation" || !result.view || !hiddenItems.includes(result.view)) : []
    const openSearchResult = React.useCallback((result: GlobalSearchResult, position: number) => {
        void auth.currentUser?.getIdToken().then((token: string) => fetch("/api/search/click", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ portal: portalType, type: result.type, fuzzy: !!result.fuzzy, position }),
            keepalive: true,
        })).catch(() => undefined)
        runCommand(() => {
            if (result.type === "navigation" && result.view && onViewChange) {
                if (portalType === "admin" && result.view === "kitchen-management") {
                    navigate("/admin/manage-locations")
                    return
                }
                onViewChange(result.view)
                return
            }
            // Entity URLs carry their location/record selection. A full navigation makes
            // the existing dashboard URL initialization apply even when already on that page.
            if (result.type !== "navigation" && portalType !== "chef") window.location.assign(result.url)
            else navigate(result.url)
        })
    }, [navigate, onViewChange, portalType, runCommand])

    return (
        <>
            <div className="hidden">
                {/* Hidden trigger */}
            </div>
            <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={!hasBackendQuery && !isRefCodeSearch} large>
                <CommandInput
                    placeholder={portalType === 'admin' ? mt("shellSearchCommand") : portalType === 'manager' ? mt("shellSearchCommand") : t("shellSearchCommand")}
                    value={searchValue}
                    onValueChange={setSearchValue}
                />
                <CommandList>
                    <CommandEmpty>
                        {!searchReady || globalSearchLoading || refLookupLoading ? (
                            <div className="flex items-center justify-center gap-2 py-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="text-sm text-muted-foreground">Searching all accessible content…</span>
                            </div>
                        ) : globalSearchFailed ? (
                            <div className="text-sm text-muted-foreground">Search is temporarily unavailable.</div>
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

                    {hasBackendQuery && !searchReady && (
                        <CommandGroup heading="Searching"><CommandItem disabled><Loader2 className="mr-2 h-4 w-4 animate-spin" />Searching…</CommandItem></CommandGroup>
                    )}
                    {hasBackendQuery && searchResults.length > 0 && (
                        <CommandGroup heading={searchResults.every((result) => result.fuzzy) ? "Close matches — check the spelling" : "Search results"}>
                            {searchResults.map((result, position) => (
                                <CommandItem
                                    key={result.id}
                                    value={result.id}
                                    onSelect={() => openSearchResult(result, position)}
                                    className="group items-start gap-3 rounded-lg px-3 py-3"
                                >
                                    <Search className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate font-medium text-foreground">
                                                <HighlightText text={result.title} query={searchValue} />
                                            </span>
                                            <span className="shrink-0 rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                                {SEARCH_TYPE_LABELS[result.type]}
                                            </span>
                                        </div>
                                        {result.snippet && (
                                            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                                <HighlightText text={result.snippet} query={searchValue} />
                                            </p>
                                        )}
                                        <div className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground/80" aria-label="Breadcrumb">
                                            {result.breadcrumb.map((crumb, index) => (
                                                <React.Fragment key={`${crumb.label}-${index}`}>
                                                    {index > 0 && <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />}
                                                    <span className="truncate">{crumb.label}</span>
                                                </React.Fragment>
                                            ))}
                                        </div>
                                    </div>
                                    <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-data-[selected=true]:opacity-100" aria-hidden="true" />
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}

                    {/* ═══ CHEF Portal Navigation ═══ */}
                    {!hasBackendQuery && portalType === 'chef' && (
                        <>
                            <CommandGroup heading={t("shellNavigation")}>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("overview"))}>
                                    <Icon icon={findChefNavItem("overview")!.icon} className="mr-2 h-4 w-4" aria-hidden />
                                    <span>{t("shellOverview")}</span>
                                </CommandItem>
                                {!hiddenItems.includes("bookings") && (
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("bookings"))}>
                                    <Icon icon={findChefNavItem("bookings")!.icon} className="mr-2 h-4 w-4" aria-hidden />
                                    <span>{t("shellMyBookings")}</span>
                                </CommandItem>
                                )}
                                {!hiddenItems.includes("kitchen-applications") && (
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("kitchen-applications"))}>
                                    <Icon icon={findChefNavItem("kitchen-applications")!.icon} className="mr-2 h-4 w-4" aria-hidden />
                                    <span>{t("shellMyKitchens")}</span>
                                </CommandItem>
                                )}
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("discover-kitchens"))}>
                                    <Icon icon={findChefNavItem("discover-kitchens")!.icon} className="mr-2 h-4 w-4" aria-hidden />
                                    <span>{t("shellDiscoverKitchens")}</span>
                                </CommandItem>
                                {!hiddenItems.includes("messages") && (
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("messages"))}>
                                    <Icon icon={findChefNavItem("messages")!.icon} className="mr-2 h-4 w-4" aria-hidden />
                                    <span>{t("shellMessages")}</span>
                                </CommandItem>
                                )}
                            </CommandGroup>
                            <CommandSeparator />
                            <CommandGroup heading={t("shellAccount")}>
                                {!hiddenItems.includes("applications") && (
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("applications"))}>
                                    <Icon icon={findChefNavItem("applications")!.icon} className="mr-2 h-4 w-4" aria-hidden />
                                    <span>{t("shellMyApplication")}</span>
                                </CommandItem>
                                )}
                                {!hiddenItems.includes("my-account") && (
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("my-account"))}>
                                    <Icon icon={findChefNavItem("my-account")!.icon} className="mr-2 h-4 w-4" aria-hidden />
                                    <span>{t("shellLinkedAccounts")}</span>
                                </CommandItem>
                                )}
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("training"))}>
                                    <Icon icon={findChefNavItem("training")!.icon} className="mr-2 h-4 w-4" aria-hidden />
                                    <span>{t("shellTraining")}</span>
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("transactions"))}>
                                    <CreditCard className="mr-2 h-4 w-4" />
                                    <span>{t("shellMyTransactions")}</span>
                                </CommandItem>
                                {!hiddenItems.includes("issues-refunds") && (
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("issues-refunds"))}>
                                    <Icon icon={findChefNavItem("issues-refunds")!.icon} className="mr-2 h-4 w-4" aria-hidden />
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
                    {!hasBackendQuery && portalType === 'manager' && (
                        <>
                            <CommandGroup heading={mt("cmdSuggestions")}>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("overview"))}>
                                    <managerNavIcons.overview className="mr-2 h-4 w-4" />
                                    <span>{mt("navDashboard")}</span>
                                </CommandItem>
                                {!hiddenItems.includes("bookings") && <CommandItem onSelect={() => runCommand(() => onViewChange?.("bookings"))}>
                                    <managerNavIcons.bookings className="mr-2 h-4 w-4" />
                                    <span>{mt("navBookings")}</span>
                                </CommandItem>}
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("messages"))}>
                                    <managerNavIcons.messages className="mr-2 h-4 w-4" />
                                    <span>{mt("navMessages")}</span>
                                </CommandItem>
                            </CommandGroup>
                            <CommandSeparator />
                            <CommandGroup heading={mt("cmdManagement")}>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("my-locations"))}>
                                    <MapPin className="mr-2 h-4 w-4" />
                                    <span>{mt("navLocation")}</span>
                                    {locations[0]?.name && <span className="ml-2 truncate text-xs text-muted-foreground">{locations[0].name}</span>}
                                </CommandItem>
                                <CommandItem onSelect={() => runCommand(() => onViewChange?.("kitchens"))}>
                                    <managerNavIcons.kitchens className="mr-2 h-4 w-4" />
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
                                {!hiddenItems.includes("applications") && <CommandItem onSelect={() => runCommand(() => onViewChange?.("applications"))}>
                                    <managerNavIcons.applications className="mr-2 h-4 w-4" />
                                    <span>{mt("navApplications")}</span>
                                </CommandItem>}
                                {!hiddenItems.includes("revenue") && <CommandItem onSelect={() => runCommand(() => onViewChange?.("revenue"))}>
                                    <managerNavIcons.revenue className="mr-2 h-4 w-4" />
                                    <span>{mt("navRevenue")}</span>
                                </CommandItem>}
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
                    {!hasBackendQuery && portalType === 'admin' && (
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
