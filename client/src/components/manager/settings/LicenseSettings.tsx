import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
/**
 * Kitchen License — manager settings.
 *
 * The page has exactly one job: tell the manager whether their license is good, and
 * give them one obvious way to fix it. Everything below follows from two rules.
 *
 *   1. All state comes from `shared/kitchen-license.ts`. The page does not re-derive
 *      "is this expired" — a second copy of that rule is how the old page ended up
 *      painting an "Expired" badge while the listing kept taking bookings.
 *
 *   2. The upload form is not furniture. It opens when there is something to do
 *      (nothing on file, rejected, expired) or when the manager asks for it, and it is
 *      otherwise closed. The previous version hard-coded `shouldShowUpload = true`, so
 *      an approved, healthy license still sat above a permanent "Submit Updated
 *      License" form — which is why the page read as unfinished.
 *
 * Dates are rendered through `parseLicenseDate`, never `new Date("YYYY-MM-DD")`. The
 * old page showed "3/2/2026" for a license the database records as expiring on
 * March 3rd, because a date-only string parses as UTC midnight and then renders in
 * America/St_Johns (UTC-3:30).
 */

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  FileText,
  Upload,
  CheckCircle,
  Clock,
  ExternalLink,
  Loader2,
  Calendar as CalendarIcon,
  ShieldCheck,
  FileWarning,
  AlertTriangle,
  Info,
  Pencil,
  X,
} from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { getDocumentFilename } from "@/lib/formatters";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SettingsFileUpload } from "./SettingsFileUpload";
import { AuthenticatedDocumentLink } from "./AuthenticatedDocumentLink";
import { ChefPageHeader } from "@/components/chef/ui";
import {
  daysUntilExpiry,
  isReplacementUnderReview,
  kitchenLicenseState,
  licenseAllowsBookings,
  licenseHasNoExpiryDate,
  parseLicenseDate,
  type KitchenLicenseFields,
  type KitchenLicenseState,
} from "@shared/kitchen-license";

interface Location extends KitchenLicenseFields {
  id: number;
  name: string;
  kitchenLicenseFeedback?: string | null;
  kitchenLicenseUploadedAt?: string | null;
  kitchenLicensePendingSubmittedAt?: string | null;
}

interface LicenseSettingsProps {
  location: Location;
  onRefresh: () => void;
}

/** States where there is nothing usable on file, so the form opens itself. */
const NEEDS_ACTION: KitchenLicenseState[] = ["not_uploaded", "rejected", "expired"];

const TONE = {
  neutral: { box: "border-border bg-muted/40", text: "text-foreground", icon: "text-muted-foreground" },
  info: { box: "border-blue-200 bg-blue-50/70", text: "text-blue-900", icon: "text-blue-600" },
  good: { box: "border-emerald-200 bg-emerald-50/70", text: "text-emerald-900", icon: "text-emerald-600" },
  warn: { box: "border-amber-200 bg-amber-50/70", text: "text-amber-900", icon: "text-amber-600" },
  bad: { box: "border-red-200 bg-red-50/70", text: "text-red-900", icon: "text-red-600" },
} as const;

type Tone = keyof typeof TONE;

export default function LicenseSettings({ location, onRefresh }: LicenseSettingsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [licenseExpiryDate, setLicenseExpiryDate] = useState("");
  const [isUploadingLicense, setIsUploadingLicense] = useState(false);
  const [dateOnly, setDateOnly] = useState(false);

  const state = kitchenLicenseState(location);
  const needsAction = NEEDS_ACTION.includes(state);
  const daysLeft = daysUntilExpiry(location.kitchenLicenseExpiry);
  const replacementQueued = isReplacementUnderReview(location);
  const missingExpiry = licenseHasNoExpiryDate(location);
  const listingLive = licenseAllowsBookings(location);
  /** Something of theirs is already with us — replacing it again is not the next step. */
  const underReview = state === "under_review" || replacementQueued;

  const [panelOpen, setPanelOpen] = useState(needsAction);

  // Open the form when the data arrives in a state that needs one. Deliberately
  // one-directional: never force it closed, or it would slam shut while a manager is
  // filling it in.
  useEffect(() => {
    if (needsAction) setPanelOpen(true);
  }, [needsAction]);

  const expiryLabel = licenseExpiryDate
    ? format(parseLicenseDate(licenseExpiryDate) as Date, "PPP")
    : mt("licenseExpirationDate");

  const countdown =
    daysLeft === null
      ? mt("licenseNoExpiryDate")
      : daysLeft < 0
        ? mt("licenseExpiredDaysAgo", { count: Math.abs(daysLeft) })
        : daysLeft === 0
          ? mt("licenseExpiresToday")
          : mt("licenseDaysLeft", { count: daysLeft });

  // The single sentence that explains the current state. Replaces the four scattered
  // banners the page used to stack.
  const banner: { tone: Tone; icon: typeof Info; title: string; body?: string } = (() => {
    switch (state) {
      case "not_uploaded":
        return {
          tone: "neutral",
          icon: FileWarning,
          title: mt("licenseUploadToStartBookings"),
          body: mt("licenseWhyRequired"),
        };
      case "under_review":
        return {
          tone: "info",
          icon: Clock,
          title: mt("yourLicenseIsPendingAdminReviewYouLlBeNotifiedOnceItSApprove"),
          body: mt("licenseReviewTimeline"),
        };
      case "rejected":
        return {
          tone: "bad",
          icon: AlertTriangle,
          title: mt("licenseCouldNotApprove"),
          // The banner title already says this is a rejection, so the reviewer's words
          // are shown as they were written rather than behind a "Rejection Reason:" tag.
          body: location.kitchenLicenseFeedback || undefined,
        };
      case "expired":
        return {
          tone: "bad",
          icon: AlertTriangle,
          title: mt("licenseListingPaused"),
          body: location.kitchenLicenseExpiry
            ? mt("licenseExpiredOn", { date: format(parseLicenseDate(location.kitchenLicenseExpiry) as Date, "PPP") })
            : undefined,
        };
      case "expiring_soon":
        return {
          tone: "warn",
          icon: AlertTriangle,
          title: mt("licenseExpiringSoonTitle"),
          body: mt("licenseExpiringSoonBody", { count: daysLeft ?? 0 }),
        };
      default:
        return {
          tone: "good",
          icon: CheckCircle,
          title: mt("yourLicenseIsValidAndApprovedBookingsAreActive"),
        };
    }
  })();

  const BannerIcon = banner.icon;
  const tone = TONE[banner.tone];

  /** One write path for both the full upload and the date-only repair. */
  const putLicense = async (payload: Record<string, string>) => {
    const currentFirebaseUser = auth.currentUser;
    if (!currentFirebaseUser) throw new Error(tt("firebaseUserNotAvailable"));
    const token = await currentFirebaseUser.getIdToken();

    const response = await fetch(`/api/manager/locations/${location.id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || mt("uploadFailed"));
    }
  };

  const handleLicenseUpload = async () => {
    if (!licenseExpiryDate) {
      toast({
        title: mt("expirationDateRequired"),
        description: mt("pleaseProvideAnExpirationDateForTheLicense"),
        variant: "destructive",
      });
      return;
    }

    setIsUploadingLicense(true);
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) throw new Error(tt("firebaseUserNotAvailable"));
      const token = await currentFirebaseUser.getIdToken();

      const formData = new FormData();
      formData.append("file", licenseFile as File);

      const uploadResponse = await fetch("/api/files/upload-file", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
        body: formData,
      });

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to upload license");
      }

      const { url: licenseUrl } = await uploadResponse.json();

      // No kitchenLicenseStatus — the server decides 'pending' vs 'pending_update'
      // from what is already on file.
      await putLicense({ kitchenLicenseUrl: licenseUrl, kitchenLicenseExpiry: licenseExpiryDate });

      queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
      queryClient.invalidateQueries({ queryKey: ["locationDetails", location.id] });
      onRefresh();

      toast({
        title: location.kitchenLicenseUrl ? mt("licenseUpdateSubmitted") : mt("licenseUploaded"),
        description: location.kitchenLicenseUrl
          ? mt("licenseUpdatedSubmittedDesc")
          : mt("licenseSubmittedForApprovalDesc"),
      });

      setLicenseFile(null);
      setLicenseExpiryDate("");
      setPanelOpen(false);
      setDateOnly(false);
    } catch (error: any) {
      logger.error("License upload error:", error);
      toast({
        title: mt("uploadFailed"),
        description: error.message || tt("failedToUploadLicense"),
        variant: "destructive",
      });
    } finally {
      setIsUploadingLicense(false);
    }
  };

  const handleExpiryOnly = async () => {
    if (!licenseExpiryDate) return;
    setIsUploadingLicense(true);
    try {
      await putLicense({ kitchenLicenseExpiry: licenseExpiryDate });
      queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
      queryClient.invalidateQueries({ queryKey: ["locationDetails", location.id] });
      onRefresh();
      toast({ title: mt("licenseExpirationDateHasBeenAddedSuccessfully") });
      setLicenseExpiryDate("");
      setPanelOpen(false);
      setDateOnly(false);
    } catch (error: any) {
      logger.error("License expiry update error:", error);
      toast({ title: mt("uploadFailed"), description: error.message, variant: "destructive" });
    } finally {
      setIsUploadingLicense(false);
    }
  };

  const openPanel = (mode: "upload" | "dateOnly") => {
    setDateOnly(mode === "dateOnly");
    setPanelOpen(true);
  };

  const pill: { label: string; variant: "success" | "warning" | "destructive" | "info" | "outline" } = (() => {
    switch (state) {
      case "active":
        return { label: mt("approved"), variant: "success" };
      case "expiring_soon":
        return { label: mt("expiringSoon"), variant: "warning" };
      case "expired":
        return { label: mt("expired"), variant: "destructive" };
      case "rejected":
        return { label: mt("rejected"), variant: "destructive" };
      case "under_review":
        return { label: mt("pendingReview"), variant: "info" };
      default:
        return { label: mt("notUploaded"), variant: "outline" };
    }
  })();

  // Panel copy varies by why it was opened, not by a generic "upload" label.
  const panelTitle = dateOnly
    ? mt("licenseAddExpiryDate")
    : state === "not_uploaded"
      ? mt("uploadLicense")
      : state === "expired"
        ? mt("licenseRenewLicense")
        : mt("uploadNewLicense");

  // Whether the listing keeps taking bookings is a fact about the live licence, not
  // about which panel happens to be open — so ask the shared helper instead of
  // assuming. The old copy promised bookings would continue under a rejected or
  // expired licence, which the booking gate does not honour.
  const panelHint = dateOnly
    ? mt("licenseWhyRequired")
    : state === "not_uploaded"
      ? undefined
      : state === "under_review"
        ? mt("licenseReplacesQueuedSubmission")
        : listingLive
          ? mt("submittingNewLicenseKeepsCurrentActive")
          : mt("licenseStaysPausedUntilApproved");

  const submitLabel = dateOnly ? mt("saveExpiryDate") : mt("licenseSubmitForReview");

  // Stated reason rather than a silently dead button.
  const blockedReason = !licenseExpiryDate
    ? mt("licenseNeedDate")
    : !dateOnly && !licenseFile
      ? mt("licenseNeedFile")
      : null;

  return (
    <div className="space-y-6">
      <ChefPageHeader
        title={mt("kitchenLicense")}
        description={mt("uploadAndManageYourKitchenLicenseDocumentAValidLicenseIsRequ")}
      />

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-4">
            <CardTitle className="text-lg">{mt("licenseStatus")}</CardTitle>
            <Badge variant={pill.variant}>{pill.label}</Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* The one explanation of the current state */}
          <div className={`flex items-start gap-3 rounded-xl border p-3.5 ${tone.box}`}>
            <BannerIcon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.icon}`} />
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${tone.text}`}>{banner.title}</p>
              {banner.body && <p className={`mt-0.5 text-xs leading-relaxed ${tone.text} opacity-90`}>{banner.body}</p>}
            </div>
          </div>

          {/* The document on file — the hero of the page */}
          {location.kitchenLicenseUrl && (
            <div className="rounded-xl border p-3.5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-background">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </span>

                <div className="min-w-0 flex-1">
                  {/* The filename owns the full width of the row; the actions sit on the
                      meta line beneath it. Side by side, two buttons squeezed a long
                      document name down to an ellipsis in the middle of a word. */}
                  <p className="truncate text-sm font-medium">
                    {getDocumentFilename(location.kitchenLicenseUrl) || mt("licenseFile")}
                  </p>

                  <div className="mt-0.5 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <p className="min-w-0 truncate text-xs text-muted-foreground">
                      {location.kitchenLicenseExpiry ? (
                        <>
                          {mt("licenseExpiresOn", {
                            date: format(parseLicenseDate(location.kitchenLicenseExpiry) as Date, "PPP"),
                          })}
                          {/* A rejected document has no validity left to count down — the
                              date it carries is just what was printed on it. */}
                          {state !== "rejected" && (
                            <>
                              {" · "}
                              <span
                                className={
                                  state === "expired"
                                    ? "font-medium text-red-600"
                                    : state === "expiring_soon"
                                      ? "font-medium text-amber-600"
                                      : ""
                                }
                              >
                                {countdown}
                              </span>
                            </>
                          )}
                        </>
                      ) : (
                        mt("licenseNoExpiryDate")
                      )}
                    </p>

                    <div className="flex shrink-0 items-center gap-1 sm:justify-end">
                      <AuthenticatedDocumentLink
                        url={location.kitchenLicenseUrl}
                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        {mt("viewDocument")}
                        <ExternalLink className="h-3 w-3" />
                      </AuthenticatedDocumentLink>

                      {!panelOpen && !dateOnly && !underReview && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="!min-h-0 !min-w-0 h-7 gap-1 whitespace-nowrap px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={() => openPanel("upload")}
                        >
                          <Pencil className="h-3 w-3" />
                          {state === "expired" ? mt("licenseRenewLicense") : mt("licenseReplaceLicense")}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* A replacement is queued. Say plainly what that does to bookings. */}
          {replacementQueued && (
            <div className="flex items-start gap-3 rounded-xl border border-dashed p-3.5">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{mt("licenseReplacementUnderReview")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {location.kitchenLicensePendingSubmittedAt &&
                    `${mt("licenseSubmittedOn", {
                      date: format(new Date(location.kitchenLicensePendingSubmittedAt), "PPP"),
                    })} · `}
                  {location.kitchenLicensePendingExpiry
                    ? mt("licenseExpiresOn", {
                        date: format(parseLicenseDate(location.kitchenLicensePendingExpiry) as Date, "PPP"),
                      })
                    : mt("licenseNoExpiryDate")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {listingLive ? mt("licenseKeepsListingLive") : mt("licenseStaysPausedUntilApproved")}
                </p>
              </div>
            </div>
          )}

          {/* An approved license with no date can never warn or expire — offer the repair */}
          {missingExpiry && !panelOpen && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed p-3.5">
              <div className="flex items-start gap-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">{mt("licenseAddExpiryDateHint")}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="!min-h-0 !min-w-0 h-7 shrink-0 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => openPanel("dateOnly")}
              >
                {mt("licenseAddExpiryDate")}
              </Button>
            </div>
          )}

          {/* The form — only ever mounted when there is an action to take */}
          {panelOpen && (
            <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{panelTitle}</p>
                  {panelHint && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{panelHint}</p>}
                </div>
                {/* No dismiss when the state needs action: closing this would leave the
                    page with nothing to do and no way back to the form. */}
                {!needsAction && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="!min-h-0 !min-w-0 h-7 w-7 shrink-0 p-0 text-muted-foreground hover:bg-muted"
                    aria-label={mt("cancel")}
                    onClick={() => {
                      setPanelOpen(false);
                      setDateOnly(false);
                      setLicenseFile(null);
                      setLicenseExpiryDate("");
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="license-expiry">{mt("licenseExpirationDate")}</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      {/* variant=outline would otherwise inherit chefOutlineCtaClass —
                          a pill with a drop shadow and a hover lift, i.e. the marketing
                          CTA from the kitchen preview page. This is a form field, so
                          cancel it back to a plain input-height control. */}
                      <Button
                        id="license-expiry"
                        type="button"
                        variant="outline"
                        className="h-11 w-full justify-start gap-2 rounded-lg px-3 font-normal shadow-none hover:translate-y-0 hover:bg-muted hover:shadow-none"
                      >
                        <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className={licenseExpiryDate ? "" : "text-muted-foreground"}>{expiryLabel}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={parseLicenseDate(licenseExpiryDate) ?? undefined}
                        onSelect={(date) => setLicenseExpiryDate(date ? format(date, "yyyy-MM-dd") : "")}
                        // Recording the date printed on a document that is already expired
                        // is the whole point of the repair flow, so the past-date guard
                        // only applies when a new licence is being uploaded.
                        disabled={dateOnly ? undefined : (date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                        initialFocus
                        className="w-[280px] p-3"
                      />
                    </PopoverContent>
                  </Popover>
                  <p className="text-[10px] leading-snug text-muted-foreground/80">{mt("licenseDatePrintedOnDocument")}</p>
                </div>

                {!dateOnly && (
                  <div className="space-y-1.5">
                    <Label htmlFor="license-upload">{mt("licenseFile")}</Label>
                    <SettingsFileUpload
                      id="license-upload"
                      accept=".pdf,.jpg,.jpeg,.png"
                      file={licenseFile}
                      label={mt("chooseLicenseDocument")}
                      hint={mt("pDFJPGOrPNGMax5MB")}
                      disabled={isUploadingLicense}
                      onChange={setLicenseFile}
                    />
                  </div>
                )}
              </div>

              {/* Footer: the reason it is disabled lives next to the button, so the
                  action never appears or dies without explanation. */}
              <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                {blockedReason && <p className="text-xs text-muted-foreground">{blockedReason}</p>}
                <Button
                  className="w-full shrink-0 sm:w-auto"
                  onClick={dateOnly ? handleExpiryOnly : handleLicenseUpload}
                  disabled={isUploadingLicense || !!blockedReason}
                >
                  {isUploadingLicense ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {mt("uploading")}
                    </>
                  ) : (
                    <>
                      {dateOnly ? <ShieldCheck className="mr-2 h-4 w-4" /> : <Upload className="mr-2 h-4 w-4" />}
                      {submitLabel}
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
