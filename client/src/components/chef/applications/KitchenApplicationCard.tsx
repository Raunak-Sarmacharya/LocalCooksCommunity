import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Building,
  Calendar,
  ChevronDown,
  CheckCircle,
  Clock,
  XCircle,
  AlertCircle,
  FileText,
  MapPin,
  ArrowRight,
  User,
  Mail,
  Phone,
  Briefcase,
  Award,
  ExternalLink,
  FileCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { ChefKitchenApplication } from "@shared/schema";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { parseBusinessInfo, formatExperience, formatExpiryDate } from "@/utils/parseBusinessInfo";
import { SecureDocumentLink } from "@/components/common/SecureDocumentLink";

interface KitchenApplicationWithLocation extends ChefKitchenApplication {
  location: {
    id: number;
    name: string;
    address: string;
    logoUrl?: string;
    brandImageUrl?: string;
  } | null;
}

interface KitchenApplicationCardProps {
  application: KitchenApplicationWithLocation;
  kitchenImageUrl?: string | null;
  onBookKitchen: (locationId: number, locationName: string, locationAddress?: string) => void;
  onDiscoverKitchens: () => void;
}

// Helper to format document status display
const getDocStatusBadge = (status: string | null | undefined) => {
  if (!status || status === 'N/A') return { variant: 'outline' as const, className: 'bg-muted text-muted-foreground', label: 'Not Uploaded' };
  if (status === 'approved') return { variant: 'success' as const, className: '', label: 'Approved' };
  if (status === 'pending') return { variant: 'secondary' as const, className: 'bg-amber-100 text-amber-800 border-amber-200', label: 'Pending' };
  if (status === 'rejected') return { variant: 'destructive' as const, className: 'bg-red-100 text-red-800 border-red-200', label: 'Rejected' };
  return { variant: 'outline' as const, className: '', label: status };
};

// Helper to format yes/no/notSure values
const formatYesNoNotSure = (value: string | undefined) => {
  if (value === 'yes') return 'Yes';
  if (value === 'no') return 'No';
  if (value === 'notSure') return 'Not Sure';
  return value || 'N/A';
};

export default function KitchenApplicationCard({
  application: app,
  kitchenImageUrl,
  onBookKitchen,
  onDiscoverKitchens,
}: KitchenApplicationCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const imageUrl = kitchenImageUrl || app.location?.brandImageUrl;
  const currentStep = (app as any).current_tier ?? 1;
  const tierData = (app as any).tier_data || {};

  // Step 2 data is stored in tier_data
  const step2Data = tierData.step2 || tierData.tier2 || {};

  // Determine if Step 2 has been submitted and is awaiting manager review
  // Enterprise check: tier2_completed_at is set by the submission endpoint when current_tier=2
  const hasStep2BeenSubmitted = (): boolean => {
    if (currentStep < 2) return false;
    if ((app as any).tier2_completed_at) return true;
    return !!tierData.tier2_submitted_at;
  };

  const step2Submitted = hasStep2BeenSubmitted();

  // Status configuration - using "Step" terminology for frontend
  const getStatusConfig = () => {
    if (app.status === 'approved' && currentStep >= 3) {
      return { label: 'Ready to Book', color: 'bg-green-500', textColor: 'text-green-600', bgLight: 'bg-green-100', stepLabel: 'Complete' };
    }
    if (app.status === 'approved' && step2Submitted) {
      return { label: 'Step 2 Under Review', color: 'bg-blue-500', textColor: 'text-blue-600', bgLight: 'bg-blue-100', stepLabel: 'Awaiting Review' };
    }
    if (app.status === 'approved' && currentStep === 2) {
      return { label: 'Step 2 In Progress', color: 'bg-blue-500', textColor: 'text-blue-600', bgLight: 'bg-blue-100', stepLabel: 'Step 2' };
    }
    if (app.status === 'approved') {
      return { label: 'Step 1 Approved', color: 'bg-blue-500', textColor: 'text-blue-600', bgLight: 'bg-blue-100', stepLabel: 'Step 1 Complete' };
    }
    if (app.status === 'inReview') {
      return { label: 'In Review', color: 'bg-amber-500', textColor: 'text-amber-600', bgLight: 'bg-amber-100', stepLabel: 'Pending Review' };
    }
    if (app.status === 'rejected') {
      return { label: 'Rejected', color: 'bg-red-500', textColor: 'text-red-600', bgLight: 'bg-red-100', stepLabel: 'Rejected' };
    }
    if (app.status === 'cancelled') {
      return { label: 'Cancelled', color: 'bg-muted-foreground/40', textColor: 'text-muted-foreground', bgLight: 'bg-muted', stepLabel: 'Cancelled' };
    }
    return { label: 'Unknown', color: 'bg-muted-foreground/40', textColor: 'text-muted-foreground', bgLight: 'bg-muted', stepLabel: 'Unknown' };
  };

  const statusConfig = getStatusConfig();

  // Check if Step 2 has been submitted
  const hasStep2Data = Object.keys(step2Data).length > 0 || (app as any).tier2_completed_at;

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <Card className="overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md">
        <div className={cn("h-1 w-full", statusConfig.color)} />

        {/* Collapsed Header */}
        <CollapsibleTrigger asChild>
          <div className="p-4 cursor-pointer hover:bg-muted/30 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {imageUrl ? (
                  <div className="w-12 h-12 rounded-xl overflow-hidden border border-border/50">
                    <img src={getR2ProxyUrl(imageUrl)} alt={app.location?.name} className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", statusConfig.bgLight)}>
                    <Building className={cn("h-6 w-6", statusConfig.textColor)} />
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-foreground">{app.location?.name || 'Kitchen Application'}</p>
                    <Badge className={cn("uppercase tracking-wider font-bold text-white", statusConfig.color, `hover:${statusConfig.color}`)}>
                      {statusConfig.label}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                    <MapPin className="h-3 w-3" />
                    {app.location?.address || 'Address not available'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ChevronDown className={cn(
                  "h-5 w-5 text-muted-foreground transition-transform duration-200",
                  isExpanded && "rotate-180"
                )} />
              </div>
            </div>
          </div>
        </CollapsibleTrigger>

        {/* Expanded Content */}
        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-5 border-t border-border/50 pt-4">

            {/* Application Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-2 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground uppercase">Application ID</p>
                <p className="text-sm font-medium">#{app.id}</p>
              </div>
              <div className="p-2 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground uppercase">Submitted</p>
                <p className="text-sm font-medium">{new Date(app.createdAt || '').toLocaleDateString()}</p>
              </div>
              <div className="p-2 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground uppercase">Current Progress</p>
                <p className="text-sm font-medium">{statusConfig.stepLabel}</p>
              </div>
              <div className="p-2 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground uppercase">Status</p>
                <p className="text-sm font-medium capitalize">{app.status}</p>
              </div>
            </div>

            {/* Step Progress Indicator */}
            {app.status === 'approved' && (
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Application Progress</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className={cn(
                      "h-2 rounded-full",
                      currentStep >= 1 ? "bg-blue-500" : "bg-border"
                    )} />
                    <p className="text-xs text-center mt-1 text-muted-foreground">Step 1</p>
                  </div>
                  <div className="flex-1">
                    <div className={cn(
                      "h-2 rounded-full",
                      currentStep >= 2 ? "bg-blue-500" : "bg-border"
                    )} />
                    <p className="text-xs text-center mt-1 text-muted-foreground">Step 2</p>
                  </div>
                  <div className="flex-1">
                    <div className={cn(
                      "h-2 rounded-full",
                      currentStep >= 3 ? "bg-green-500" : "bg-border"
                    )} />
                    <p className="text-xs text-center mt-1 text-muted-foreground">Complete</p>
                  </div>
                </div>
              </div>
            )}

            <Separator className="bg-border/50" />

            {/* ========================================== */}
            {/* STEP 1 DETAILS - Initial Application */}
            {/* ========================================== */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
                  <span className="text-xs font-bold text-blue-600">1</span>
                </div>
                <p className="text-sm font-bold text-foreground">Step 1 - Initial Application</p>
                {(app as any).tier1_completed_at && (
                  <Badge variant="success">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Submitted {new Date((app as any).tier1_completed_at || app.createdAt).toLocaleDateString()}
                  </Badge>
                )}
              </div>

              {/* Personal Information */}
              <div className="ml-8 space-y-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Personal Information</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="flex items-center gap-2 p-2 bg-muted/20 rounded-lg">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground uppercase">Full Name</p>
                      <p className="text-sm font-medium">{app.fullName || 'N/A'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-2 bg-muted/20 rounded-lg">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground uppercase">Email</p>
                      <p className="text-sm font-medium truncate">{app.email || 'N/A'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-2 bg-muted/20 rounded-lg">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground uppercase">Phone</p>
                      <p className="text-sm font-medium">{app.phone || 'N/A'}</p>
                    </div>
                  </div>
                </div>

                {/* Business Details */}
                <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mt-4">Business Details</p>
                {(() => {
                  const businessInfo = parseBusinessInfo(app.businessDescription);
                  return (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="p-2 bg-muted/20 rounded-lg">
                          <p className="text-xs text-muted-foreground uppercase">Kitchen Preference</p>
                          <p className="text-sm font-medium capitalize">{app.kitchenPreference || 'N/A'}</p>
                        </div>
                        <div className="p-2 bg-muted/20 rounded-lg">
                          <p className="text-xs text-muted-foreground uppercase">Cooking Experience</p>
                          <p className="text-sm font-medium">{formatExperience(app.cookingExperience || businessInfo?.experience)}</p>
                        </div>
                      </div>
                      {businessInfo && (
                        <>
                          {/* Business Name & Type */}
                          {(businessInfo.businessName || businessInfo.businessType) && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {businessInfo.businessName && (
                                <div className="p-2 bg-muted/20 rounded-lg">
                                  <p className="text-xs text-muted-foreground uppercase">Business Name</p>
                                  <p className="text-sm font-medium">{businessInfo.businessName}</p>
                                </div>
                              )}
                              {businessInfo.businessType && (
                                <div className="p-2 bg-muted/20 rounded-lg">
                                  <p className="text-xs text-muted-foreground uppercase">Business Type</p>
                                  <p className="text-sm font-medium capitalize">{businessInfo.businessType}</p>
                                </div>
                              )}
                            </div>
                          )}
                          {/* Usage Frequency & Session Duration */}
                          {(businessInfo.usageFrequency || businessInfo.sessionDuration) && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {businessInfo.usageFrequency && (
                                <div className="p-2 bg-muted/20 rounded-lg">
                                  <p className="text-xs text-muted-foreground uppercase">Usage Frequency</p>
                                  <p className="text-sm font-medium capitalize">{businessInfo.usageFrequency}</p>
                                </div>
                              )}
                              {businessInfo.sessionDuration && (
                                <div className="p-2 bg-muted/20 rounded-lg">
                                  <p className="text-xs text-muted-foreground uppercase">Session Duration</p>
                                  <p className="text-sm font-medium">{businessInfo.sessionDuration} hours</p>
                                </div>
                              )}
                            </div>
                          )}
                          {/* Certificate Expiry Dates */}
                          {(businessInfo.foodHandlerCertExpiry || businessInfo.foodEstablishmentCertExpiry) && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {businessInfo.foodHandlerCertExpiry && (
                                <div className="p-2 bg-muted/20 rounded-lg">
                                  <p className="text-xs text-muted-foreground uppercase">Food Handler Cert Expiry</p>
                                  <p className="text-sm font-medium">{formatExpiryDate(businessInfo.foodHandlerCertExpiry)}</p>
                                </div>
                              )}
                              {businessInfo.foodEstablishmentCertExpiry && (
                                <div className="p-2 bg-muted/20 rounded-lg">
                                  <p className="text-xs text-muted-foreground uppercase">Establishment Cert Expiry</p>
                                  <p className="text-sm font-medium">{formatExpiryDate(businessInfo.foodEstablishmentCertExpiry)}</p>
                                </div>
                              )}
                            </div>
                          )}
                          {/* Free-text Description */}
                          {businessInfo.description && (
                            <div className="p-2 bg-muted/20 rounded-lg">
                              <p className="text-xs text-muted-foreground uppercase">Description</p>
                              <p className="text-sm">{businessInfo.description}</p>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()}

                {/* Step 1 Documents */}
                <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mt-4">Documents</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-blue-600" />
                      <div>
                        <span className="text-sm font-medium">Food Safety License</span>
                        <p className="text-xs text-muted-foreground">
                          Has License: {formatYesNoNotSure(app.foodSafetyLicense)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {app.foodSafetyLicenseUrl ? (
                        <>
                          <Badge variant={getDocStatusBadge(app.foodSafetyLicenseStatus).variant} className={cn(getDocStatusBadge(app.foodSafetyLicenseStatus).className)}>
                            {getDocStatusBadge(app.foodSafetyLicenseStatus).label}
                          </Badge>
                          <SecureDocumentLink
                            url={app.foodSafetyLicenseUrl}
                            fileName="Food Safety License"
                            label="View"
                            showIcon={false}
                          />
                        </>
                      ) : (
                        <Badge variant="outline" className="bg-muted">Not Uploaded</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-green-600" />
                      <div>
                        <span className="text-sm font-medium">Establishment Cert</span>
                        <p className="text-xs text-muted-foreground">
                          Has Cert: {formatYesNoNotSure(app.foodEstablishmentCert)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {app.foodEstablishmentCertUrl ? (
                        <>
                          <Badge variant={getDocStatusBadge(app.foodEstablishmentCertStatus).variant} className={cn(getDocStatusBadge(app.foodEstablishmentCertStatus).className)}>
                            {getDocStatusBadge(app.foodEstablishmentCertStatus).label}
                          </Badge>
                          <SecureDocumentLink
                            url={app.foodEstablishmentCertUrl}
                            fileName="Establishment Certificate"
                            label="View"
                            showIcon={false}
                          />
                        </>
                      ) : (
                        <Badge variant="outline" className="bg-muted">Not Uploaded</Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ========================================== */}
            {/* STEP 2 DETAILS - Additional Requirements */}
            {/* ========================================== */}
            {(currentStep >= 2 || hasStep2Data) && (
              <>
                <Separator className="bg-border/50" />
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center",
                      hasStep2Data ? "bg-blue-100" : "bg-muted"
                    )}>
                      <span className={cn("text-xs font-bold", hasStep2Data ? "text-blue-600" : "text-muted-foreground")}>2</span>
                    </div>
                    <p className="text-sm font-bold text-foreground">Step 2 - Additional Requirements</p>
                    {(app as any).tier2_completed_at ? (
                      <Badge variant="success">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Submitted {new Date((app as any).tier2_completed_at).toLocaleDateString()}
                      </Badge>
                    ) : currentStep === 2 ? (
                      <Badge variant="warning">
                        <Clock className="h-3 w-3 mr-1" />
                        In Progress
                      </Badge>
                    ) : null}
                  </div>

                  {hasStep2Data ? (
                    <div className="ml-8 space-y-3">
                      {/* Government License Info */}
                      {((app as any).government_license_number || step2Data.governmentLicenseNumber) && (
                        <>
                          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Government License</p>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="p-2 bg-muted/20 rounded-lg">
                              <p className="text-xs text-muted-foreground uppercase">License Number</p>
                              <p className="text-sm font-medium">{(app as any).government_license_number || step2Data.governmentLicenseNumber || 'N/A'}</p>
                            </div>
                            <div className="p-2 bg-muted/20 rounded-lg">
                              <p className="text-xs text-muted-foreground uppercase">Received Date</p>
                              <p className="text-sm font-medium">
                                {(app as any).government_license_received_date || step2Data.governmentLicenseReceivedDate
                                  ? new Date((app as any).government_license_received_date || step2Data.governmentLicenseReceivedDate).toLocaleDateString()
                                  : 'N/A'}
                              </p>
                            </div>
                            <div className="p-2 bg-muted/20 rounded-lg">
                              <p className="text-xs text-muted-foreground uppercase">Expiry Date</p>
                              <p className="text-sm font-medium">
                                {(app as any).government_license_expiry_date || step2Data.governmentLicenseExpiryDate
                                  ? new Date((app as any).government_license_expiry_date || step2Data.governmentLicenseExpiryDate).toLocaleDateString()
                                  : 'N/A'}
                              </p>
                            </div>
                          </div>
                        </>
                      )}

                      {/* Step 2 Custom Fields from tier_data */}
                      {Object.keys(step2Data).length > 0 && (
                        <>
                          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mt-4">Additional Information</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {Object.entries(step2Data).map(([key, value]) => {
                              // Skip internal fields and already displayed fields
                              if (['governmentLicenseNumber', 'governmentLicenseReceivedDate', 'governmentLicenseExpiryDate'].includes(key)) return null;
                              if (typeof value === 'object' && value !== null) return null;

                              // Format the key for display
                              const displayKey = key
                                .replace(/([A-Z])/g, ' $1')
                                .replace(/^./, str => str.toUpperCase())
                                .trim();

                              return (
                                <div key={key} className="p-2 bg-muted/20 rounded-lg">
                                  <p className="text-xs text-muted-foreground uppercase">{displayKey}</p>
                                  <p className="text-sm font-medium">{String(value) || 'N/A'}</p>
                                </div>
                              );
                            })}
                          </div>

                          {/* Step 2 Documents */}
                          {step2Data.documents && Object.keys(step2Data.documents).length > 0 && (
                            <>
                              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mt-4">Step 2 Documents</p>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {Object.entries(step2Data.documents).map(([docKey, docValue]: [string, any]) => (
                                  <div key={docKey} className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card">
                                    <div className="flex items-center gap-2">
                                      <FileText className="h-4 w-4 text-purple-600" />
                                      <span className="text-sm font-medium capitalize">
                                        {docKey.replace(/([A-Z])/g, ' $1').trim()}
                                      </span>
                                    </div>
                                    {typeof docValue === 'string' && docValue ? (
                                      <SecureDocumentLink
                                        url={docValue}
                                        fileName={docKey.replace(/([A-Z])/g, ' $1').trim()}
                                        label="View"
                                        showIcon={false}
                                      />
                                    ) : (
                                      <Badge variant="outline" className="bg-muted">Not Uploaded</Badge>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  ) : currentStep >= 2 && !hasStep2Data ? (
                    <div className="ml-8 p-4 bg-amber-50 rounded-lg border border-amber-200">
                      <p className="text-sm text-amber-800">
                        <AlertCircle className="h-4 w-4 inline mr-2" />
                        Step 2 requirements are pending. Complete them to gain full kitchen access.
                      </p>
                    </div>
                  ) : null}
                </div>
              </>
            )}

            {/* Manager Feedback */}
            {app.feedback && (
              <>
                <Separator className="bg-border/50" />
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <p className="text-xs font-bold text-blue-800 mb-1">Manager Feedback</p>
                  <p className="text-sm text-blue-700 italic">{app.feedback}</p>
                </div>
              </>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-2">
              {app.status === 'approved' && currentStep >= 3 && (
                <Button
                  size="sm"
                  
                  onClick={() => onBookKitchen(app.locationId, app.location?.name || 'Kitchen', app.location?.address)}
                >
                  <Calendar className="h-4 w-4 mr-1" />
                  Book Kitchen
                </Button>
              )}
              {app.status === 'approved' && currentStep < 3 && (
                step2Submitted ? (
                  <Badge variant="secondary" className="text-xs">
                    <FileCheck className="h-3 w-3 mr-1" />
                    Step 2 submitted — awaiting manager review
                  </Badge>
                ) : (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/kitchen-requirements/${app.locationId}`}>
                      <ArrowRight className="h-4 w-4 mr-1" />
                      Complete Step {currentStep === 1 ? 2 : currentStep}
                    </Link>
                  </Button>
                )
              )}
              {(app.status === 'rejected' || app.status === 'cancelled') && (
                <Button variant="outline" size="sm" onClick={onDiscoverKitchens}>
                  <Building className="h-4 w-4 mr-1" />
                  Apply to Another Kitchen
                </Button>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
