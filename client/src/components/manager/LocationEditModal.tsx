import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { usePresignedDocumentUrl } from "@/hooks/use-presigned-document-url";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Building2, MapPin, Mail, Phone, Clock, Calendar,
  Globe, Save, Loader2, CheckCircle,
  XCircle, AlertCircle, FileText
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DEFAULT_TIMEZONE } from "@/utils/timezone-utils";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { ImageWithReplace } from "@/components/ui/image-with-replace";
import { LocationData } from "./types"; // Use shared types


// Helper component for authenticated document links
function AuthenticatedDocumentLink({ url, className, children }: { url: string | null | undefined; className?: string; children: React.ReactNode }) {
  const { url: presignedUrl } = usePresignedDocumentUrl(url);
  
  if (!url) return null;
  
  return (
    <a 
      href={presignedUrl || url} 
      target="_blank" 
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}

// Zod schemas for validation — mt() at call time so locale is current
const basicInfoSchema = z.object({
  name: z.string().min(2, mt("locationNameMinLength")),
  address: z.string().min(5, mt("addressMinLength")),
  notificationEmail: z.string().email(mt("validEmailAddress")).optional().or(z.literal("")),
  notificationPhone: z.string().optional(),
});

const settingsSchema = z.object({
  timezone: z.string(),
  cancellationPolicyHours: z.coerce.number().min(0, mt("hoursCannotBeNegative")),
  defaultDailyBookingLimit: z.coerce.number().min(1, mt("mustBeAtLeastOneHour")).max(24, mt("cannotExceed24Hours")),
  minimumBookingWindowHours: z.coerce.number().int(mt("mustBeWholeNumber")).min(0, mt("hoursCannotBeNegative")).max(168, mt("cannotExceedOneWeek")),
  cancellationPolicyMessage: z.string().optional(),
  logoUrl: z.string().optional(),
});

function getLocationFormSchema() {
  return basicInfoSchema.merge(settingsSchema);
}

type LocationFormValues = z.infer<ReturnType<typeof getLocationFormSchema>>;

interface LocationEditModalProps {
  location: LocationData;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  viewOnly?: boolean;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const currentFirebaseUser = auth.currentUser;

  if (currentFirebaseUser) {
    try {
      const freshToken = await currentFirebaseUser.getIdToken();
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${freshToken}`,
      };
    } catch (error) {
      logger.error('Error getting Firebase token:', error);
    }
  }

  const token = localStorage.getItem('firebaseToken');
  if (token) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  }

  return {
    'Content-Type': 'application/json',
  };
}

function getStatusConfig(status?: string) {
  switch (status) {
    case 'approved':
      return {
        label: mt('approved'),
        icon: CheckCircle,
        bgColor: 'bg-green-100',
        textColor: 'text-green-800',
      };
    case 'rejected':
      return {
        label: mt('rejected'),
        icon: XCircle,
        bgColor: 'bg-red-100',
        textColor: 'text-red-800',
      };
    case 'pending':
    default:
      return {
        label: mt('pending'),
        icon: Clock,
        bgColor: 'bg-yellow-100',
        textColor: 'text-yellow-800',
      };
  }
}

export default function LocationEditModal({
  location,
  isOpen,
  onClose,
  onSave,
  viewOnly = false,
}: LocationEditModalProps) {
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<LocationFormValues>({
    resolver: zodResolver(getLocationFormSchema()),
    defaultValues: {
      name: location.name,
      address: location.address,
      notificationEmail: location.notificationEmail || "",
      notificationPhone: location.notificationPhone || "",
      timezone: DEFAULT_TIMEZONE, // Locked to default
      cancellationPolicyHours: location.cancellationPolicyHours || 24,
      cancellationPolicyMessage: location.cancellationPolicyMessage || mt("cancellationPolicyDefaultMessage"),
      defaultDailyBookingLimit: location.defaultDailyBookingLimit || 2,
      minimumBookingWindowHours: location.minimumBookingWindowHours ?? 1,
      logoUrl: location.logoUrl || "",
    },
  });

  // Reset form when location changes or modal opens
  useEffect(() => {
    if (isOpen) {
      form.reset({
        name: location.name,
        address: location.address,
        notificationEmail: location.notificationEmail || "",
        notificationPhone: location.notificationPhone || "",
        timezone: DEFAULT_TIMEZONE,
        cancellationPolicyHours: location.cancellationPolicyHours || 24,
        cancellationPolicyMessage: location.cancellationPolicyMessage || mt("cancellationPolicyDefaultMessage"),
        defaultDailyBookingLimit: location.defaultDailyBookingLimit || 2,
        minimumBookingWindowHours: location.minimumBookingWindowHours ?? 1,
        logoUrl: location.logoUrl || "",
      });
    }
  }, [location, isOpen, form]);


  // Update basic info mutation
  const updateBasicInfo = useMutation({
    mutationFn: async (data: { name: string; address: string; notificationEmail: string; notificationPhone: string }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations/${location.id}`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || tt("failedToUpdateLocation"));
      }

      return response.json();
    },
  });

  // Update settings mutation
  const updateSettings = useMutation({
    mutationFn: async (data: {
      cancellationPolicyHours?: number;
      cancellationPolicyMessage?: string;
      defaultDailyBookingLimit?: number;
      minimumBookingWindowHours?: number;
      logoUrl?: string;
      timezone?: string;
    }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations/${location.id}/cancellation-policy`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || tt("failedToUpdateLocationSettings"));
      }

      return response.json();
    },
  });

  const onSubmit = async (values: LocationFormValues) => {
    try {
      // Execute both mutations concurrently
      await Promise.all([
        updateBasicInfo.mutateAsync({
          name: values.name,
          address: values.address,
          notificationEmail: values.notificationEmail || "",
          notificationPhone: values.notificationPhone || "",
        }),
        updateSettings.mutateAsync({
          cancellationPolicyHours: values.cancellationPolicyHours,
          cancellationPolicyMessage: values.cancellationPolicyMessage,
          defaultDailyBookingLimit: values.defaultDailyBookingLimit,
          minimumBookingWindowHours: values.minimumBookingWindowHours,
          logoUrl: values.logoUrl || undefined,
          timezone: values.timezone,
        })
      ]);

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
      queryClient.invalidateQueries({ queryKey: ["locationDetails", location.id] });

      toast({ title: mt("success"),
        description: mt("locationUpdatedSuccessfully"),
      });

      onSave();
    } catch (error: any) {
      toast({ title: mt("error"),
        description: error.message || tt("failedToUpdateLocation"),
        variant: "destructive",
      });
    }
  };

  const isLoading = updateBasicInfo.isPending || updateSettings.isPending;
  const statusConfig = getStatusConfig(location.kitchenLicenseStatus);
  const StatusIcon = statusConfig.icon;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
        <SheetHeader className="p-6 pb-4 border-b">
          <div className="flex items-center gap-3">
            {location.logoUrl ? (
              <ImageWithReplace
                imageUrl={location.logoUrl}
                onImageChange={() => { }} // Read-only in header
                alt={location.name}
                className="w-12 h-12"
                containerClassName="w-12 h-12"
                aspectRatio="1/1"
                showReplaceButton={false}
                showRemoveButton={false}
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#FFE8DD] to-[#FFD4C4] flex items-center justify-center">
                <Building2 className="w-6 h-6 text-[#F51042]" />
              </div>
            )}
            <div>
              <SheetTitle className="text-lg">
                {viewOnly ? mt("locationDetails") : mt("editLocation")}
              </SheetTitle>
              <SheetDescription>
                {viewOnly ? mt("viewYourLocationInformation") : mt("updateYourLocationDetails")}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <Tabs defaultValue="basic" className="w-full">
                <TabsList className="grid w-full grid-cols-3 mb-4">
                  <TabsTrigger value="basic">{mt("basicInfo")}</TabsTrigger>
                  <TabsTrigger value="settings">{mt("settings")}</TabsTrigger>
                  <TabsTrigger value="license">{mt("navLicense")}</TabsTrigger>
                </TabsList>

                {/* Basic Info Tab */}
                <TabsContent value="basic" className="space-y-4 mt-0">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{mt("locationName")}</FormLabel>
                        <div className="relative">
                          <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <FormControl>
                            <Input className="pl-10" placeholder={mt("enterLocationName")} {...field} disabled={viewOnly} />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{mt("address")}</FormLabel>
                        <div className="relative">
                          <MapPin className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                          <FormControl>
                            <Textarea className="pl-10 min-h-[80px]" placeholder={mt("enterFullAddress")} {...field} disabled={viewOnly} />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="notificationEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{mt("notificationEmail")}</FormLabel>
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <FormControl>
                              <Input className="pl-10" type="email" placeholder={mt("emailExampleCom")} {...field} disabled={viewOnly} />
                            </FormControl>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="notificationPhone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{mt("notificationPhone")}</FormLabel>
                          <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <FormControl>
                              <Input className="pl-10" type="tel" placeholder="(416) 123-4567" {...field} disabled={viewOnly} />
                            </FormControl>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="space-y-2">
                    <FormLabel>{mt("locationLogo")}</FormLabel>
                    <FormField
                      control={form.control}
                      name="logoUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <ImageWithReplace
                              imageUrl={field.value || undefined}
                              onImageChange={(newUrl) => field.onChange(newUrl || "")}
                              alt="Location logo"
                              className="w-full max-w-xs"
                              containerClassName="w-full max-w-xs"
                              aspectRatio="1/1"
                              showReplaceButton={!viewOnly}
                              showRemoveButton={!viewOnly}
                              fieldName="logo"
                            />
                          </FormControl>
                          {viewOnly && !field.value && (
                            <p className="text-sm text-gray-500">{mt("noLogoUploaded")}</p>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </TabsContent>

                {/* Settings Tab */}
                <TabsContent value="settings" className="space-y-4 mt-0">
                  <FormField
                    control={form.control}
                    name="timezone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{mt("timezone")}</FormLabel>
                        <div className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 bg-gray-50 text-gray-700">
                          <Globe className="w-4 h-4 text-gray-400" />
                          <span className="flex-1">{mt("newfoundlandTimeGMT330")}</span>
                          <Badge variant="secondary" className="text-xs">{mt("locked")}</Badge>
                        </div>
                        <FormDescription>{mt("theTimezoneIsLockedToNewfoundlandTimeForAllLocations")}</FormDescription>
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="cancellationPolicyHours"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{mt("cancellationPolicyHours")}</FormLabel>
                          <div className="relative">
                            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <FormControl>
                              <Input className="pl-10" type="number" min="0" {...field} disabled={viewOnly} />
                            </FormControl>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="defaultDailyBookingLimit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{mt("dailyBookingLimitHours")}</FormLabel>
                          <div className="relative">
                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <FormControl>
                              <Input className="pl-10" type="number" min="1" max="24" {...field} disabled={viewOnly} />
                            </FormControl>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="minimumBookingWindowHours"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{mt("minimumBookingWindowHours")}</FormLabel>
                        <div className="relative">
                          <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <FormControl>
                            <Input className="pl-10" type="number" min="0" max="168" step="1" {...field} disabled={viewOnly} />
                          </FormControl>
                        </div>
                        <FormDescription>{mt("howManyHoursInAdvanceBookingsMustBeMade0168Hours")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="cancellationPolicyMessage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{mt("cancellationPolicyMessage")}</FormLabel>
                        <FormControl>
                          <Textarea className="min-h-[80px]" placeholder={mt("enterCancellationPolicyMessage")} {...field} disabled={viewOnly} />
                        </FormControl>
                        <FormDescription>Use {"{hours}"} to insert the cancellation hours value</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TabsContent>



                {/* License Tab */}
                <TabsContent value="license" className="space-y-4 mt-0">
                  <div className="rounded-lg border p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-gray-600" />
                        <span className="font-medium">{mt("kitchenLicense")}</span>
                      </div>
                      <div className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                        statusConfig.bgColor,
                        statusConfig.textColor
                      )}>
                        <StatusIcon className="w-3.5 h-3.5" />
                        {statusConfig.label}
                      </div>
                    </div>

                    {location.kitchenLicenseUrl ? (
                      <div className="space-y-2">
                        <p className="text-sm text-gray-600">
                          Your kitchen license has been uploaded and is{" "}
                          {location.kitchenLicenseStatus === 'approved'
                            ? 'approved'
                            : location.kitchenLicenseStatus === 'rejected'
                              ? 'rejected'
                              : 'under review'}.
                        </p>
                        <AuthenticatedDocumentLink
                          url={location.kitchenLicenseUrl || `/api/files/kitchen-license/manager/${location.id}`}
                          className="text-sm text-[#F51042] hover:underline inline-flex items-center gap-1"
                        >
                          <FileText className="w-4 h-4" />{mt("viewUploadedLicense")}</AuthenticatedDocumentLink>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-600">{mt("noKitchenLicenseHasBeenUploadedYetPleaseUploadYourLicenseDur")}</p>
                    )}

                    {location.kitchenLicenseStatus === 'rejected' && location.kitchenLicenseFeedback && (
                      <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-100">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-sm font-medium text-red-800">{mt("adminFeedback")}</p>
                            <p className="text-sm text-red-600 mt-1">{location.kitchenLicenseFeedback}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {location.kitchenLicenseApprovedAt && (
                      <p className="text-xs text-gray-500">
                        {location.kitchenLicenseStatus === 'approved' ? 'Approved' : 'Reviewed'} on:{" "}
                        {new Date(location.kitchenLicenseApprovedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </form>
          </Form>
        </div>

        <SheetFooter className="p-6 pt-4 border-t gap-2">
          <Button variant="outline" type="button" onClick={onClose}>
            {viewOnly ? "Close" : "Cancel"}
          </Button>
          {!viewOnly && (
            <Button
              type="submit"
              onClick={form.handleSubmit(onSubmit)}
              disabled={isLoading}
              className="gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />{mt("saving")}</>
              ) : (
                <>
                  <Save className="w-4 h-4" />{mt("saveChanges")}</>
              )}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
