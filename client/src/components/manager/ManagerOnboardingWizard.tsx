import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Building2,
  FileText,
  Settings,
  CheckCircle,
  X,
  ChevronRight,
  ChevronLeft,
  Upload,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useManagerDashboard } from "@/hooks/use-manager-dashboard";

interface OnboardingStep {
  id: number;
  title: string;
  description: string;
  icon: React.ReactNode;
}

interface Location {
  id: number;
  name: string;
  address: string;
  notificationEmail?: string;
  notificationPhone?: string;
  kitchenLicenseUrl?: string;
  kitchenLicenseStatus?: string;
  kitchenLicenseApprovedBy?: number;
  kitchenLicenseApprovedAt?: string;
  kitchenLicenseFeedback?: string;
}

export default function ManagerOnboardingWizard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { locations, isLoadingLocations } = useManagerDashboard();
  const [currentStep, setCurrentStep] = useState(1);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [uploadingLicense, setUploadingLicense] = useState(false);
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [notificationEmail, setNotificationEmail] = useState("");
  const [notificationPhone, setNotificationPhone] = useState("");

  const steps: OnboardingStep[] = [
    {
      id: 1,
      title: "Basic Information",
      description: "Set up your location details and contact information",
      icon: <Building2 className="h-6 w-6" />,
    },
    {
      id: 2,
      title: "Kitchen License",
      description: "Upload your kitchen license for admin approval",
      icon: <FileText className="h-6 w-6" />,
    },
    {
      id: 3,
      title: "Settings",
      description: "Configure notification preferences",
      icon: <Settings className="h-6 w-6" />,
    },
  ];

  // Check if onboarding is needed
  const { data: userData } = useQuery({
    queryKey: ["/api/user-session"],
    queryFn: async () => {
      const response = await fetch("/api/user-session", {
        credentials: "include",
      });
      if (!response.ok) return null;
      return response.json();
    },
  });

  const shouldShowOnboarding =
    userData?.role === "manager" &&
    !userData?.manager_onboarding_completed &&
    !userData?.manager_onboarding_skipped;

  useEffect(() => {
    if (shouldShowOnboarding && !isLoadingLocations) {
      setIsOpen(true);
      // Auto-select location if only one exists
      if (locations.length === 1) {
        setSelectedLocationId(locations[0].id);
        const loc = locations[0] as any;
        setLocationName(loc.name || "");
        setLocationAddress(loc.address || "");
        setNotificationEmail(loc.notificationEmail || "");
        setNotificationPhone(loc.notificationPhone || "");
      }
    }
  }, [shouldShowOnboarding, isLoadingLocations, locations]);

  const updateLocationMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch(`/api/manager/locations/${selectedLocationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update location");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-session"] });
    },
  });

  const uploadLicenseMutation = useMutation({
    mutationFn: async (file: File) => {
      setUploadingLicense(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/upload-file", {
          method: "POST",
          credentials: "include",
          body: formData,
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to upload license");
        }

        const result = await response.json();
        return result.url;
      } finally {
        setUploadingLicense(false);
      }
    },
  });

  const completeOnboardingMutation = useMutation({
    mutationFn: async (skipped: boolean) => {
      const response = await fetch("/api/manager/complete-onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ skipped }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to complete onboarding");
      }
      return { skipped };
    },
    onSuccess: (data) => {
      const skipped = data.skipped;
      queryClient.invalidateQueries({ queryKey: ["/api/user-session"] });
      setIsOpen(false);
      toast({
        title: skipped ? "Onboarding Skipped" : "Onboarding Completed",
        description: skipped
          ? "You can complete setup later from your dashboard."
          : "Your location is set up! Waiting for license approval to activate bookings.",
      });
    },
  });

  const handleNext = async () => {
    if (currentStep === 1) {
      // Validate basic info
      if (!locationName || !locationAddress) {
        toast({
          title: "Missing Information",
          description: "Please fill in location name and address",
          variant: "destructive",
        });
        return;
      }

      // Update location with basic info
      try {
        await updateLocationMutation.mutateAsync({
          name: locationName,
          address: locationAddress,
          notificationEmail,
          notificationPhone,
        });
        setCurrentStep(2);
      } catch (error: any) {
        toast({
          title: "Error",
          description: error.message || "Failed to save location information",
          variant: "destructive",
        });
      }
    } else if (currentStep === 2) {
      // Upload license if provided
      if (licenseFile) {
        try {
          const licenseUrl = await uploadLicenseMutation.mutateAsync(licenseFile);
          await updateLocationMutation.mutateAsync({
            kitchenLicenseUrl: licenseUrl,
            kitchenLicenseStatus: "pending",
          });
          toast({
            title: "License Uploaded",
            description: "Your license has been submitted for admin approval.",
          });
        } catch (error: any) {
          toast({
            title: "Upload Failed",
            description: error.message || "Failed to upload license",
            variant: "destructive",
          });
          return;
        }
      }
      setCurrentStep(3);
    } else if (currentStep === 3) {
      // Complete onboarding
      await completeOnboardingMutation.mutateAsync(false);
    }
  };

  const handleSkip = async () => {
    if (
      window.confirm(
        "Are you sure you want to skip onboarding? You can complete it later, but bookings will be disabled until your license is approved."
      )
    ) {
      await completeOnboardingMutation.mutateAsync(true);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const selectedLocation = locations.find((loc) => loc.id === selectedLocationId) as Location | undefined;

  if (!shouldShowOnboarding) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Welcome! Let's Set Up Your Kitchen</DialogTitle>
          <DialogDescription>
            Complete these steps to activate bookings for your location
          </DialogDescription>
        </DialogHeader>

        {/* Progress Indicator */}
        <div className="flex items-center justify-between mb-8 mt-4">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center border-2 ${
                    currentStep > step.id
                      ? "bg-green-500 border-green-500 text-white"
                      : currentStep === step.id
                      ? "bg-blue-500 border-blue-500 text-white"
                      : "bg-gray-100 border-gray-300 text-gray-400"
                  }`}
                >
                  {currentStep > step.id ? (
                    <CheckCircle className="h-6 w-6" />
                  ) : (
                    step.icon
                  )}
                </div>
                <div className="mt-2 text-center">
                  <p
                    className={`text-xs font-medium ${
                      currentStep >= step.id ? "text-gray-900" : "text-gray-400"
                    }`}
                  >
                    {step.title}
                  </p>
                </div>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-2 ${
                    currentStep > step.id ? "bg-green-500" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div className="space-y-6">
          {currentStep === 1 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Location Information</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Location Name *
                  </label>
                  <input
                    type="text"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., The Lantern"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Address *
                  </label>
                  <input
                    type="text"
                    value={locationAddress}
                    onChange={(e) => setLocationAddress(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., 123 Main St, St. John's, NL"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notification Email
                  </label>
                  <input
                    type="email"
                    value={notificationEmail}
                    onChange={(e) => setNotificationEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="notifications@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notification Phone
                  </label>
                  <input
                    type="tel"
                    value={notificationPhone}
                    onChange={(e) => setNotificationPhone(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="(709) 555-1234"
                  />
                </div>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Kitchen License</h3>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                  <div>
                    <p className="text-sm text-yellow-800 font-medium mb-1">
                      License Required for Booking Activation
                    </p>
                    <p className="text-xs text-yellow-700">
                      Your kitchen license must be approved by an admin before bookings can be
                      activated. You can skip this step and upload later, but bookings will remain
                      disabled.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {selectedLocation?.kitchenLicenseUrl ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-green-800">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">License Uploaded</span>
                    </div>
                    <p className="text-sm text-green-700 mt-1">
                      Status: {selectedLocation.kitchenLicenseStatus || "pending"}
                    </p>
                    {selectedLocation.kitchenLicenseStatus === "approved" && (
                      <p className="text-xs text-green-600 mt-1">
                        ✓ Your license has been approved! Bookings are now active.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
                    <div className="text-center">
                      <Upload className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                      <label className="cursor-pointer">
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              if (file.size > 10 * 1024 * 1024) {
                                toast({
                                  title: "File Too Large",
                                  description: "Please upload a file smaller than 10MB",
                                  variant: "destructive",
                                });
                                return;
                              }
                              setLicenseFile(file);
                            }
                          }}
                          className="hidden"
                        />
                        <span className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                          Click to upload license
                        </span>
                        <p className="text-xs text-gray-500 mt-1">
                          PDF, JPG, or PNG (max 10MB)
                        </p>
                      </label>
                      {licenseFile && (
                        <div className="mt-3 flex items-center justify-center gap-2 text-sm text-gray-700">
                          <FileText className="h-4 w-4" />
                          <span>{licenseFile.name}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Almost Done!</h3>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  {selectedLocation?.kitchenLicenseStatus === "approved" ? (
                    <>
                      <CheckCircle className="inline h-4 w-4 mr-1" />
                      Your license is approved! Bookings are now active.
                    </>
                  ) : selectedLocation?.kitchenLicenseUrl ? (
                    <>
                      <AlertCircle className="inline h-4 w-4 mr-1" />
                      Your license is pending admin approval. Bookings will be activated once
                      approved.
                    </>
                  ) : (
                    <>
                      <AlertCircle className="inline h-4 w-4 mr-1" />
                      Upload your kitchen license to activate bookings. You can do this later from
                      your dashboard.
                    </>
                  )}
                </p>
              </div>
              <div className="space-y-2 text-sm text-gray-600">
                <p>✓ Location information saved</p>
                {selectedLocation?.kitchenLicenseUrl ? (
                  <p>✓ License uploaded (pending approval)</p>
                ) : (
                  <p className="text-yellow-600">⚠ License not uploaded</p>
                )}
                <p>✓ Notification preferences configured</p>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-6 border-t">
          <Button
            variant="outline"
            onClick={handleSkip}
            disabled={completeOnboardingMutation.isPending}
          >
            Skip for Now
          </Button>
          <div className="flex gap-3">
            {currentStep > 1 && (
              <Button variant="outline" onClick={handleBack}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            )}
            <Button
              onClick={handleNext}
              disabled={
                updateLocationMutation.isPending ||
                uploadLicenseMutation.isPending ||
                completeOnboardingMutation.isPending
              }
            >
              {currentStep === steps.length ? (
                <>
                  {completeOnboardingMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Completing...
                    </>
                  ) : (
                    <>
                      Complete Setup
                      <CheckCircle className="h-4 w-4 ml-2" />
                    </>
                  )}
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

