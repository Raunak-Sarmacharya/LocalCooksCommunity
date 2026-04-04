import { logger } from "@/lib/logger";
import { useState, useEffect, useCallback } from "react";
import { auth } from "@/lib/firebase";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Loader2,
  MapPin,
  ChefHat,
  Building2,
  Users,
  Clock,
  Mail,
  CreditCard,
  Package,
  Snowflake,
  Thermometer,
  FileText,
  Shield,
  Image,
  Calendar,
  Wrench,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";

interface LocationDetailSheetProps {
  locationId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatCents(cents: number | string | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const num = typeof cents === "string" ? parseFloat(cents) : cents;
  if (isNaN(num)) return "—";
  return `$${(num / 100).toFixed(2)}`;
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function LocationDetailSheet({ locationId, open, onOpenChange }: LocationDetailSheetProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetails = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const currentUser = auth.currentUser;
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (currentUser) {
        const token = await currentUser.getIdToken();
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch(`/api/admin/locations/${id}/full-details`, {
        credentials: "include",
        headers,
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }
      const result = await response.json();
      setData(result);
    } catch (err: any) {
      logger.error("Error loading location details:", err);
      setError(err.message || "Failed to load details");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && locationId) {
      loadDetails(locationId);
    }
    if (!open) {
      setData(null);
      setError(null);
    }
  }, [open, locationId, loadDetails]);

  const location = data?.location;
  const manager = data?.manager;
  const requirements = data?.requirements;
  const kitchensList = data?.kitchens || [];
  const summary = data?.summary;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-2xl w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            {loading ? "Loading..." : location?.name || "Location Details"}
          </SheetTitle>
          <SheetDescription>
            Full details from database — kitchens, equipment, storage, availability
          </SheetDescription>
        </SheetHeader>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="py-8 text-center">
            <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {data && !loading && (
          <div className="space-y-6 mt-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold">{summary?.totalKitchens || 0}</p>
                <p className="text-xs text-muted-foreground">Kitchens ({summary?.activeKitchens || 0} active)</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold">{summary?.totalEquipment || 0}</p>
                <p className="text-xs text-muted-foreground">Equipment</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold">{summary?.totalStorage || 0}</p>
                <p className="text-xs text-muted-foreground">Storage Units</p>
              </div>
            </div>

            <Tabs defaultValue="location" className="space-y-4">
              <TabsList className="w-full">
                <TabsTrigger value="location" className="flex-1">Location</TabsTrigger>
                <TabsTrigger value="manager" className="flex-1">Manager</TabsTrigger>
                <TabsTrigger value="kitchens" className="flex-1">Kitchens ({kitchensList.length})</TabsTrigger>
              </TabsList>

              {/* ── LOCATION TAB ── */}
              <TabsContent value="location" className="space-y-4">
                <LocationInfoSection location={location} />
                <Separator />
                <BookingRulesSection location={location} />
                <Separator />
                <LicenseSection location={location} />
                {requirements && (
                  <>
                    <Separator />
                    <RequirementsSection requirements={requirements} />
                  </>
                )}
              </TabsContent>

              {/* ── MANAGER TAB ── */}
              <TabsContent value="manager" className="space-y-4">
                {manager ? (
                  <ManagerInfoSection manager={manager} location={location} />
                ) : (
                  <div className="py-8 text-center">
                    <Users className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No manager assigned to this location</p>
                  </div>
                )}
              </TabsContent>

              {/* ── KITCHENS TAB ── */}
              <TabsContent value="kitchens" className="space-y-4">
                {kitchensList.length === 0 ? (
                  <div className="py-8 text-center">
                    <ChefHat className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No kitchens at this location</p>
                  </div>
                ) : (
                  kitchensList.map((kitchen: any) => (
                    <KitchenDetailCard key={kitchen.id} kitchen={kitchen} />
                  ))
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ──── LOCATION INFO ────
function LocationInfoSection({ location }: { location: any }) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold flex items-center gap-1.5">
        <MapPin className="h-4 w-4 text-primary" /> General Info
      </h4>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Field label="Name" value={location.name} />
        <Field label="Address" value={location.address} />
        <Field label="Timezone" value={location.timezone} />
        <Field label="Description" value={location.description} />
        <Field label="Contact Email" value={location.contactEmail} />
        <Field label="Contact Phone" value={location.contactPhone} />
        <Field label="Notification Email" value={location.notificationEmail} />
        <Field label="Notification Phone" value={location.notificationPhone} />
        <Field label="Preferred Contact" value={location.preferredContactMethod} />
        <Field label="Created" value={formatDate(location.createdAt)} />
      </div>
      {(location.logoUrl || location.brandImageUrl) && (
        <div className="flex gap-3 mt-2">
          {location.logoUrl && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Logo</p>
              <a href={getR2ProxyUrl(location.logoUrl)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
                <Image className="h-3 w-3" /> View <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          {location.brandImageUrl && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Brand Image</p>
              <a href={getR2ProxyUrl(location.brandImageUrl)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
                <Image className="h-3 w-3" /> View <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ──── BOOKING RULES ────
function BookingRulesSection({ location }: { location: any }) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold flex items-center gap-1.5">
        <Calendar className="h-4 w-4 text-primary" /> Booking Rules
      </h4>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Field label="Daily Booking Limit" value={location.defaultDailyBookingLimit} />
        <Field label="Min Booking Window" value={`${location.minimumBookingWindowHours}h`} />
        <Field label="Cancellation Policy" value={`${location.cancellationPolicyHours}h`} />
      </div>
      {location.cancellationPolicyMessage && (
        <p className="text-xs text-muted-foreground bg-muted p-2 rounded-md">{location.cancellationPolicyMessage}</p>
      )}
      {(location.overstayGracePeriodDays || location.overstayPenaltyRate) && (
        <>
          <h4 className="text-sm font-semibold flex items-center gap-1.5 pt-2">
            <Clock className="h-4 w-4 text-amber-600" /> Overstay Defaults
          </h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label="Grace Period" value={location.overstayGracePeriodDays ? `${location.overstayGracePeriodDays} days` : null} />
            <Field label="Penalty Rate" value={location.overstayPenaltyRate ? `${(parseFloat(location.overstayPenaltyRate) * 100).toFixed(0)}%` : null} />
            <Field label="Max Penalty Days" value={location.overstayMaxPenaltyDays} />
          </div>
        </>
      )}
    </div>
  );
}

// ──── LICENSE ────
function LicenseSection({ location }: { location: any }) {
  const statusColor: Record<string, string> = {
    approved: "bg-success text-success-foreground",
    pending: "bg-amber-100 text-amber-800",
    rejected: "bg-destructive text-destructive-foreground",
  };
  const status = location.kitchenLicenseStatus || "pending";

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold flex items-center gap-1.5">
        <FileText className="h-4 w-4 text-primary" /> Kitchen License
      </h4>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Status</p>
          <Badge className={`text-xs ${statusColor[status] || ""}`}>{status}</Badge>
        </div>
        <Field label="Expiry" value={location.kitchenLicenseExpiry} />
        <Field label="Approved At" value={formatDate(location.kitchenLicenseApprovedAt)} />
        {location.kitchenLicenseFeedback && (
          <div className="col-span-2">
            <p className="text-xs text-muted-foreground">Feedback</p>
            <p className="text-xs bg-muted p-2 rounded-md mt-0.5">{location.kitchenLicenseFeedback}</p>
          </div>
        )}
      </div>
      <div className="flex gap-3">
        {location.kitchenLicenseUrl && (
          <a href={getR2ProxyUrl(location.kitchenLicenseUrl)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
            <FileText className="h-3 w-3" /> View License <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {location.kitchenTermsUrl && (
          <a href={getR2ProxyUrl(location.kitchenTermsUrl)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
            <FileText className="h-3 w-3" /> View Terms <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

// ──── REQUIREMENTS ────
function RequirementsSection({ requirements }: { requirements: any }) {
  const checks = [
    { label: "First Name", val: requirements.requireFirstName },
    { label: "Last Name", val: requirements.requireLastName },
    { label: "Email", val: requirements.requireEmail },
    { label: "Phone", val: requirements.requirePhone },
    { label: "Business Name", val: requirements.requireBusinessName },
    { label: "Business Type", val: requirements.requireBusinessType },
    { label: "Experience", val: requirements.requireExperience },
    { label: "Food Handler Cert", val: requirements.requireFoodHandlerCert },
    { label: "Terms Agreement", val: requirements.requireTermsAgree },
  ];

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold flex items-center gap-1.5">
        <Shield className="h-4 w-4 text-primary" /> Application Requirements
      </h4>
      <div className="flex flex-wrap gap-1.5">
        {checks.map((c) => (
          <Badge key={c.label} variant={c.val ? "default" : "outline"} className="text-xs">
            {c.val ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
            {c.label}
          </Badge>
        ))}
      </div>
      {requirements.ventilationSpecs && (
        <div>
          <p className="text-xs text-muted-foreground">Ventilation Specs</p>
          <p className="text-xs bg-muted p-2 rounded-md mt-0.5">{requirements.ventilationSpecs}</p>
        </div>
      )}
    </div>
  );
}

// ──── MANAGER INFO ────
function ManagerInfoSection({ manager, location }: { manager: any; location: any }) {
  const profileData = manager.managerProfileData || {};
  const stripeStatus = manager.stripeConnectOnboardingStatus || "not_started";
  const stripeStatusConfig: Record<string, { label: string; variant: "default" | "destructive" | "outline" }> = {
    complete: { label: "Connected", variant: "default" },
    in_progress: { label: "In Progress", variant: "outline" },
    not_started: { label: "Not Started", variant: "destructive" },
    failed: { label: "Failed", variant: "destructive" },
  };
  const stripe = stripeStatusConfig[stripeStatus] || stripeStatusConfig.not_started;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <h4 className="text-sm font-semibold flex items-center gap-1.5">
          <Users className="h-4 w-4 text-primary" /> Manager Profile
        </h4>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Field label="Display Name" value={manager.displayName} />
          <Field label="Email" value={manager.username} />
          <Field label="Role" value={manager.role} />
          <Field label="ID" value={`#${manager.id}`} />
          <Field label="Member Since" value={formatDate(manager.createdAt)} />
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <h4 className="text-sm font-semibold flex items-center gap-1.5">
          <CreditCard className="h-4 w-4 text-primary" /> Stripe Connect
        </h4>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Onboarding Status</p>
            <Badge variant={stripe.variant} className="text-xs mt-0.5">{stripe.label}</Badge>
          </div>
          <Field label="Account ID" value={manager.stripeConnectAccountId || "Not connected"} />
        </div>
      </div>

      {Object.keys(profileData).length > 0 && (
        <>
          <Separator />
          <div className="space-y-3">
            <h4 className="text-sm font-semibold flex items-center gap-1.5">
              <Building2 className="h-4 w-4 text-primary" /> Profile Data
            </h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {profileData.businessName && <Field label="Business Name" value={profileData.businessName} />}
              {profileData.businessType && <Field label="Business Type" value={profileData.businessType} />}
              {profileData.phone && <Field label="Phone" value={profileData.phone} />}
              {profileData.address && <Field label="Address" value={profileData.address} />}
            </div>
          </div>
        </>
      )}

      <Separator />
      <div className="space-y-3">
        <h4 className="text-sm font-semibold flex items-center gap-1.5">
          <Mail className="h-4 w-4 text-primary" /> Notifications
        </h4>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Field label="Notification Email" value={location?.notificationEmail} />
          <Field label="Notification Phone" value={location?.notificationPhone} />
        </div>
      </div>
    </div>
  );
}

// ──── KITCHEN DETAIL CARD ────
function KitchenDetailCard({ kitchen }: { kitchen: any }) {
  const [expanded, setExpanded] = useState(false);
  const eqCount = kitchen.equipmentListings?.length || 0;
  const stCount = kitchen.storageListings?.length || 0;
  const availCount = kitchen.availability?.length || 0;

  return (
    <div className="rounded-lg border overflow-hidden">
      {/* Kitchen Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-center justify-between hover:bg-muted/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-100 flex-shrink-0">
            <ChefHat className="h-4 w-4 text-amber-600" />
          </div>
          <div>
            <p className="font-medium text-sm">{kitchen.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant={kitchen.isActive ? "default" : "destructive"} className="text-[10px] px-1.5 py-0">
                {kitchen.isActive ? "Active" : "Inactive"}
              </Badge>
              {kitchen.hourlyRate && (
                <span className="text-xs text-muted-foreground">
                  {formatCents(kitchen.hourlyRate)}/{kitchen.pricingModel || "hr"}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {eqCount > 0 && (
            <Badge variant="outline" className="text-[10px]">
              <Wrench className="h-3 w-3 mr-0.5" />{eqCount}
            </Badge>
          )}
          {stCount > 0 && (
            <Badge variant="outline" className="text-[10px]">
              <Package className="h-3 w-3 mr-0.5" />{stCount}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t p-3 space-y-4">
          {/* Kitchen Details */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label="Hourly Rate" value={kitchen.hourlyRate ? formatCents(kitchen.hourlyRate) : null} />
            <Field label="Pricing Model" value={kitchen.pricingModel} />
            <Field label="Min Booking Hours" value={kitchen.minimumBookingHours} />
            <Field label="Tax Rate" value={kitchen.taxRatePercent ? `${kitchen.taxRatePercent}%` : null} />
            <Field label="Currency" value={kitchen.currency} />
            <Field label="Created" value={formatDate(kitchen.createdAt)} />
          </div>

          {kitchen.description && (
            <div>
              <p className="text-xs text-muted-foreground">Description</p>
              <p className="text-xs mt-0.5">{kitchen.description}</p>
            </div>
          )}

          {/* Amenities */}
          {kitchen.amenities && kitchen.amenities.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Amenities</p>
              <div className="flex flex-wrap gap-1">
                {kitchen.amenities.map((a: string, i: number) => (
                  <Badge key={i} variant="outline" className="text-[10px]">{a}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Images */}
          {(kitchen.imageUrl || (kitchen.galleryImages && kitchen.galleryImages.length > 0)) && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Images</p>
              <div className="flex gap-2 flex-wrap">
                {kitchen.imageUrl && (
                  <a href={getR2ProxyUrl(kitchen.imageUrl)} target="_blank" rel="noopener noreferrer" className="block w-16 h-16 rounded-md overflow-hidden border">
                    <img src={getR2ProxyUrl(kitchen.imageUrl)} alt="Kitchen" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </a>
                )}
                {kitchen.galleryImages?.map((url: string, i: number) => (
                  <a key={i} href={getR2ProxyUrl(url)} target="_blank" rel="noopener noreferrer" className="block w-16 h-16 rounded-md overflow-hidden border">
                    <img src={getR2ProxyUrl(url)} alt={`Gallery ${i + 1}`} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Availability */}
          {availCount > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Clock className="h-3 w-3" /> Weekly Availability
              </p>
              <div className="grid grid-cols-1 gap-1">
                {kitchen.availability
                  .sort((a: any, b: any) => a.dayOfWeek - b.dayOfWeek)
                  .map((av: any) => (
                    <div key={av.id} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-muted">
                      <span className="font-medium w-20">{DAY_NAMES[av.dayOfWeek]}</span>
                      {av.isAvailable ? (
                        <span className="text-foreground">{av.startTime} — {av.endTime}</span>
                      ) : (
                        <span className="text-muted-foreground italic">Closed</span>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Equipment Listings */}
          {eqCount > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Wrench className="h-3 w-3" /> Equipment ({eqCount})
              </p>
              <div className="space-y-1.5">
                {kitchen.equipmentListings.map((eq: any) => (
                  <div key={eq.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded border">
                    <div className="flex items-center gap-2">
                      <div>
                        <span className="font-medium">{eq.equipmentType}</span>
                        {eq.brand && <span className="text-muted-foreground ml-1">({eq.brand})</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px] capitalize">{eq.category}</Badge>
                      <Badge variant={eq.availabilityType === "included" ? "default" : "outline"} className="text-[10px]">
                        {eq.availabilityType === "included" ? "Included" : formatCents(eq.sessionRate) + "/session"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] capitalize">{eq.condition}</Badge>
                      <Badge variant={eq.isActive ? "default" : "destructive"} className="text-[10px]">
                        {eq.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Storage Listings */}
          {stCount > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Package className="h-3 w-3" /> Storage ({stCount})
              </p>
              <div className="space-y-1.5">
                {kitchen.storageListings.map((sl: any) => {
                  const StorageIcon = sl.storageType === "freezer" ? Snowflake : sl.storageType === "cold" ? Thermometer : Package;
                  return (
                    <div key={sl.id} className="text-xs px-2 py-1.5 rounded border space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <StorageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium">{sl.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px] capitalize">{sl.storageType}</Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {formatCents(sl.basePrice)}/{sl.pricingModel}
                          </Badge>
                          <Badge variant={sl.isActive ? "default" : "destructive"} className="text-[10px]">
                            {sl.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </div>
                      {(sl.dimensionsLength || sl.temperatureRange || sl.shelfCount) && (
                        <div className="flex gap-3 text-muted-foreground">
                          {sl.dimensionsLength && sl.dimensionsWidth && sl.dimensionsHeight && (
                            <span>{sl.dimensionsLength}×{sl.dimensionsWidth}×{sl.dimensionsHeight}</span>
                          )}
                          {sl.temperatureRange && <span>{sl.temperatureRange}</span>}
                          {sl.shelfCount && <span>{sl.shelfCount} shelves</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ──── REUSABLE FIELD ────
function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value ?? <span className="text-muted-foreground italic">Not set</span>}</p>
    </div>
  );
}
