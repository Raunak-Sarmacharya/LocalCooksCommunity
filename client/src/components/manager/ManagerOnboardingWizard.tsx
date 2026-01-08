import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
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
  Package,
  Wrench,
  Plus,
  Info,
} from "lucide-react";
import { useManagerDashboard } from "@/hooks/use-manager-dashboard";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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
  
  // Storage listing form state
  const [selectedKitchenId, setSelectedKitchenId] = useState<number | null>(null);
  const [kitchens, setKitchens] = useState<any[]>([]);
  const [storageFormData, setStorageFormData] = useState({
    storageType: 'dry' as 'dry' | 'cold' | 'freezer',
    name: '',
    description: '',
    basePrice: 0,
    minimumBookingDuration: 1,
    photos: [] as string[],
  });
  const [storagePhotoFiles, setStoragePhotoFiles] = useState<File[]>([]);
  const storageUploadHook = useSessionFileUpload({
    maxSize: 4.5 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  });
  
  // Equipment listing form state
  const [equipmentFormData, setEquipmentFormData] = useState({
    category: 'cooking' as 'cooking' | 'prep' | 'refrigeration' | 'baking' | 'other',
    name: '',
    description: '',
    condition: 'good' as 'excellent' | 'good' | 'fair' | 'needs_repair',
    availabilityType: 'rental' as 'included' | 'rental',
    sessionRate: 0,
    photos: [] as string[],
  });
  const [equipmentPhotoFiles, setEquipmentPhotoFiles] = useState<File[]>([]);
  const equipmentUploadHook = useSessionFileUpload({
    maxSize: 4.5 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  });

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
    {
      id: 4,
      title: "Storage Listings",
      description: "Add storage options (dry, cold, freezer) for chefs",
      icon: <Package className="h-6 w-6" />,
    },
    {
      id: 5,
      title: "Equipment Listings",
      description: "Add equipment options (cooking, prep, etc.) for chefs",
      icon: <Wrench className="h-6 w-6" />,
    },
  ];

  // Check if user is a manager using Firebase auth (with session fallback for backward compatibility)
  const { user: firebaseUser } = useFirebaseAuth();
  
  // Try Firebase auth first
  const { data: firebaseUserData } = useQuery({
    queryKey: ["/api/user/profile", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return null;
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) return null;
      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch("/api/user/profile", {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!firebaseUser,
  });

  // Firebase Auth only - no session fallback
  const userData = firebaseUserData;

  const isManager = userData?.role === "manager";
  const shouldAutoOpen = 
    isManager &&
    !userData?.manager_onboarding_completed &&
    !userData?.manager_onboarding_skipped;

  // Auto-open for new managers
  useEffect(() => {
    if (shouldAutoOpen && !isLoadingLocations) {
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
  }, [shouldAutoOpen, isLoadingLocations, locations]);

  // Listen for manual open events
  useEffect(() => {
    const handleOpenOnboarding = () => {
      if (isManager && !isLoadingLocations) {
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
    };

    window.addEventListener('open-onboarding', handleOpenOnboarding);
    return () => {
      window.removeEventListener('open-onboarding', handleOpenOnboarding);
    };
  }, [isManager, isLoadingLocations, locations]);

  // Load kitchens when location is selected
  useEffect(() => {
    if (selectedLocationId) {
      const loadKitchens = async () => {
        try {
          // Get Firebase token for authentication
          const { auth } = await import('@/lib/firebase');
          const currentFirebaseUser = auth.currentUser;
          if (!currentFirebaseUser) {
            throw new Error("Firebase user not available");
          }
          
          const token = await currentFirebaseUser.getIdToken();
          const response = await fetch(`/api/manager/kitchens/${selectedLocationId}`, {
            credentials: "include",
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });
          if (response.ok) {
            const data = await response.json();
            setKitchens(data);
            if (data.length === 1 && !selectedKitchenId) {
              setSelectedKitchenId(data[0].id);
            }
          }
        } catch (error) {
          console.error("Error loading kitchens:", error);
        }
      };
      loadKitchens();
    }
  }, [selectedLocationId]);

  const updateLocationMutation = useMutation({
    mutationFn: async (data: any) => {
      // Get Firebase token for authentication
      const { auth } = await import('@/lib/firebase');
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }
      
      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch(`/api/manager/locations/${selectedLocationId}`, {
        method: "PUT",
        headers: { 
          'Authorization': `Bearer ${token}`,
          "Content-Type": "application/json" 
        },
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
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
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
      // Get Firebase token for authentication
      const { auth } = await import('@/lib/firebase');
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }
      
      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch("/api/manager/complete-onboarding", {
        method: "POST",
        headers: { 
          'Authorization': `Bearer ${token}`,
          "Content-Type": "application/json" 
        },
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
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
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
      // Update notification settings
      try {
        await updateLocationMutation.mutateAsync({
          notificationEmail,
          notificationPhone,
        });
        setCurrentStep(4);
      } catch (error: any) {
        toast({
          title: "Error",
          description: error.message || "Failed to save settings",
          variant: "destructive",
        });
      }
    } else if (currentStep === 4) {
      // Storage listings step - optional, can skip
      setCurrentStep(5);
    } else if (currentStep === 5) {
      // Equipment listings step - optional, can skip
      setCurrentStep(6);
    } else if (currentStep === 6) {
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

  // Always render for managers, but only show dialog when open
  if (!isManager) {
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
                {selectedLocation?.kitchenLicenseUrl && selectedLocation?.kitchenLicenseStatus !== "rejected" ? (
                  <div className={`border rounded-lg p-4 ${
                    selectedLocation.kitchenLicenseStatus === "approved" 
                      ? "bg-green-50 border-green-200" 
                      : "bg-yellow-50 border-yellow-200"
                  }`}>
                    <div className={`flex items-center gap-2 ${
                      selectedLocation.kitchenLicenseStatus === "approved" 
                        ? "text-green-800" 
                        : "text-yellow-800"
                    }`}>
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">License Uploaded</span>
                    </div>
                    <p className={`text-sm mt-1 ${
                      selectedLocation.kitchenLicenseStatus === "approved" 
                        ? "text-green-700" 
                        : "text-yellow-700"
                    }`}>
                      Status: {selectedLocation.kitchenLicenseStatus || "pending"}
                    </p>
                    {selectedLocation.kitchenLicenseStatus === "approved" && (
                      <p className="text-xs text-green-600 mt-1">
                        ✓ Your license has been approved! Bookings are now active.
                      </p>
                    )}
                    {selectedLocation.kitchenLicenseStatus === "pending" && (
                      <p className="text-xs text-yellow-600 mt-1">
                        ⏳ Your license is pending admin approval. Bookings will be activated once approved.
                      </p>
                    )}
                  </div>
                ) : selectedLocation?.kitchenLicenseStatus === "rejected" ? (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-red-800 mb-2">
                      <AlertCircle className="h-5 w-5" />
                      <span className="font-medium">License Rejected</span>
                    </div>
                    {selectedLocation.kitchenLicenseFeedback && (
                      <p className="text-sm text-red-700 mb-3">
                        <strong>Admin Feedback:</strong> {selectedLocation.kitchenLicenseFeedback}
                      </p>
                    )}
                    <p className="text-sm text-red-700 mb-3">
                      Please upload a new license document to resubmit for approval.
                    </p>
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
                            Click to upload new license
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
              <h3 className="text-lg font-semibold">Notification Settings</h3>
              <p className="text-sm text-gray-600">
                Configure where you'll receive booking notifications and updates.
              </p>
              
              <div className="space-y-3">
                <div>
                  <Label htmlFor="notificationEmail">Notification Email</Label>
                  <Input
                    id="notificationEmail"
                    type="email"
                    value={notificationEmail}
                    onChange={(e) => setNotificationEmail(e.target.value)}
                    placeholder="notifications@example.com"
                    className="mt-1"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Booking notifications will be sent to this email. If left empty, notifications go to your account email.
                  </p>
                </div>
                <div>
                  <Label htmlFor="notificationPhone">Notification Phone (SMS)</Label>
                  <Input
                    id="notificationPhone"
                    type="tel"
                    value={notificationPhone}
                    onChange={(e) => setNotificationPhone(e.target.value)}
                    placeholder="(709) 555-1234"
                    className="mt-1"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    SMS notifications for bookings and cancellations. Optional.
                  </p>
                </div>
              </div>
            </div>
          )}

          {currentStep === 4 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Storage Listings</h3>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  <Info className="inline h-4 w-4 mr-1" />
                  Add storage options (dry, cold, freezer) that chefs can book. You can add more later from your dashboard.
                </p>
              </div>

              {kitchens.length === 0 ? (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm text-yellow-800">
                    No kitchens found for this location. Please create a kitchen first from your dashboard.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="kitchen-select">Select Kitchen</Label>
                    <Select
                      value={selectedKitchenId?.toString() || ""}
                      onValueChange={(value) => setSelectedKitchenId(parseInt(value))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select a kitchen" />
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
                    <div className="space-y-3 border rounded-lg p-4 bg-gray-50">
                      <div>
                        <Label htmlFor="storage-type">Storage Type</Label>
                        <Select
                          value={storageFormData.storageType}
                          onValueChange={(value: 'dry' | 'cold' | 'freezer') =>
                            setStorageFormData({ ...storageFormData, storageType: value })
                          }
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="dry">Dry Storage</SelectItem>
                            <SelectItem value="cold">Cold Storage</SelectItem>
                            <SelectItem value="freezer">Freezer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label htmlFor="storage-name">Storage Name *</Label>
                        <Input
                          id="storage-name"
                          value={storageFormData.name}
                          onChange={(e) => setStorageFormData({ ...storageFormData, name: e.target.value })}
                          placeholder="e.g., Main Dry Storage"
                          className="mt-1"
                        />
                      </div>

                      <div>
                        <Label htmlFor="storage-description">Description</Label>
                        <Textarea
                          id="storage-description"
                          value={storageFormData.description}
                          onChange={(e) => setStorageFormData({ ...storageFormData, description: e.target.value })}
                          placeholder="Describe the storage space..."
                          rows={3}
                          className="mt-1"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor="storage-price">Daily Rate (CAD) *</Label>
                          <Input
                            id="storage-price"
                            type="number"
                            min="0"
                            step="0.01"
                            value={storageFormData.basePrice}
                            onChange={(e) => setStorageFormData({ ...storageFormData, basePrice: parseFloat(e.target.value) || 0 })}
                            placeholder="0.00"
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label htmlFor="storage-min-days">Minimum Days *</Label>
                          <Input
                            id="storage-min-days"
                            type="number"
                            min="1"
                            value={storageFormData.minimumBookingDuration}
                            onChange={(e) => setStorageFormData({ ...storageFormData, minimumBookingDuration: parseInt(e.target.value) || 1 })}
                            placeholder="1"
                            className="mt-1"
                          />
                        </div>
                      </div>

                      <div>
                        <Label>Photos (Optional)</Label>
                        <div className="mt-2 border-2 border-dashed border-gray-300 rounded-lg p-4">
                          <input
                            type="file"
                            accept="image/jpeg,image/jpg,image/png,image/webp"
                            multiple
                            onChange={async (e) => {
                              const files = Array.from(e.target.files || []);
                              if (files.length > 0) {
                                setStoragePhotoFiles(files);
                                try {
                                  const results = await storageUploadHook.uploadMultipleFiles(files);
                                  setStorageFormData({
                                    ...storageFormData,
                                    photos: results.map(r => r.url),
                                  });
                                  toast({
                                    title: "Photos Uploaded",
                                    description: `${files.length} photo(s) uploaded successfully`,
                                  });
                                } catch (error: any) {
                                  toast({
                                    title: "Upload Failed",
                                    description: error.message || "Failed to upload photos",
                                    variant: "destructive",
                                  });
                                }
                              }
                            }}
                            className="hidden"
                            id="storage-photos"
                            disabled={storageUploadHook.isUploading}
                          />
                          <label
                            htmlFor="storage-photos"
                            className="cursor-pointer flex flex-col items-center gap-2"
                          >
                            {storageUploadHook.isUploading ? (
                              <>
                                <Loader2 className="h-8 w-8 text-gray-400 animate-spin" />
                                <span className="text-sm text-gray-600">Uploading...</span>
                              </>
                            ) : (
                              <>
                                <Upload className="h-8 w-8 text-gray-400" />
                                <span className="text-sm font-medium text-blue-600">Click to upload photos</span>
                                <span className="text-xs text-gray-500">PNG, JPG, WebP (max 4.5MB each)</span>
                              </>
                            )}
                          </label>
                          {storageFormData.photos.length > 0 && (
                            <div className="mt-3 grid grid-cols-3 gap-2">
                              {storageFormData.photos.map((url, idx) => (
                                <img key={idx} src={url} alt={`Storage ${idx + 1}`} className="w-full h-20 object-cover rounded" />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <Button
                        onClick={async () => {
                          if (!storageFormData.name || !selectedKitchenId) {
                            toast({
                              title: "Missing Information",
                              description: "Please fill in storage name",
                              variant: "destructive",
                            });
                            return;
                          }
                          try {
                            // Get Firebase token for authentication
                            const currentFirebaseUser = auth.currentUser;
                            if (!currentFirebaseUser) {
                              throw new Error("Firebase user not available");
                            }
                            
                            const token = await currentFirebaseUser.getIdToken();
                            const response = await fetch(`/api/manager/storage-listings`, {
                              method: "POST",
                              headers: { 
                                'Authorization': `Bearer ${token}`,
                                "Content-Type": "application/json" 
                              },
                              credentials: "include",
                              body: JSON.stringify({
                                kitchenId: selectedKitchenId,
                                name: storageFormData.name,
                                storageType: storageFormData.storageType,
                                description: storageFormData.description || null,
                                basePrice: storageFormData.basePrice, // API expects dollars, will convert to cents
                                pricingModel: 'daily', // Required field
                                minimumBookingDuration: storageFormData.minimumBookingDuration,
                                bookingDurationUnit: 'daily',
                                photos: storageFormData.photos,
                                currency: "CAD",
                                isActive: true,
                              }),
                            });
                            if (!response.ok) {
                              const error = await response.json();
                              throw new Error(error.error || "Failed to create storage listing");
                            }
                            toast({
                              title: "Storage Listing Created",
                              description: "You can add more listings from your dashboard later.",
                            });
                            // Reset form
                            setStorageFormData({
                              storageType: 'dry',
                              name: '',
                              description: '',
                              basePrice: 0,
                              minimumBookingDuration: 1,
                              photos: [],
                            });
                            setStoragePhotoFiles([]);
                          } catch (error: any) {
                            toast({
                              title: "Error",
                              description: error.message || "Failed to create storage listing",
                              variant: "destructive",
                            });
                          }
                        }}
                        className="w-full"
                        disabled={!storageFormData.name || !selectedKitchenId}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Storage Listing
                      </Button>
                    </div>
                  )}

                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-xs text-gray-600">
                      💡 <strong>Tip:</strong> You can skip this step and add storage listings later from your dashboard. Adding at least one listing helps chefs understand your offerings.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {currentStep === 5 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Equipment Listings</h3>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  <Info className="inline h-4 w-4 mr-1" />
                  Add equipment options (cooking, prep, refrigeration) that chefs can rent or use. You can add more later from your dashboard.
                </p>
              </div>

              {kitchens.length === 0 ? (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm text-yellow-800">
                    No kitchens found for this location. Please create a kitchen first from your dashboard.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="equipment-kitchen-select">Select Kitchen</Label>
                    <Select
                      value={selectedKitchenId?.toString() || ""}
                      onValueChange={(value) => setSelectedKitchenId(parseInt(value))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select a kitchen" />
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
                    <div className="space-y-3 border rounded-lg p-4 bg-gray-50">
                      <div>
                        <Label htmlFor="equipment-category">Category</Label>
                        <Select
                          value={equipmentFormData.category}
                          onValueChange={(value: 'cooking' | 'prep' | 'refrigeration' | 'baking' | 'other') =>
                            setEquipmentFormData({ ...equipmentFormData, category: value })
                          }
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cooking">Cooking Equipment</SelectItem>
                            <SelectItem value="prep">Prep Equipment</SelectItem>
                            <SelectItem value="refrigeration">Refrigeration</SelectItem>
                            <SelectItem value="baking">Baking Equipment</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label htmlFor="equipment-availability">Availability Type</Label>
                        <Select
                          value={equipmentFormData.availabilityType}
                          onValueChange={(value: 'included' | 'rental') =>
                            setEquipmentFormData({ ...equipmentFormData, availabilityType: value })
                          }
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="included">Included (Free with kitchen booking)</SelectItem>
                            <SelectItem value="rental">Rental (Paid add-on)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label htmlFor="equipment-name">Equipment Name *</Label>
                        <Input
                          id="equipment-name"
                          value={equipmentFormData.name}
                          onChange={(e) => setEquipmentFormData({ ...equipmentFormData, name: e.target.value })}
                          placeholder="e.g., Commercial Oven"
                          className="mt-1"
                        />
                      </div>

                      <div>
                        <Label htmlFor="equipment-description">Description</Label>
                        <Textarea
                          id="equipment-description"
                          value={equipmentFormData.description}
                          onChange={(e) => setEquipmentFormData({ ...equipmentFormData, description: e.target.value })}
                          placeholder="Describe the equipment..."
                          rows={3}
                          className="mt-1"
                        />
                      </div>

                      {equipmentFormData.availabilityType === 'rental' && (
                        <div>
                          <Label htmlFor="equipment-rate">Session Rate (CAD) *</Label>
                          <Input
                            id="equipment-rate"
                            type="number"
                            min="0"
                            step="0.01"
                            value={equipmentFormData.sessionRate}
                            onChange={(e) => setEquipmentFormData({ ...equipmentFormData, sessionRate: parseFloat(e.target.value) || 0 })}
                            placeholder="0.00"
                            className="mt-1"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            Flat rate charged once per kitchen booking session
                          </p>
                        </div>
                      )}

                      <div>
                        <Label htmlFor="equipment-condition">Condition</Label>
                        <Select
                          value={equipmentFormData.condition}
                          onValueChange={(value: 'excellent' | 'good' | 'fair' | 'needs_repair') =>
                            setEquipmentFormData({ ...equipmentFormData, condition: value })
                          }
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="excellent">Excellent</SelectItem>
                            <SelectItem value="good">Good</SelectItem>
                            <SelectItem value="fair">Fair</SelectItem>
                            <SelectItem value="needs_repair">Needs Repair</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label>Photos (Optional)</Label>
                        <div className="mt-2 border-2 border-dashed border-gray-300 rounded-lg p-4">
                          <input
                            type="file"
                            accept="image/jpeg,image/jpg,image/png,image/webp"
                            multiple
                            onChange={async (e) => {
                              const files = Array.from(e.target.files || []);
                              if (files.length > 0) {
                                setEquipmentPhotoFiles(files);
                                try {
                                  const results = await equipmentUploadHook.uploadMultipleFiles(files);
                                  setEquipmentFormData({
                                    ...equipmentFormData,
                                    photos: results.map(r => r.url),
                                  });
                                  toast({
                                    title: "Photos Uploaded",
                                    description: `${files.length} photo(s) uploaded successfully`,
                                  });
                                } catch (error: any) {
                                  toast({
                                    title: "Upload Failed",
                                    description: error.message || "Failed to upload photos",
                                    variant: "destructive",
                                  });
                                }
                              }
                            }}
                            className="hidden"
                            id="equipment-photos"
                            disabled={equipmentUploadHook.isUploading}
                          />
                          <label
                            htmlFor="equipment-photos"
                            className="cursor-pointer flex flex-col items-center gap-2"
                          >
                            {equipmentUploadHook.isUploading ? (
                              <>
                                <Loader2 className="h-8 w-8 text-gray-400 animate-spin" />
                                <span className="text-sm text-gray-600">Uploading...</span>
                              </>
                            ) : (
                              <>
                                <Upload className="h-8 w-8 text-gray-400" />
                                <span className="text-sm font-medium text-blue-600">Click to upload photos</span>
                                <span className="text-xs text-gray-500">PNG, JPG, WebP (max 4.5MB each)</span>
                              </>
                            )}
                          </label>
                          {equipmentFormData.photos.length > 0 && (
                            <div className="mt-3 grid grid-cols-3 gap-2">
                              {equipmentFormData.photos.map((url, idx) => (
                                <img key={idx} src={url} alt={`Equipment ${idx + 1}`} className="w-full h-20 object-cover rounded" />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <Button
                        onClick={async () => {
                          if (!equipmentFormData.name || !selectedKitchenId) {
                            toast({
                              title: "Missing Information",
                              description: "Please fill in equipment name",
                              variant: "destructive",
                            });
                            return;
                          }
                          if (equipmentFormData.availabilityType === 'rental' && equipmentFormData.sessionRate <= 0) {
                            toast({
                              title: "Missing Information",
                              description: "Please enter a session rate for rental equipment",
                              variant: "destructive",
                            });
                            return;
                          }
                          try {
                            // Get Firebase token for authentication
                            const currentFirebaseUser = auth.currentUser;
                            if (!currentFirebaseUser) {
                              throw new Error("Firebase user not available");
                            }
                            
                            const token = await currentFirebaseUser.getIdToken();
                            const response = await fetch(`/api/manager/equipment-listings`, {
                              method: "POST",
                              headers: { 
                                'Authorization': `Bearer ${token}`,
                                "Content-Type": "application/json" 
                              },
                              credentials: "include",
                              body: JSON.stringify({
                                kitchenId: selectedKitchenId,
                                name: equipmentFormData.name,
                                equipmentType: equipmentFormData.category, // API expects equipmentType
                                category: equipmentFormData.category,
                                description: equipmentFormData.description || null,
                                condition: equipmentFormData.condition,
                                availabilityType: equipmentFormData.availabilityType,
                                sessionRate: equipmentFormData.availabilityType === 'rental' ? equipmentFormData.sessionRate : 0, // API expects dollars, will convert to cents
                                photos: equipmentFormData.photos,
                                currency: "CAD",
                                pricingModel: equipmentFormData.availabilityType === 'rental' ? 'hourly' : null,
                                isActive: true,
                                status: 'draft',
                              }),
                            });
                            if (!response.ok) {
                              const error = await response.json();
                              throw new Error(error.error || "Failed to create equipment listing");
                            }
                            toast({
                              title: "Equipment Listing Created",
                              description: "You can add more listings from your dashboard later.",
                            });
                            // Reset form
                            setEquipmentFormData({
                              category: 'cooking',
                              name: '',
                              description: '',
                              condition: 'good',
                              availabilityType: 'rental',
                              sessionRate: 0,
                              photos: [],
                            });
                            setEquipmentPhotoFiles([]);
                          } catch (error: any) {
                            toast({
                              title: "Error",
                              description: error.message || "Failed to create equipment listing",
                              variant: "destructive",
                            });
                          }
                        }}
                        className="w-full"
                        disabled={!equipmentFormData.name || !selectedKitchenId || (equipmentFormData.availabilityType === 'rental' && equipmentFormData.sessionRate <= 0)}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Equipment Listing
                      </Button>
                    </div>
                  )}

                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-xs text-gray-600">
                      💡 <strong>Tip:</strong> You can skip this step and add equipment listings later from your dashboard. Adding at least one listing helps chefs understand your offerings.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {currentStep === 6 && (
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
                <p className="text-gray-400">○ Storage listings (optional - can add later)</p>
                <p className="text-gray-400">○ Equipment listings (optional - can add later)</p>
              </div>
              
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mt-4">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Next Steps</h4>
                <p className="text-xs text-gray-600 mb-2">
                  You can manage all your listings, bookings, and settings from your dashboard:
                </p>
                <ul className="text-xs text-gray-600 space-y-1 list-disc list-inside">
                  <li>Add more storage and equipment listings with photos</li>
                  <li>Manage bookings and availability</li>
                  <li>Update pricing and settings</li>
                  <li>View chef profiles and manage access</li>
                </ul>
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

