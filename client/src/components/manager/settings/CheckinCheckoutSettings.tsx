/**
 * Kitchen Check-In / Check-Out Settings Component
 * Manager-controlled checklists + photo requirements for kitchen check-in and
 * check-out, plus smart-lock access codes. Storage checkout lives on its own
 * page (StorageCheckoutSettings).
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Lock,
  AlertTriangle,
  KeyRound,
  Hash,
  Copy,
  Eye,
  EyeOff,
  ChefHat,
  Clock,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPut } from "@/lib/api";
import type {
  ChecklistItem,
  PhotoRequirement,
} from "./shared/ChecklistEditor";
import {
  KitchenCheckinCheckoutEditor,
  itemsToStorage,
  unifyStorageToItems,
  validateUnifiedItems,
  type UnifiedChecklistItem,
} from "./KitchenCheckinCheckoutEditor";

// ─── Types ────────────────────────────────────────────────────────────────────

// Manager-overridable time windows only. Checkout review window is admin-only
// (platform setting); kitchen overstay tracking has been removed.
interface TimeWindowSettings {
  checkinWindowMinutesBefore: number | null;
  noShowGraceMinutes: number | null;
}

interface PlatformTimeWindowDefaults {
  checkinWindowMinutesBefore: number;
  noShowGraceMinutes: number;
}

interface CheckinCheckoutSettingsData {
  id: number | null;
  locationId: number;
  checkinEnabled: boolean;
  checkinItems: ChecklistItem[];
  checkinPhotoRequirements: PhotoRequirement[];
  checkinInstructions: string | null;
  checkoutEnabled: boolean;
  checkoutItems: ChecklistItem[];
  checkoutPhotoRequirements: PhotoRequirement[];
  checkoutInstructions: string | null;
  smartLockCheckinInstructions: string | null;
  timeWindowSettings?: TimeWindowSettings;
  platformDefaults?: PlatformTimeWindowDefaults;
}

interface CheckinCheckoutSettingsProps {
  location: {
    id: number;
    name: string;
  };
}

// ─── Kitchen Access Code Types ────────────────────────────────────────────────

type CodeVisibility = "on_booking" | "at_checkin" | "manual";

interface KitchenForAccessCode {
  id: number;
  name: string;
  /** Admin-controlled capability gate. When false the kitchen is hidden from this section. */
  smartLockAvailable: boolean;
  smartLockEnabled: boolean;
  smartLockConfig: {
    accessCodeFormat?: "numeric" | "alphanumeric";
    accessCode?: string;
    codeSetAt?: string;
    codeVisibility?: CodeVisibility;
    [key: string]: unknown;
  } | null;
}

// ─── Access Codes Section ─────────────────────────────────────────────────────

function AccessCodesSection({ locationId }: { locationId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [revealedCodes, setRevealedCodes] = useState<Set<number>>(new Set());
  const [savingKitchenId, setSavingKitchenId] = useState<number | null>(null);
  const [codeInputs, setCodeInputs] = useState<Record<number, string>>({});

  // Fetch kitchens for this location
  const { data: kitchensRaw, isLoading: isLoadingKitchens } = useQuery<
    KitchenForAccessCode[]
  >({
    queryKey: ["manager-kitchens-access", locationId],
    queryFn: () => apiGet(`/manager/kitchens/${locationId}`),
    enabled: !!locationId,
  });

  const kitchensList = useMemo(() => {
    if (!kitchensRaw) return [];
    // Only surface kitchens whose smart-door capability has been enabled by the
    // admin. Hiding them here guarantees managers never see smart-lock controls
    // for kitchens that aren't equipped for them.
    return kitchensRaw
      .map((k: any) => ({
        id: k.id,
        name: k.name,
        smartLockAvailable: Boolean(k.smartLockAvailable ?? k.smart_lock_available ?? false),
        smartLockEnabled: k.smartLockEnabled ?? false,
        smartLockConfig: k.smartLockConfig ?? null,
      }))
      .filter((k) => k.smartLockAvailable) as KitchenForAccessCode[];
  }, [kitchensRaw]);

  // If no kitchens at this location have smart-door capability enabled by the
  // admin, don't render the Access Codes section at all.
  const hasSmartLockKitchens = kitchensList.length > 0;

  const handleToggleSmartLock = useCallback(
    async (kitchen: KitchenForAccessCode, enabled: boolean) => {
      setSavingKitchenId(kitchen.id);
      try {
        const existingConfig = kitchen.smartLockConfig || {};
        await apiPut(`/manager/kitchens/${kitchen.id}/smart-lock/config`, {
          enabled,
          config: {
            ...existingConfig,
            accessCodeFormat: existingConfig.accessCodeFormat || "numeric",
          },
        });
        queryClient.invalidateQueries({
          queryKey: ["manager-kitchens-access", locationId],
        });
        toast({ title: enabled ? "Smart lock enabled" : "Smart lock disabled" });
      } catch {
        toast({
          title: "Error",
          description: "Failed to update smart lock",
          variant: "destructive",
        });
      } finally {
        setSavingKitchenId(null);
      }
    },
    [locationId, queryClient, toast],
  );

  const handleUpdateCodeFormat = useCallback(
    async (
      kitchen: KitchenForAccessCode,
      format: "numeric" | "alphanumeric",
    ) => {
      setSavingKitchenId(kitchen.id);
      try {
        const existingConfig = kitchen.smartLockConfig || {};
        await apiPut(`/manager/kitchens/${kitchen.id}/smart-lock/config`, {
          enabled: true,
          config: { ...existingConfig, accessCodeFormat: format },
        });
        queryClient.invalidateQueries({
          queryKey: ["manager-kitchens-access", locationId],
        });
        toast({ title: `Code format set to ${format}` });
      } catch {
        toast({
          title: "Error",
          description: "Failed to update code format",
          variant: "destructive",
        });
      } finally {
        setSavingKitchenId(null);
      }
    },
    [locationId, queryClient, toast],
  );

  const handleUpdateCodeVisibility = useCallback(
    async (kitchen: KitchenForAccessCode, visibility: CodeVisibility) => {
      setSavingKitchenId(kitchen.id);
      try {
        const existingConfig = kitchen.smartLockConfig || {};
        await apiPut(`/manager/kitchens/${kitchen.id}/smart-lock/config`, {
          enabled: true,
          config: { ...existingConfig, codeVisibility: visibility },
        });
        queryClient.invalidateQueries({
          queryKey: ["manager-kitchens-access", locationId],
        });
        const labels: Record<CodeVisibility, string> = {
          on_booking: "Code shown at booking confirmation",
          at_checkin: "Code shown at check-in time",
          manual: "Code shared manually by you",
        };
        toast({ title: labels[visibility] });
      } catch {
        toast({
          title: "Error",
          description: "Failed to update visibility",
          variant: "destructive",
        });
      } finally {
        setSavingKitchenId(null);
      }
    },
    [locationId, queryClient, toast],
  );

  const handleSaveCode = useCallback(
    async (kitchen: KitchenForAccessCode) => {
      const code = codeInputs[kitchen.id]?.trim();
      if (!code) {
        toast({
          title: "Enter a code",
          description: "Type the access code for this kitchen",
          variant: "destructive",
        });
        return;
      }
      setSavingKitchenId(kitchen.id);
      try {
        const existingConfig = kitchen.smartLockConfig || {};
        const format = (existingConfig.accessCodeFormat as string) || "numeric";
        await apiPut(`/manager/kitchens/${kitchen.id}/smart-lock/config`, {
          enabled: true,
          config: {
            ...existingConfig,
            accessCodeFormat: format,
            accessCode: code,
            codeSetAt: new Date().toISOString(),
          },
        });
        queryClient.invalidateQueries({
          queryKey: ["manager-kitchens-access", locationId],
        });
        setCodeInputs((prev) => {
          const n = { ...prev };
          delete n[kitchen.id];
          return n;
        });
        setRevealedCodes((prev) => {
          const n = new Set(prev);
          n.add(kitchen.id);
          return n;
        });
        toast({ title: "Access code saved" });
      } catch {
        toast({
          title: "Error",
          description: "Failed to save access code",
          variant: "destructive",
        });
      } finally {
        setSavingKitchenId(null);
      }
    },
    [codeInputs, locationId, queryClient, toast],
  );

  const handleRevokeCode = useCallback(
    async (kitchen: KitchenForAccessCode) => {
      setSavingKitchenId(kitchen.id);
      try {
        const existingConfig = kitchen.smartLockConfig || {};
        await apiPut(`/manager/kitchens/${kitchen.id}/smart-lock/config`, {
          enabled: kitchen.smartLockEnabled,
          config: {
            ...existingConfig,
            accessCode: null,
            codeSetAt: null,
          },
        });
        queryClient.invalidateQueries({
          queryKey: ["manager-kitchens-access", locationId],
        });
        setRevealedCodes((prev) => {
          const n = new Set(prev);
          n.delete(kitchen.id);
          return n;
        });
        toast({ title: "Access code revoked" });
      } catch {
        toast({
          title: "Error",
          description: "Failed to revoke code",
          variant: "destructive",
        });
      } finally {
        setSavingKitchenId(null);
      }
    },
    [locationId, queryClient, toast],
  );

  const copyCode = useCallback(
    (code: string) => {
      navigator.clipboard.writeText(code);
      toast({ title: "Copied to clipboard" });
    },
    [toast],
  );

  // Don't render anything at all when no kitchens have smart-door capability.
  // The admin must enable smart doors on at least one kitchen for this section
  // to appear.
  if (!isLoadingKitchens && !hasSmartLockKitchens) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg flex items-center justify-center bg-violet-50">
            <KeyRound className="size-5 text-violet-600" />
          </div>
          <div>
            <CardTitle className="text-lg">Smart Lock & Access Codes</CardTitle>
            <CardDescription>
              Manage access codes for kitchens with smart locks
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoadingKitchens ? (
          <div className="flex items-center gap-2 py-6 justify-center">
            <Loader2 className="size-4 animate-spin text-violet-600" />
            <span className="text-sm text-muted-foreground">
              Loading kitchens...
            </span>
          </div>
        ) : kitchensList.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-lg">
            <ChefHat className="size-8 text-muted-foreground/40 mx-auto mb-2" />
            No kitchens found at this location.
          </div>
        ) : (
          kitchensList.map((kitchen) => {
            const config = kitchen.smartLockConfig || {};
            const currentCode = config.accessCode as string | undefined;
            const codeFormat =
              (config.accessCodeFormat as "numeric" | "alphanumeric") || "numeric";
            const codeVisibility =
              (config.codeVisibility as CodeVisibility) || "at_checkin";
            const codeSetAt = config.codeSetAt as string | undefined;
            const isRevealed = revealedCodes.has(kitchen.id);
            const isSaving = savingKitchenId === kitchen.id;

            return (
              <div key={kitchen.id} className="rounded-lg border p-3 space-y-3">
                {/* Kitchen Header Row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ChefHat className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{kitchen.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor={`sl-${kitchen.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      {kitchen.smartLockEnabled ? "Enabled" : "Disabled"}
                    </Label>
                    <Switch
                      id={`sl-${kitchen.id}`}
                      checked={kitchen.smartLockEnabled}
                      onCheckedChange={(checked) =>
                        handleToggleSmartLock(kitchen, checked)
                      }
                      disabled={isSaving}
                      className="scale-90"
                    />
                  </div>
                </div>

                {kitchen.smartLockEnabled && (
                  <>
                    {/* Code Format Selector */}
                    <div className="flex items-center gap-3">
                      <Label className="text-xs text-muted-foreground shrink-0">
                        Code Type
                      </Label>
                      <Select
                        value={codeFormat}
                        onValueChange={(val) =>
                          handleUpdateCodeFormat(
                            kitchen,
                            val as "numeric" | "alphanumeric",
                          )
                        }
                        disabled={isSaving}
                      >
                        <SelectTrigger className="h-8 w-[180px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="numeric">
                            <div className="flex items-center gap-1.5">
                              <Hash className="size-3" />
                              Numeric only
                            </div>
                          </SelectItem>
                          <SelectItem value="alphanumeric">
                            <div className="flex items-center gap-1.5">
                              <KeyRound className="size-3" />
                              Alphanumeric
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Current Code Display */}
                    {currentCode && (
                      <div className="flex items-center gap-2 p-2 rounded-md bg-violet-50 border border-violet-200">
                        <Lock className="size-3.5 text-violet-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-mono font-semibold text-violet-900 tracking-wider">
                            {isRevealed
                              ? currentCode
                              : "•".repeat(currentCode.length)}
                          </span>
                          {codeSetAt && (
                            <p className="text-[10px] text-violet-600">
                              Set {new Date(codeSetAt).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => {
                              setRevealedCodes((prev) => {
                                const n = new Set(prev);
                                if (isRevealed) n.delete(kitchen.id);
                                else n.add(kitchen.id);
                                return n;
                              });
                            }}
                          >
                            {isRevealed ? (
                              <EyeOff className="size-3.5" />
                            ) : (
                              <Eye className="size-3.5" />
                            )}
                          </Button>
                          {isRevealed && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              onClick={() => copyCode(currentCode)}
                            >
                              <Copy className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Code Visibility Policy */}
                    <div className="flex items-center gap-3">
                      <Label className="text-xs text-muted-foreground shrink-0">
                        Show Code
                      </Label>
                      <Select
                        value={codeVisibility}
                        onValueChange={(val) =>
                          handleUpdateCodeVisibility(
                            kitchen,
                            val as CodeVisibility,
                          )
                        }
                        disabled={isSaving}
                      >
                        <SelectTrigger className="h-8 flex-1 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="on_booking">
                            <div className="flex items-center gap-1.5">
                              <Eye className="size-3" />
                              At booking confirmation
                            </div>
                          </SelectItem>
                          <SelectItem value="at_checkin">
                            <div className="flex items-center gap-1.5">
                              <Clock className="size-3" />
                              At check-in time only
                            </div>
                          </SelectItem>
                          <SelectItem value="manual">
                            <div className="flex items-center gap-1.5">
                              <EyeOff className="size-3" />
                              Never (share manually)
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Code Input + Actions */}
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder={
                          codeFormat === "numeric"
                            ? "Enter numeric code"
                            : "Enter access code"
                        }
                        value={codeInputs[kitchen.id] ?? ""}
                        onChange={(e) => {
                          const val =
                            codeFormat === "numeric"
                              ? e.target.value.replace(/[^0-9]/g, "")
                              : e.target.value.toUpperCase();
                          setCodeInputs((prev) => ({
                            ...prev,
                            [kitchen.id]: val,
                          }));
                        }}
                        className="h-8 text-sm font-mono flex-1"
                        disabled={isSaving}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs shrink-0"
                        onClick={() => handleSaveCode(kitchen)}
                        disabled={isSaving || !codeInputs[kitchen.id]?.trim()}
                      >
                        {isSaving ? (
                          <Loader2 className="size-3 mr-1.5 animate-spin" />
                        ) : (
                          <KeyRound className="size-3 mr-1.5" />
                        )}
                        {currentCode ? "Update" : "Set Code"}
                      </Button>
                      {currentCode && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-xs text-destructive hover:text-destructive shrink-0"
                          onClick={() => handleRevokeCode(kitchen)}
                          disabled={isSaving}
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}

        <div className="p-3 rounded-lg border border-blue-200 bg-blue-50">
          <div className="flex items-start gap-2">
            <Info className="size-3.5 text-blue-600 mt-0.5 shrink-0" />
            <p className="text-[11px] text-blue-700">
              Enter the code for your physical smart lock. Choose numeric for
              keypad-only locks, or alphanumeric for locks that support letters.
              Chefs see this code when they check in.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CheckinCheckoutSettings({
  location,
}: CheckinCheckoutSettingsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch existing settings
  const { data, isLoading } = useQuery<CheckinCheckoutSettingsData>({
    queryKey: ["checkin-checkout-settings", location.id],
    queryFn: () =>
      apiGet(`/manager/locations/${location.id}/checkin-checkout-settings`),
    enabled: !!location.id,
  });

  // Fetch kitchens to determine if ANY kitchen at this location has the
  // admin-controlled smart-door capability enabled. When none do, the smart
  // lock instructions textarea and all related UI is hidden from the manager.
  const { data: kitchensAtLocation } = useQuery<Array<{ id: number; smartLockAvailable?: boolean; smart_lock_available?: boolean }>>({
    queryKey: ["manager-kitchens-smart-availability", location.id],
    queryFn: () => apiGet(`/manager/kitchens/${location.id}`),
    enabled: !!location.id,
  });

  const hasSmartLockKitchen = useMemo(() => {
    if (!kitchensAtLocation) return false;
    return kitchensAtLocation.some((k: any) =>
      Boolean(k.smartLockAvailable ?? k.smart_lock_available ?? false),
    );
  }, [kitchensAtLocation]);

  // Kitchen check-in/out local state.
  // Items are held in a single unified list; split into server-side
  // checkinItems / checkoutItems arrays on save.
  const [checkinEnabled, setCheckinEnabled] = useState(true);
  const [checkoutEnabled, setCheckoutEnabled] = useState(true);
  const [items, setItems] = useState<UnifiedChecklistItem[]>([]);
  const [checkinInstructions, setCheckinInstructions] = useState<string | null>(
    null,
  );
  const [checkoutInstructions, setCheckoutInstructions] = useState<string | null>(
    null,
  );
  const [smartLockCheckinInstructions, setSmartLockCheckinInstructions] =
    useState<string | null>(null);

  // Time window override state (null = use platform default)
  const [twCheckinWindow, setTwCheckinWindow] = useState<number | null>(null);
  const [twNoShowGrace, setTwNoShowGrace] = useState<number | null>(null);

  // Memoized initial unified list derived from server data. Kept in a memo so
  // we can reuse it for the "isDirty" comparison below without re-running the
  // merge repeatedly.
  const initialUnifiedItems = useMemo<UnifiedChecklistItem[]>(() => {
    if (!data) return [];
    return unifyStorageToItems({
      checkinItems: (Array.isArray(data.checkinItems)
        ? data.checkinItems
        : []) as ChecklistItem[],
      checkoutItems: (Array.isArray(data.checkoutItems)
        ? data.checkoutItems
        : []) as ChecklistItem[],
      checkinPhotoRequirements: (Array.isArray(data.checkinPhotoRequirements)
        ? data.checkinPhotoRequirements
        : []) as PhotoRequirement[],
      checkoutPhotoRequirements: (Array.isArray(data.checkoutPhotoRequirements)
        ? data.checkoutPhotoRequirements
        : []) as PhotoRequirement[],
    });
  }, [data]);

  // Sync from server data
  useEffect(() => {
    if (data) {
      setCheckinEnabled(data.checkinEnabled);
      setCheckoutEnabled(data.checkoutEnabled);
      setCheckinInstructions(data.checkinInstructions);
      setCheckoutInstructions(data.checkoutInstructions);
      setSmartLockCheckinInstructions(data.smartLockCheckinInstructions);
      setItems(initialUnifiedItems);
      // Sync time window overrides
      if (data.timeWindowSettings) {
        setTwCheckinWindow(data.timeWindowSettings.checkinWindowMinutesBefore);
        setTwNoShowGrace(data.timeWindowSettings.noShowGraceMinutes);
      }
    }
  }, [data, initialUnifiedItems]);

  const isDirty = useMemo(() => {
    if (!data) return false;
    return (
      checkinEnabled !== data.checkinEnabled ||
      checkoutEnabled !== data.checkoutEnabled ||
      JSON.stringify(items) !== JSON.stringify(initialUnifiedItems) ||
      (checkinInstructions || null) !== (data.checkinInstructions || null) ||
      (checkoutInstructions || null) !== (data.checkoutInstructions || null) ||
      (smartLockCheckinInstructions || null) !==
        (data.smartLockCheckinInstructions || null) ||
      // Time window dirty check (compare against server values)
      twCheckinWindow !== (data.timeWindowSettings?.checkinWindowMinutesBefore ?? null) ||
      twNoShowGrace !== (data.timeWindowSettings?.noShowGraceMinutes ?? null)
    );
  }, [
    data,
    initialUnifiedItems,
    checkinEnabled,
    checkoutEnabled,
    items,
    checkinInstructions,
    checkoutInstructions,
    smartLockCheckinInstructions,
    twCheckinWindow,
    twNoShowGrace,
  ]);

  const validationErrors = useMemo(
    () => validateUnifiedItems(items),
    [items],
  );

  // Save — sends only kitchen check-in/out fields. Storage fields are untouched
  // because the server PUT endpoint only updates fields that were provided.
  const saveAction = useStatusButton(
    useCallback(async () => {
      if (validationErrors.length > 0) {
        throw new Error(validationErrors[0]);
      }

      const {
        checkinItems: outCheckinItems,
        checkoutItems: outCheckoutItems,
        checkinPhotoRequirements: outCheckinPhotos,
        checkoutPhotoRequirements: outCheckoutPhotos,
      } = itemsToStorage(items);

      await apiPut(
        `/manager/locations/${location.id}/checkin-checkout-settings`,
        {
          checkinEnabled,
          checkinItems: outCheckinItems,
          checkinPhotoRequirements: outCheckinPhotos,
          checkinInstructions: checkinInstructions || null,
          checkoutEnabled,
          checkoutItems: outCheckoutItems,
          checkoutPhotoRequirements: outCheckoutPhotos,
          checkoutInstructions: checkoutInstructions || null,
          smartLockCheckinInstructions: smartLockCheckinInstructions || null,
          timeWindowSettings: {
            checkinWindowMinutesBefore: twCheckinWindow,
            noShowGraceMinutes: twNoShowGrace,
          },
        },
      );

      queryClient.invalidateQueries({
        queryKey: ["checkin-checkout-settings", location.id],
      });

      toast({
        title: "Settings Saved",
        description: "Kitchen check-in/check-out checklists updated successfully.",
      });
    }, [
      location.id,
      checkinEnabled,
      checkoutEnabled,
      items,
      checkinInstructions,
      checkoutInstructions,
      smartLockCheckinInstructions,
      twCheckinWindow,
      twNoShowGrace,
      validationErrors,
      queryClient,
      toast,
    ]),
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Kitchen Check-In / Check-Out
          </h2>
          <p className="text-muted-foreground">
            Configure checklists and photo requirements for your kitchens.
          </p>
        </div>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            Loading settings...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Kitchen Check-In / Check-Out
          </h2>
          <p className="text-muted-foreground">
            Define checklists and photo requirements chefs must complete when
            using your kitchens.
          </p>
        </div>
        {isDirty && (
          <Badge
            variant="outline"
            className="text-amber-700 bg-amber-50 border-amber-200"
          >
            Unsaved changes
          </Badge>
        )}
      </div>

      {/* Info Banner */}
      <div className="flex items-start gap-3 p-3 rounded-lg border border-blue-200 bg-blue-50">
        <Info className="size-4 text-blue-600 mt-0.5 shrink-0" />
        <div className="text-xs text-blue-800 space-y-1">
          <p className="font-medium">How this works</p>
          <p>
            Configure what chefs confirm at each stage using the tabs below.
            Each item can optionally require a photo, and the same item can
            appear on both Check-In and Check-Out via the pill toggles. Hit{" "}
            <strong>Preview chef view</strong> to see exactly what the chef will
            see as a side panel.
          </p>
        </div>
      </div>

      {/* Unified Tabbed Editor */}
      <KitchenCheckinCheckoutEditor
        items={items}
        onItemsChange={setItems}
        checkinEnabled={checkinEnabled}
        onCheckinEnabledChange={setCheckinEnabled}
        checkoutEnabled={checkoutEnabled}
        onCheckoutEnabledChange={setCheckoutEnabled}
        checkinInstructions={checkinInstructions}
        onCheckinInstructionsChange={setCheckinInstructions}
        checkoutInstructions={checkoutInstructions}
        onCheckoutInstructionsChange={setCheckoutInstructions}
        smartLockInstructions={smartLockCheckinInstructions}
        onSmartLockInstructionsChange={setSmartLockCheckinInstructions}
        smartLockAvailable={hasSmartLockKitchen}
      />

      {/* Smart Lock & Access Codes */}
      <AccessCodesSection locationId={location.id} />

      {/* Time Window Overrides */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="size-5 text-amber-600" />
            Time Window Overrides
          </CardTitle>
          <CardDescription>
            Override platform defaults for when chefs can check in/out and grace periods.
            Leave blank to use platform defaults.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs">
                Check-in window (minutes before start)
                {data?.platformDefaults && (
                  <span className="text-muted-foreground ml-1">
                    (default: {data.platformDefaults.checkinWindowMinutesBefore})
                  </span>
                )}
              </Label>
              <Input
                type="number"
                min={0}
                max={120}
                placeholder={data?.platformDefaults ? String(data.platformDefaults.checkinWindowMinutesBefore) : "15"}
                value={twCheckinWindow ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setTwCheckinWindow(v === "" ? null : parseInt(v));
                }}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">
                No-show grace (minutes after start)
                {data?.platformDefaults && (
                  <span className="text-muted-foreground ml-1">
                    (default: {data.platformDefaults.noShowGraceMinutes})
                  </span>
                )}
              </Label>
              <Input
                type="number"
                min={0}
                max={120}
                placeholder={data?.platformDefaults ? String(data.platformDefaults.noShowGraceMinutes) : "30"}
                value={twNoShowGrace ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setTwNoShowGrace(v === "" ? null : parseInt(v));
                }}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            These values override the platform defaults for this location only. Leave a field blank to use the platform default.
          </p>
        </CardContent>
      </Card>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-destructive/30 bg-destructive/5">
          <AlertTriangle className="size-4 text-destructive mt-0.5 shrink-0" />
          <div className="text-xs text-destructive space-y-0.5">
            {validationErrors.map((err, i) => (
              <p key={i}>{err}</p>
            ))}
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-muted-foreground">
          {data?.id ? "Last saved" : "Not saved yet"} — applies to all kitchens at
          this location
        </p>
        <StatusButton
          status={saveAction.status}
          onClick={saveAction.execute}
          disabled={
            (!isDirty && data?.id !== null) || validationErrors.length > 0
          }
          labels={{ idle: "Save Settings", loading: "Saving", success: "Saved" }}
        />
      </div>
    </div>
  );
}
