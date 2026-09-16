/**
 * PARKED — Smart Lock & Access Codes.
 *
 * Not rendered anywhere. It was removed from the check-in/check-out page because
 * the whole section is gated on a kitchen having `smartLockAvailable`, and that
 * capability is admin-controlled and currently off for every kitchen — so the
 * section could never appear. It only ever sat in the middle of the page.
 *
 * The feature is intact and the endpoint it calls
 * (`PUT /manager/kitchens/:kitchenId/smart-lock/config`) has no other caller, so
 * re-enabling smart doors for a kitchen brings this straight back: render
 * `<AccessCodesSection locationId={location.id} />` from
 * `CheckinCheckoutSettings.tsx`.
 *
 * Before it ships again, restyle it to the current design tokens — it still uses
 * hardcoded violet and blue colour scales, and hardcoded English copy.
 */

import { useState, useCallback, useMemo } from "react";
import { mt } from "@/i18n/manager";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, KeyRound, Hash, Copy, Eye, EyeOff, Calendar, Clock, Info } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPut } from "@/lib/api";

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

export function AccessCodesSection({ locationId }: { locationId: number }) {
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
        toast({ title: enabled ? mt("smartLockEnabledToast") : mt("smartLockDisabledToast") });
      } catch {
        toast({ title: mt("error"),
          description: mt("failedToUpdateSmartLock"),
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
        toast({ title: mt("codeFormatSetTo", { format }) });
      } catch {
        toast({ title: mt("error"),
          description: mt("failedToUpdateCodeFormat"),
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
          on_booking: mt("codeShownAtBookingConfirmation"),
          at_checkin: mt("codeShownAtCheckinTime"),
          manual: mt("codeSharedManually"),
        };
        toast({ title: labels[visibility] });
      } catch {
        toast({ title: mt("error"),
          description: mt("failedToUpdateVisibility"),
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
        toast({ title: mt("enterACode"),
          description: mt("typeTheAccessCodeForThisKitchen"),
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
        toast({ title: mt("accessCodeSaved") });
      } catch {
        toast({ title: mt("error"),
          description: mt("failedToSaveAccessCode"),
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
        toast({ title: mt("accessCodeRevoked") });
      } catch {
        toast({ title: mt("error"),
          description: mt("failedToRevokeCode"),
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
      toast({ title: mt("copiedToClipboard") });
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
        <CardTitle className="text-lg">{mt("smartLockAccessCodes")}</CardTitle>
        <CardDescription>{mt("manageAccessCodesForKitchensWithSmartLocks")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoadingKitchens ? (
          <div className="flex items-center gap-2 py-6 justify-center">
            <Loader2 className="size-4 animate-spin text-violet-600" />
            <span className="text-sm text-muted-foreground">{mt("loadingKitchens")}</span>
          </div>
        ) : kitchensList.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-lg">
            <Calendar className="size-8 text-muted-foreground/40 mx-auto mb-2" />{mt("noKitchensFoundAtThisLocation")}</div>
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
                    <Calendar className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{kitchen.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor={`sl-${kitchen.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      {kitchen.smartLockEnabled ? mt("enabledLabel") : mt("disabledLabel")}
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
                      <Label className="text-xs text-muted-foreground shrink-0">{mt("codeType")}</Label>
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
                              <Hash className="size-3" />{mt("numericOnly")}</div>
                          </SelectItem>
                          <SelectItem value="alphanumeric">
                            <div className="flex items-center gap-1.5">
                              <KeyRound className="size-3" />{mt("alphanumeric")}</div>
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
                      <Label className="text-xs text-muted-foreground shrink-0">{mt("showCode")}</Label>
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
                              <Eye className="size-3" />{mt("atBookingConfirmation")}</div>
                          </SelectItem>
                          <SelectItem value="at_checkin">
                            <div className="flex items-center gap-1.5">
                              <Clock className="size-3" />{mt("atCheckInTimeOnly")}</div>
                          </SelectItem>
                          <SelectItem value="manual">
                            <div className="flex items-center gap-1.5">
                              <EyeOff className="size-3" />{mt("neverShareManually")}</div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Code Input + Actions */}
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder={
                          codeFormat === "numeric"
                            ? mt("enterNumericCode") : mt("enterAccessCode")
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
                        {currentCode ? mt("updateCode") : mt("setCode")}
                      </Button>
                      {currentCode && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-xs text-destructive hover:text-destructive shrink-0"
                          onClick={() => handleRevokeCode(kitchen)}
                          disabled={isSaving}
                        >{mt("revoke")}</Button>
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
