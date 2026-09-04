import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
/**
 * Booking Rules Settings Component
 * Manages cancellation policy, booking limits, minimum window, and overstay penalties
 */

import { useState, useEffect, useCallback } from 'react';

import { AlertCircle, Clock, Info, Loader2, Save, FileText, Upload, ChefHat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusButton } from '@/components/ui/status-button';
import { useStatusButton } from '@/hooks/use-status-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NumericInput } from '@/components/ui/numeric-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { auth } from '@/lib/firebase';
import { apiGet, apiPut } from '@/lib/api';

interface Location {
  id: number;
  name: string;
  cancellationPolicyHours?: number;
  cancellationPolicyMessage?: string;
  defaultDailyBookingLimit?: number;
  minimumBookingWindowHours?: number;
  kitchenTermsUrl?: string;
}

interface BookingRulesSettingsProps {
  location: Location;
  onSave: (updates: any) => Promise<unknown>;
}

export default function BookingRulesSettings({ location, onSave }: BookingRulesSettingsProps) {
  
  const { toast } = useToast();
  
  // Cancellation Policy State
  const [cancellationHours, setCancellationHours] = useState(location.cancellationPolicyHours || 24);
  const [cancellationMessage, setCancellationMessage] = useState(
    location.cancellationPolicyMessage || mt("cancellationPolicyDefaultMessage")
  );

  // Daily Booking Limit State
  const [dailyBookingLimit, setDailyBookingLimit] = useState(location.defaultDailyBookingLimit || 2);

  // Minimum Booking Window State
  const [minimumBookingWindowHours, setMinimumBookingWindowHours] = useState(location.minimumBookingWindowHours ?? 1);

  // Overstay Penalty Defaults State
  const [overstayGracePeriodDays, setOverstayGracePeriodDays] = useState<number | null>(null);
  const [overstayPenaltyRate, setOverstayPenaltyRate] = useState<number | null>(null);
  const [overstayMaxPenaltyDays, setOverstayMaxPenaltyDays] = useState<number | null>(null);
  const [overstayPolicyText, setOverstayPolicyText] = useState('');
  const [isLoadingPenaltyDefaults, setIsLoadingPenaltyDefaults] = useState(true);

  // Terms & Conditions State
  const [termsFile, setTermsFile] = useState<File | null>(null);
  const [isUploadingTerms, setIsUploadingTerms] = useState(false);

  // Kitchen-level Minimum Booking Duration State
  const [kitchens, setKitchens] = useState<Array<{ id: number; name: string; minimumBookingHours: number }>>([]);
  const [selectedKitchenId, setSelectedKitchenId] = useState<number | null>(null);
  const [minimumBookingHours, setMinimumBookingHours] = useState<number>(0);
  const [isLoadingKitchens, setIsLoadingKitchens] = useState(false);

  // Update state when location changes
  useEffect(() => {
    setCancellationHours(location.cancellationPolicyHours || 24);
    setCancellationMessage(
      location.cancellationPolicyMessage || mt("cancellationPolicyDefaultMessage")
    );
    setDailyBookingLimit(location.defaultDailyBookingLimit || 2);
    setMinimumBookingWindowHours(location.minimumBookingWindowHours ?? 1);
  }, [location]);

  // Fetch kitchens for this location
  const fetchKitchens = useCallback(async () => {
    if (!location.id) return;
    setIsLoadingKitchens(true);
    try {
      const data = await apiGet(`/manager/kitchens/${location.id}`);
      const mapped = (data || []).map((k: any) => ({
        id: k.id,
        name: k.name,
        minimumBookingHours: k.minimumBookingHours ?? 0,
      }));
      setKitchens(mapped);
      // Auto-select first kitchen if none selected
      if (mapped.length > 0 && !selectedKitchenId) {
        setSelectedKitchenId(mapped[0].id);
        setMinimumBookingHours(mapped[0].minimumBookingHours);
      }
    } catch (error) {
      logger.error('Error fetching kitchens:', error);
    } finally {
      setIsLoadingKitchens(false);
    }
  }, [location.id]);

  useEffect(() => {
    setSelectedKitchenId(null);
    setKitchens([]);
    setMinimumBookingHours(0);
    fetchKitchens();
  }, [location.id, fetchKitchens]);

  // When kitchen selection changes, load its minimumBookingHours
  useEffect(() => {
    if (selectedKitchenId) {
      const kitchen = kitchens.find(k => k.id === selectedKitchenId);
      if (kitchen) {
        setMinimumBookingHours(kitchen.minimumBookingHours);
      }
    }
  }, [selectedKitchenId, kitchens]);


  // Fetch overstay penalty defaults
  const fetchOverstayPenaltyDefaults = useCallback(async () => {
    if (!location.id) return;
    
    setIsLoadingPenaltyDefaults(true);
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error(tt("firebaseUserNotAvailable"));
      }

      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch(`/api/manager/locations/${location.id}/overstay-penalty-defaults`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(tt('failedToFetchOverstayDefaults'));
      }

      const data = await response.json();
      
      setOverstayGracePeriodDays(data.locationDefaults.gracePeriodDays);
      setOverstayPenaltyRate(data.locationDefaults.penaltyRate ? data.locationDefaults.penaltyRate * 100 : null);
      setOverstayMaxPenaltyDays(data.locationDefaults.maxPenaltyDays);
      setOverstayPolicyText(data.locationDefaults.policyText || '');
    } catch (error: any) {
      logger.error('Error fetching overstay penalty defaults:', error);
    } finally {
      setIsLoadingPenaltyDefaults(false);
    }
  }, [location.id]);

  useEffect(() => {
    fetchOverstayPenaltyDefaults();
  }, [fetchOverstayPenaltyDefaults]);

  const saveRulesAction = useStatusButton(
    useCallback(async () => {
      await onSave({
        locationId: location.id,
        cancellationPolicyHours: cancellationHours,
        cancellationPolicyMessage: cancellationMessage,
        defaultDailyBookingLimit: dailyBookingLimit,
        minimumBookingWindowHours: minimumBookingWindowHours,
      });
    }, [onSave, location.id, cancellationHours, cancellationMessage, dailyBookingLimit, minimumBookingWindowHours]),
  );

  const saveDurationAction = useStatusButton(
    useCallback(async () => {
      if (!selectedKitchenId) return;
      const updated = await apiPut(`/manager/kitchens/${selectedKitchenId}/pricing`, {
        minimumBookingHours: minimumBookingHours,
      });
      setKitchens(prev => prev.map(k =>
        k.id === selectedKitchenId ? { ...k, minimumBookingHours: updated.minimumBookingHours ?? minimumBookingHours } : k
      ));
      toast({ title: mt("success"), description: mt("minimumBookingDurationUpdated") });
    }, [selectedKitchenId, minimumBookingHours, toast]),
  );

  const handleSaveOverstayPenaltyDefaults = async () => {
    if (!location.id) return;

    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error(tt("firebaseUserNotAvailable"));
      }

      const token = await currentFirebaseUser.getIdToken();
      
      const payload = {
        gracePeriodDays: overstayGracePeriodDays,
        penaltyRate: overstayPenaltyRate !== null ? overstayPenaltyRate / 100 : null,
        maxPenaltyDays: overstayMaxPenaltyDays,
        policyText: overstayPolicyText || null,
      };

      const response = await fetch(`/api/manager/locations/${location.id}/overstay-penalty-defaults`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save overstay penalty defaults');
      }

      toast({ title: mt("success"),
        description: mt("overstayPenaltyDefaultsUpdatedSuccessfully"),
      });
    } catch (error: any) {
      logger.error('Error saving overstay penalty defaults:', error);
      toast({ title: mt("error"),
        description: error.message || tt("failedToSaveOverstayPenalty"),
        variant: "destructive"
      });
    }
  };

  const handleUploadTerms = async () => {
    if (!termsFile) return;

    setIsUploadingTerms(true);
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error(tt("firebaseUserNotAvailable"));
      }

      const token = await currentFirebaseUser.getIdToken();

      const formData = new FormData();
      formData.append('file', termsFile);

      const response = await fetch('/api/files/upload-file', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to upload terms');
      }

      const result = await response.json();
      const termsUrl = result.url;

      const updateResponse = await fetch(`/api/manager/locations/${location.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          kitchenTermsUrl: termsUrl,
        }),
      });

      if (!updateResponse.ok) {
        const errorData = await updateResponse.json();
        throw new Error(errorData.error || 'Failed to update terms');
      }

      toast({ title: mt("termsUploaded"),
        description: mt("yourTermsAndConditionsHaveBeenUploadedSuccessfully"),
      });

      setTermsFile(null);
    } catch (error: any) {
      logger.error('Terms upload error:', error);
      toast({ title: mt("uploadFailed"),
        description: error.message || tt("failedToUploadTermsDoc"),
        variant: "destructive",
      });
    } finally {
      setIsUploadingTerms(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{mt("navBookingRules")}</h2>
        <p className="text-muted-foreground">{mt("configureCancellationPoliciesBookingLimitsAndPenaltiesForYou")}</p>
      </div>

      {/* Unified Booking Policies & Limits — Cancellation Policy + Daily Limit + Min Window */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-blue-600" />
            <div>
              <CardTitle className="text-lg">{mt("bookingPoliciesLimits")}</CardTitle>
              <CardDescription>{mt("cancellationPolicyDailyBookingLimitAndMinimumAdvanceNoticeOn")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {/* Cancellation Policy */}
          <div className="space-y-4 px-6 pb-6 pt-0">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-blue-600" />{mt("cancellationPolicy")}</h3>
              <p className="text-xs text-muted-foreground mt-1">{mt("configureWhenChefsCanCancelTheirBookings")}</p>
            </div>
            <div>
              <Label htmlFor="cancellation-hours">{mt("cancellationWindow")}</Label>
              <NumericInput
                id="cancellation-hours"
                suffix={mt("hoursSuffix")}
                value={String(cancellationHours)}
                onValueChange={(val) => setCancellationHours(parseInt(val) || 0)}
                className="mt-1.5 max-w-xs"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {mt("minimumHoursBeforeCancellationAllowed")}
              </p>
            </div>
            <div>
              <Label htmlFor="cancellation-message">{mt("policyMessage")}</Label>
              <Textarea
                id="cancellation-message"
                value={cancellationMessage}
                onChange={(e) => setCancellationMessage(e.target.value)}
                rows={3}
                className="mt-1.5"
                placeholder={mt("cancellationPolicyDefaultMessage")}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {mt("useHoursAsPlaceholder", { hours: "{hours}" })}
              </p>
            </div>
          </div>

          {/* Daily Booking Limit */}
          <div className="space-y-4 px-6 py-6">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-green-600" />{mt("dailyBookingLimit")}</h3>
              <p className="text-xs text-muted-foreground mt-1">{mt("maximumHoursAChefCanBookPerDay")}</p>
            </div>
            <div>
              <Label htmlFor="daily-limit">{mt("defaultHoursPerChefPerDay")}</Label>
              <NumericInput
                id="daily-limit"
                suffix={mt("hoursSuffix")}
                value={String(dailyBookingLimit)}
                onValueChange={(val) => setDailyBookingLimit(parseInt(val) || 2)}
                className="mt-1.5 max-w-xs"
              />
              <p className="text-xs text-muted-foreground mt-1">{mt("maximumHoursAChefCanBookInASingleDay124Hours")}</p>
            </div>
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-600 mt-0.5" />
                <p className="text-xs text-blue-800">{mt("youCanOverrideThisLimitForSpecificDatesInTheAvailabilityCale")}</p>
              </div>
            </div>
          </div>

          {/* Minimum Booking Window */}
          <div className="space-y-4 px-6 py-6">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-orange-600" />{mt("minimumBookingWindow")}</h3>
              <p className="text-xs text-muted-foreground mt-1">{mt("minimumAdvanceNoticeRequiredForBookings")}</p>
            </div>
            <div>
              <Label htmlFor="min-window">{mt("minimumHoursInAdvance")}</Label>
              <NumericInput
                id="min-window"
                suffix={mt("hoursSuffix")}
                value={String(minimumBookingWindowHours)}
                onValueChange={(val) => {
                  const parsed = parseInt(val, 10);
                  setMinimumBookingWindowHours(isNaN(parsed) ? 0 : Math.min(168, Math.max(0, parsed)));
                }}
                className="mt-1.5 max-w-xs"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {mt("chefsMustBookAtLeastHours")}
              </p>
            </div>
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-600 mt-0.5" />
                <p className="text-xs text-blue-800">{mt("exampleWith1HourIfItS100PMChefsCanOnlyBookTimesStartingFrom2")}</p>
              </div>
            </div>
          </div>

          {/* Single save button applies to all three subsections above */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-6 py-4 bg-muted/30">
            <p className="text-xs text-muted-foreground">{mt("savesCancellationPolicyDailyBookingLimitAndMinimumBookingWin")}</p>
            <StatusButton
              status={saveRulesAction.status}
              onClick={saveRulesAction.execute}
              labels={{ idle: mt("saveBookingRules"), loading: mt("savingShort"), success: mt("saved") }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Minimum Booking Duration (per-kitchen) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <ChefHat className="h-5 w-5 text-violet-600" />
            <div>
              <CardTitle className="text-lg">{mt("minimumBookingDuration")}</CardTitle>
              <CardDescription>{mt("setTheMinimumHoursRequiredPerBookingForEachKitchen")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingKitchens ? (
            <div className="flex items-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
              <span className="text-sm text-muted-foreground">{mt("loadingKitchens")}</span>
            </div>
          ) : kitchens.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">{mt("noKitchensFoundForThisLocationCreateAKitchenFirst")}</div>
          ) : (
            <>
              <div>
                <Label htmlFor="kitchen-selector">{mt("selectKitchen")}</Label>
                <Select
                  value={selectedKitchenId?.toString() || ''}
                  onValueChange={(value) => setSelectedKitchenId(parseInt(value, 10))}
                >
                  <SelectTrigger id="kitchen-selector" className="mt-1.5 max-w-xs">
                    <SelectValue placeholder={mt("selectAKitchen")} />
                  </SelectTrigger>
                  <SelectContent>
                    {kitchens.map((kitchen) => (
                      <SelectItem key={kitchen.id} value={kitchen.id.toString()}>
                        {kitchen.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedKitchenId && (
                <>
                  <div>
                    <Label htmlFor="min-booking-duration">{mt("minimumHoursPerBooking")}</Label>
                    <NumericInput
                      id="min-booking-duration"
                      suffix="hours"
                      value={String(minimumBookingHours)}
                      onValueChange={(val) => {
                        const parsed = parseInt(val, 10);
                        if (val === '' || isNaN(parsed)) {
                          setMinimumBookingHours(0);
                        } else {
                          setMinimumBookingHours(Math.min(24, Math.max(0, parsed)));
                        }
                      }}
                      className="mt-1.5 max-w-xs"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Minimum number of hours a chef must book per session (0 = no restriction, max 24)
                    </p>
                  </div>
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <Info className="h-4 w-4 text-blue-600 mt-0.5" />
                      <p className="text-xs text-blue-800">{mt("thisSettingIsPerKitchenChefsWillNotBeAbleToSubmitABookingWit")}</p>
                    </div>
                  </div>
                  <StatusButton
                    status={saveDurationAction.status}
                    onClick={saveDurationAction.execute}
                    labels={{ idle: mt("saveDuration"), loading: mt("savingShort"), success: mt("saved") }}
                  />
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Terms & Conditions */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-purple-600" />
            <div>
              <CardTitle className="text-lg">{mt("termsConditions")}</CardTitle>
              <CardDescription>{mt("uploadTermsThatChefsMustAgreeToWhenBooking")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {location.kitchenTermsUrl && (
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-500" />
                <span className="text-sm">{mt("currentTermsDocumentUploaded")}</span>
              </div>
              <a
                href={location.kitchenTermsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:text-blue-700"
              >{mt("viewDocument")}</a>
            </div>
          )}

          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-gray-400 transition-colors">
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setTermsFile(file);
                }
              }}
              className="hidden"
              id="terms-upload"
              disabled={isUploadingTerms}
            />
            <label
              htmlFor="terms-upload"
              className={`flex flex-col items-center justify-center cursor-pointer ${isUploadingTerms ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Upload className="h-8 w-8 text-gray-400 mb-2" />
              <span className="text-sm font-medium text-gray-700 mb-1">
                {termsFile ? termsFile.name : 'Click to upload terms & conditions'}
              </span>
              <span className="text-xs text-gray-500">{mt("pDFOnlyMax5MB")}</span>
            </label>
          </div>

          {termsFile && (
            <Button onClick={handleUploadTerms} disabled={isUploadingTerms}>
              {isUploadingTerms ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />{mt("uploading")}</>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />{mt("uploadTerms")}</>
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Overstay Penalty Defaults */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <div>
              <CardTitle className="text-lg">{mt("storageOverstayPenaltyDefaults")}</CardTitle>
              <CardDescription>{mt("configureDefaultPenaltySettingsForStorageOverstays")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingPenaltyDefaults ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-red-600" />
              <span className="ml-2 text-sm text-muted-foreground">{mt("loadingPenaltySettings")}</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="grace-period">{mt("gracePeriod")}</Label>
                  <NumericInput
                    id="grace-period"
                    suffix="days"
                    value={overstayGracePeriodDays != null ? String(overstayGracePeriodDays) : ''}
                    onValueChange={(val) => {
                      setOverstayGracePeriodDays(val === '' ? null : parseInt(val));
                    }}
                    placeholder={mt("platformDefault")}
                    className="mt-1.5"
                  />
                  <p className="text-xs text-muted-foreground mt-1">{mt("daysBeforePenaltiesApply014")}</p>
                </div>

                <div>
                  <Label htmlFor="penalty-rate">{mt("penaltyRate")}</Label>
                  <NumericInput
                    id="penalty-rate"
                    suffix="%"
                    value={overstayPenaltyRate != null ? String(overstayPenaltyRate) : ''}
                    onValueChange={(val) => {
                      setOverstayPenaltyRate(val === '' ? null : parseInt(val));
                    }}
                    placeholder={mt("platformDefault")}
                    className="mt-1.5"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    % of daily rate per day (0-50%)
                  </p>
                </div>

                <div>
                  <Label htmlFor="max-penalty">{mt("maxPenaltyDays")}</Label>
                  <NumericInput
                    id="max-penalty"
                    suffix="days"
                    value={overstayMaxPenaltyDays != null ? String(overstayMaxPenaltyDays) : ''}
                    onValueChange={(val) => {
                      setOverstayMaxPenaltyDays(val === '' ? null : parseInt(val));
                    }}
                    placeholder={mt("platformDefault")}
                    className="mt-1.5"
                  />
                  <p className="text-xs text-muted-foreground mt-1">{mt("maxDaysToChargePenalties190")}</p>
                </div>
              </div>

              <div>
                <Label htmlFor="policy-text">{mt("policyTextOptional")}</Label>
                <Textarea
                  id="policy-text"
                  value={overstayPolicyText}
                  onChange={(e) => setOverstayPolicyText(e.target.value)}
                  rows={3}
                  className="mt-1.5"
                  placeholder={mt("customPolicyTextShownToChefsRegardingOverstayPenalties")}
                />
              </div>

              <Button onClick={handleSaveOverstayPenaltyDefaults} variant="destructive">
                <Save className="mr-2 h-4 w-4" />{mt("savePenaltyDefaults")}</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
