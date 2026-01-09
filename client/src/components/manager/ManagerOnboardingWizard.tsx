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
  Sparkles,
  ArrowRight,
  HelpCircle,
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
  const [currentStep, setCurrentStep] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [uploadingLicense, setUploadingLicense] = useState(false);
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [notificationEmail, setNotificationEmail] = useState("");
  const [notificationPhone, setNotificationPhone] = useState("");
  
  // Kitchen creation form state
  const [showCreateKitchen, setShowCreateKitchen] = useState(false);
  const [kitchenFormData, setKitchenFormData] = useState({
    name: '',
    description: '',
  });
  const [creatingKitchen, setCreatingKitchen] = useState(false);
  
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
      id: 0,
      title: "Welcome",
      description: "Learn about the setup process",
      icon: <Sparkles className="h-6 w-6" />,
    },
    {
      id: 1,
      title: "Location & Contact",
      description: "Set up your location details and notification preferences",
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
      title: "Create Kitchen",
      description: "Set up your first kitchen space",
      icon: <Settings className="h-6 w-6" />,
    },
    {
      id: 4,
      title: "Storage Listings",
      description: "Add storage options (optional - can add later)",
      icon: <Package className="h-6 w-6" />,
    },
    {
      id: 5,
      title: "Equipment Listings",
      description: "Add equipment options (optional - can add later)",
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
  const stepsCompleted = userData?.manager_onboarding_steps_completed || {};
  const shouldAutoOpen = 
    isManager &&
    !userData?.manager_onboarding_completed &&
    !userData?.manager_onboarding_skipped;
  
  // Allow manual opening from help center even if completed
  const [manualOpen, setManualOpen] = useState(false);
  
  // Initialize stepsCompleted state
  const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>(stepsCompleted);

  // Listen for manual open from help center
  useEffect(() => {
    const handleOpenFromHelp = () => {
      if (isManager) {
        setManualOpen(true);
        setIsOpen(true);
      }
    };
    window.addEventListener('open-onboarding-from-help', handleOpenFromHelp);
    return () => {
      window.removeEventListener('open-onboarding-from-help', handleOpenFromHelp);
    };
  }, [isManager]);

  // Auto-open for new managers (only if not manually opened)
  useEffect(() => {
    if (shouldAutoOpen && !isLoadingLocations && !manualOpen) {
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
  }, [shouldAutoOpen, isLoadingLocations, locations, manualOpen]);


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
            if (data.length === 0) {
              setShowCreateKitchen(true);
            }
          }
        } catch (error) {
          console.error("Error loading kitchens:", error);
        }
      };
      loadKitchens();
    }
  }, [selectedLocationId]);

  const createKitchenMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      if (!selectedLocationId) {
        throw new Error("No location selected");
      }
      
      // Get Firebase token for authentication
      const { auth } = await import('@/lib/firebase');
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }
      
      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch(`/api/manager/kitchens`, {
        method: "POST",
        headers: { 
          'Authorization': `Bearer ${token}`,
          "Content-Type": "application/json" 
        },
        credentials: "include",
        body: JSON.stringify({
          locationId: selectedLocationId,
          name: data.name,
          description: data.description || undefined,
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create kitchen");
      }
      return response.json();
    },
    onSuccess: (data) => {
      // Reload kitchens and select the new one
      setKitchens([...kitchens, data]);
      setSelectedKitchenId(data.id);
      setShowCreateKitchen(false);
      setKitchenFormData({ name: '', description: '' });
      toast({
        title: "Kitchen Created",
        description: "Kitchen created successfully. You can now add storage and equipment listings.",
      });
    },
  });

  const updateLocationMutation = useMutation({
    mutationFn: async (data: any) => {
      // Get Firebase token for authentication
      const { auth } = await import('@/lib/firebase');
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }
      
      const token = await currentFirebaseUser.getIdToken();
      
      // If no location exists, create one first
      if (!selectedLocationId || locations.length === 0) {
        const response = await fetch(`/api/manager/locations`, {
          method: "POST",
          headers: { 
            'Authorization': `Bearer ${token}`,
            "Content-Type": "application/json" 
          },
          credentials: "include",
          body: JSON.stringify(data),
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to create location");
        }
        const newLocation = await response.json();
        setSelectedLocationId(newLocation.id);
        return newLocation;
      } else {
        // Update existing location
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
      }
    },
    onSuccess: (data) => {
      // If we just created a location, set it as selected
      if (data.id && !selectedLocationId) {
        setSelectedLocationId(data.id);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
    },
  });

  const uploadLicenseMutation = useMutation({
    mutationFn: async (file: File) => {
      setUploadingLicense(true);
      try {
        // Get Firebase token for authentication
        const { auth } = await import('@/lib/firebase');
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) {
          throw new Error("Firebase user not available");
        }
        
        const token = await currentFirebaseUser.getIdToken();
        
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/upload-file", {
          method: "POST",
          headers: {
            'Authorization': `Bearer ${token}`,
          },
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

  // Track step completion
  const trackStepCompletion = async (stepId: number) => {
    try {
      const { auth } = await import('@/lib/firebase');
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) return;
      
      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch("/api/manager/onboarding/step", {
        method: "POST",
        headers: { 
          'Authorization': `Bearer ${token}`,
          "Content-Type": "application/json" 
        },
        credentials: "include",
        body: JSON.stringify({ stepId }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setCompletedSteps(data.stepsCompleted || {});
        queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      }
    } catch (error) {
      console.error("Error tracking step completion:", error);
      // Don't block user flow if tracking fails
    }
  };

  const handleNext = async () => {
    if (currentStep === 0) {
      // Welcome step - just move to next
      await trackStepCompletion(0);
      setCurrentStep(1);
    } else if (currentStep === 1) {
      // Validate basic info
      if (!locationName || !locationAddress) {
        toast({
          title: "Missing Information",
          description: "Please fill in location name and address",
          variant: "destructive",
        });
        return;
      }

      // Update location with basic info and notification settings
      try {
        await updateLocationMutation.mutateAsync({
          name: locationName,
          address: locationAddress,
          notificationEmail,
          notificationPhone,
        });
        await trackStepCompletion(1);
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
      await trackStepCompletion(2);
      setCurrentStep(3);
    } else if (currentStep === 3) {
      // Kitchen creation step - can skip if kitchen already exists
      if (kitchens.length > 0 || selectedKitchenId) {
        setCurrentStep(4);
      } else if (!showCreateKitchen) {
        // If no kitchen exists and not showing create form, prompt to create
        toast({
          title: "Kitchen Required",
          description: "Please create a kitchen to continue, or click 'Skip for Now' to complete setup later.",
          variant: "destructive",
        });
        return;
      } else {
        // Kitchen form is showing, move to next step
        await trackStepCompletion(3);
        setCurrentStep(4);
      }
    } else if (currentStep === 4) {
      // Storage listings step - optional, can skip
      await trackStepCompletion(4);
      setCurrentStep(5);
    } else if (currentStep === 5) {
      // Equipment listings step - optional, can skip
      await trackStepCompletion(5);
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
    if (currentStep > 0) {
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
          <DialogTitle className="text-2xl">
            {currentStep === 0 ? "Welcome to Local Cooks Community!" : "Let's Set Up Your Kitchen"}
          </DialogTitle>
          <DialogDescription>
            {currentStep === 0 
              ? "We'll guide you through setting up your kitchen space in just a few steps"
              : "Complete these steps to activate bookings for your location"
            }
          </DialogDescription>
        </DialogHeader>

        {/* Progress Indicator */}
        <div className="flex items-center justify-between mb-8 mt-4">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center border-2 ${
                    currentStep > step.id || completedSteps[`step_${step.id}`]
                      ? "bg-green-500 border-green-500 text-white"
                      : currentStep === step.id
                      ? "bg-blue-500 border-blue-500 text-white"
                      : "bg-gray-100 border-gray-300 text-gray-400"
                  }`}
                >
                  {currentStep > step.id || completedSteps[`step_${step.id}`] ? (
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
                    currentStep > step.id || completedSteps[`step_${step.id}`] ? "bg-green-500" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div className="space-y-6">
          {currentStep === 0 && (
            <div className="space-y-6">
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Sparkles className="h-8 w-8 text-blue-600" />
                  <h3 className="text-xl font-semibold text-gray-900">Getting Started</h3>
                </div>
                <p className="text-gray-700 mb-4">
                  We'll help you set up your kitchen space so chefs can start booking. This process takes about 5-10 minutes.
                </p>
                
                <div className="space-y-4 mt-6">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold">
                      1
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900">Location & Contact Info</h4>
                      <p className="text-sm text-gray-600">Tell us about your kitchen location and how to reach you</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold">
                      2
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900">Kitchen License</h4>
                      <p className="text-sm text-gray-600">Upload your license (required for bookings to be activated)</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold">
                      3
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900">Create Your Kitchen</h4>
                      <p className="text-sm text-gray-600">Set up your first kitchen space (you can add more later)</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 font-semibold">
                      4-5
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900">Add Listings (Optional)</h4>
                      <p className="text-sm text-gray-600">Add storage and equipment options - you can skip and add these later</p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-white rounded-lg border border-blue-200">
                  <div className="flex items-start gap-2">
                    <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-gray-700">
                      <p className="font-semibold mb-1">Understanding the Structure:</p>
                      <ul className="space-y-1 ml-4 list-disc">
                        <li><strong>Location</strong> - Your business address (e.g., "The Lantern")</li>
                        <li><strong>Kitchen</strong> - A specific kitchen space within your location</li>
                        <li><strong>Listings</strong> - Storage and equipment that chefs can book</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentStep === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-1">Location & Contact Information</h3>
                <p className="text-sm text-gray-600">
                  Tell us about your kitchen location and how you'd like to receive booking notifications.
                </p>
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <HelpCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-gray-700">
                    <p className="font-semibold mb-1">What is a Location?</p>
                    <p>Your location is your business address. This is what chefs will see when searching for kitchen spaces. You can have multiple kitchens within one location.</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="location-name" className="flex items-center gap-2">
                    Location Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="location-name"
                    type="text"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    placeholder="e.g., The Lantern Kitchen"
                    className="mt-1"
                  />
                  <p className="text-xs text-gray-500 mt-1">The name of your kitchen business or location</p>
                </div>
                
                <div>
                  <Label htmlFor="location-address" className="flex items-center gap-2">
                    Full Address <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="location-address"
                    type="text"
                    value={locationAddress}
                    onChange={(e) => setLocationAddress(e.target.value)}
                    placeholder="e.g., 123 Main St, St. John's, NL A1B 2C3"
                    className="mt-1"
                  />
                  <p className="text-xs text-gray-500 mt-1">Complete street address where your kitchen is located</p>
                </div>
                
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">Notification Preferences (Optional)</h4>
                  <p className="text-xs text-gray-600 mb-4">
                    Configure where you'll receive booking notifications. If left empty, notifications will be sent to your account email.
                  </p>
                  
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="notification-email">Notification Email</Label>
                      <Input
                        id="notification-email"
                        type="email"
                        value={notificationEmail}
                        onChange={(e) => setNotificationEmail(e.target.value)}
                        placeholder="notifications@example.com"
                        className="mt-1"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Email address for booking confirmations, cancellations, and updates
                      </p>
                    </div>
                    
                    <div>
                      <Label htmlFor="notification-phone">Notification Phone (SMS)</Label>
                      <Input
                        id="notification-phone"
                        type="tel"
                        value={notificationPhone}
                        onChange={(e) => setNotificationPhone(e.target.value)}
                        placeholder="(709) 555-1234"
                        className="mt-1"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Phone number for SMS notifications (optional)
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-1">Kitchen License</h3>
                <p className="text-sm text-gray-600">
                  Upload your kitchen operating license for admin approval. This is required to activate bookings.
                </p>
              </div>
              
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-yellow-800 font-medium mb-1">
                      License Required for Booking Activation
                    </p>
                    <p className="text-xs text-yellow-700 mb-2">
                      Your kitchen license must be approved by an admin before bookings can be activated. 
                      You can skip this step and upload later, but bookings will remain disabled until approved.
                    </p>
                    <p className="text-xs text-yellow-700">
                      <strong>Accepted formats:</strong> PDF, JPG, PNG (max 10MB)
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
              <div>
                <h3 className="text-lg font-semibold mb-1">Create Your First Kitchen</h3>
                <p className="text-sm text-gray-600">
                  A kitchen is a specific space within your location where chefs can book time. You can add more kitchens later.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <HelpCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-gray-700">
                    <p className="font-semibold mb-1">Why do I need a Kitchen?</p>
                    <p>Each kitchen space can have its own storage and equipment listings. If you have multiple kitchen spaces at your location, create separate kitchens for each one.</p>
                  </div>
                </div>
              </div>

              {kitchens.length > 0 ? (
                <div className="space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-green-800">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">Kitchen Created!</span>
                    </div>
                    <p className="text-sm text-green-700 mt-1">
                      You have {kitchens.length} kitchen{kitchens.length > 1 ? 's' : ''} set up. You can add more from your dashboard later.
                    </p>
                  </div>
                  
                  {kitchens.length === 1 && (
                    <div className="border rounded-lg p-4 bg-gray-50">
                      <p className="text-sm font-medium text-gray-900 mb-1">Current Kitchen:</p>
                      <p className="text-sm text-gray-700">{kitchens[0].name}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {showCreateKitchen ? (
                    <div className="border rounded-lg p-4 bg-gray-50">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">Create Kitchen</h4>
                      <div className="space-y-3">
                        <div>
                          <Label htmlFor="kitchen-name">
                            Kitchen Name <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="kitchen-name"
                            value={kitchenFormData.name}
                            onChange={(e) => setKitchenFormData({ ...kitchenFormData, name: e.target.value })}
                            placeholder="e.g., Main Kitchen"
                            className="mt-1"
                          />
                          <p className="text-xs text-gray-500 mt-1">Give your kitchen a descriptive name</p>
                        </div>
                        <div>
                          <Label htmlFor="kitchen-description">Description (Optional)</Label>
                          <Textarea
                            id="kitchen-description"
                            value={kitchenFormData.description}
                            onChange={(e) => setKitchenFormData({ ...kitchenFormData, description: e.target.value })}
                            placeholder="Describe your kitchen space, size, features..."
                            rows={3}
                            className="mt-1"
                          />
                          <p className="text-xs text-gray-500 mt-1">Help chefs understand what makes your kitchen special</p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={async () => {
                              if (!kitchenFormData.name.trim()) {
                                toast({
                                  title: "Missing Information",
                                  description: "Please enter a kitchen name",
                                  variant: "destructive",
                                });
                                return;
                              }
                              setCreatingKitchen(true);
                              try {
                                await createKitchenMutation.mutateAsync(kitchenFormData);
                              } finally {
                                setCreatingKitchen(false);
                              }
                            }}
                            disabled={creatingKitchen || createKitchenMutation.isPending}
                          >
                            {creatingKitchen || createKitchenMutation.isPending ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Creating...
                              </>
                            ) : (
                              <>
                                <Plus className="h-4 w-4 mr-2" />
                                Create Kitchen
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowCreateKitchen(false);
                              setKitchenFormData({ name: '', description: '' });
                            }}
                            disabled={creatingKitchen || createKitchenMutation.isPending}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                      <Settings className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                      <p className="text-sm font-medium text-gray-900 mb-1">No kitchen created yet</p>
                      <p className="text-xs text-gray-600 mb-4">
                        Create your first kitchen to start adding storage and equipment listings
                      </p>
                      <Button
                        onClick={() => setShowCreateKitchen(true)}
                        className="w-full"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Create Your First Kitchen
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {currentStep === 4 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-1">Storage Listings (Optional)</h3>
                <p className="text-sm text-gray-600">
                  Add storage options that chefs can book. This step is optional - you can skip and add listings later from your dashboard.
                </p>
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-blue-800">
                    <p className="font-semibold mb-1">What are Storage Listings?</p>
                    <p>Storage listings allow chefs to book dry storage, cold storage, or freezer space at your kitchen. You can add multiple storage options with different sizes and prices.</p>
                  </div>
                </div>
              </div>

              {kitchens.length === 0 ? (
                <div className="space-y-4">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <p className="text-sm text-yellow-800 mb-3">
                      No kitchens found for this location. Create your first kitchen to get started.
                    </p>
                  </div>
                  
                  {showCreateKitchen ? (
                    <div className="border rounded-lg p-4 bg-gray-50">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">Create Kitchen</h4>
                      <div className="space-y-3">
                        <div>
                          <Label htmlFor="kitchen-name">Kitchen Name *</Label>
                          <Input
                            id="kitchen-name"
                            value={kitchenFormData.name}
                            onChange={(e) => setKitchenFormData({ ...kitchenFormData, name: e.target.value })}
                            placeholder="e.g., Main Kitchen"
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label htmlFor="kitchen-description">Description (Optional)</Label>
                          <Textarea
                            id="kitchen-description"
                            value={kitchenFormData.description}
                            onChange={(e) => setKitchenFormData({ ...kitchenFormData, description: e.target.value })}
                            placeholder="Describe your kitchen..."
                            rows={3}
                            className="mt-1"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={async () => {
                              if (!kitchenFormData.name.trim()) {
                                toast({
                                  title: "Missing Information",
                                  description: "Please enter a kitchen name",
                                  variant: "destructive",
                                });
                                return;
                              }
                              setCreatingKitchen(true);
                              try {
                                await createKitchenMutation.mutateAsync(kitchenFormData);
                              } finally {
                                setCreatingKitchen(false);
                              }
                            }}
                            disabled={creatingKitchen || createKitchenMutation.isPending}
                          >
                            {creatingKitchen || createKitchenMutation.isPending ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Creating...
                              </>
                            ) : (
                              <>
                                <Plus className="h-4 w-4 mr-2" />
                                Create Kitchen
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowCreateKitchen(false);
                              setKitchenFormData({ name: '', description: '' });
                            }}
                            disabled={creatingKitchen || createKitchenMutation.isPending}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Button
                      onClick={() => setShowCreateKitchen(true)}
                      className="w-full"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Create Your First Kitchen
                    </Button>
                  )}
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
              <div>
                <h3 className="text-lg font-semibold mb-1">Equipment Listings (Optional)</h3>
                <p className="text-sm text-gray-600">
                  Add equipment that chefs can use or rent. This step is optional - you can skip and add listings later from your dashboard.
                </p>
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-blue-800">
                    <p className="font-semibold mb-1">What are Equipment Listings?</p>
                    <p>Equipment listings let chefs know what equipment is available. You can offer equipment as included with bookings or as paid add-ons (rentals).</p>
                  </div>
                </div>
              </div>

              {kitchens.length === 0 ? (
                <div className="space-y-4">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <p className="text-sm text-yellow-800 mb-3">
                      No kitchens found for this location. Create your first kitchen to get started.
                    </p>
                  </div>
                  
                  {showCreateKitchen ? (
                    <div className="border rounded-lg p-4 bg-gray-50">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">Create Kitchen</h4>
                      <div className="space-y-3">
                        <div>
                          <Label htmlFor="equipment-kitchen-name">Kitchen Name *</Label>
                          <Input
                            id="equipment-kitchen-name"
                            value={kitchenFormData.name}
                            onChange={(e) => setKitchenFormData({ ...kitchenFormData, name: e.target.value })}
                            placeholder="e.g., Main Kitchen"
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label htmlFor="equipment-kitchen-description">Description (Optional)</Label>
                          <Textarea
                            id="equipment-kitchen-description"
                            value={kitchenFormData.description}
                            onChange={(e) => setKitchenFormData({ ...kitchenFormData, description: e.target.value })}
                            placeholder="Describe your kitchen..."
                            rows={3}
                            className="mt-1"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={async () => {
                              if (!kitchenFormData.name.trim()) {
                                toast({
                                  title: "Missing Information",
                                  description: "Please enter a kitchen name",
                                  variant: "destructive",
                                });
                                return;
                              }
                              setCreatingKitchen(true);
                              try {
                                await createKitchenMutation.mutateAsync(kitchenFormData);
                              } finally {
                                setCreatingKitchen(false);
                              }
                            }}
                            disabled={creatingKitchen || createKitchenMutation.isPending}
                          >
                            {creatingKitchen || createKitchenMutation.isPending ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Creating...
                              </>
                            ) : (
                              <>
                                <Plus className="h-4 w-4 mr-2" />
                                Create Kitchen
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowCreateKitchen(false);
                              setKitchenFormData({ name: '', description: '' });
                            }}
                            disabled={creatingKitchen || createKitchenMutation.isPending}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Button
                      onClick={() => setShowCreateKitchen(true)}
                      className="w-full"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Create Your First Kitchen
                    </Button>
                  )}
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
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
                <h3 className="text-xl font-semibold mb-2">You're All Set!</h3>
                <p className="text-sm text-gray-600">
                  Your kitchen setup is complete. Here's what happens next:
                </p>
              </div>

              <div className="space-y-3">
                <div className={`border rounded-lg p-4 ${
                  selectedLocation?.kitchenLicenseStatus === "approved" 
                    ? "bg-green-50 border-green-200" 
                    : selectedLocation?.kitchenLicenseUrl
                    ? "bg-yellow-50 border-yellow-200"
                    : "bg-orange-50 border-orange-200"
                }`}>
                  <div className="flex items-start gap-3">
                    {selectedLocation?.kitchenLicenseStatus === "approved" ? (
                      <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                    )}
                    <div>
                      <p className="text-sm font-semibold text-gray-900 mb-1">License Status</p>
                      {selectedLocation?.kitchenLicenseStatus === "approved" ? (
                        <p className="text-sm text-green-700">
                          ✓ Your license is approved! Bookings are now active and chefs can start booking your kitchen.
                        </p>
                      ) : selectedLocation?.kitchenLicenseUrl ? (
                        <p className="text-sm text-yellow-700">
                          ⏳ Your license is pending admin approval. Bookings will be activated once approved. 
                          You'll receive an email notification when your license is reviewed.
                        </p>
                      ) : (
                        <p className="text-sm text-orange-700">
                          ⚠️ Upload your kitchen license to activate bookings. You can do this from your dashboard settings.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">Setup Summary</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="text-gray-700">Location information saved</span>
                    </div>
                    {selectedLocation?.kitchenLicenseUrl ? (
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span className="text-gray-700">License uploaded</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-yellow-600" />
                        <span className="text-gray-600">License not uploaded (can add later)</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="text-gray-700">Notification preferences configured</span>
                    </div>
                    {kitchens.length > 0 ? (
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span className="text-gray-700">{kitchens.length} kitchen{kitchens.length > 1 ? 's' : ''} created</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-yellow-600" />
                        <span className="text-gray-600">No kitchen created yet (can add later)</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Info className="h-4 w-4 text-gray-400" />
                      <span className="text-gray-500">Storage & equipment listings (optional - can add later)</span>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">What's Next?</h4>
                <p className="text-xs text-gray-700 mb-3">
                  You can manage everything from your dashboard:
                </p>
                <ul className="text-xs text-gray-700 space-y-1.5 list-disc list-inside">
                  <li>Add more kitchens, storage, and equipment listings with photos</li>
                  <li>Manage bookings, availability, and pricing</li>
                  <li>Update your location settings and license</li>
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
            {currentStep > 0 && (
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
                  {currentStep === 0 ? "Get Started" : "Next"}
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

