import { useFirebaseAuth } from "@/hooks/use-auth";
import { useChefKitchenApplications, useChefKitchenApplicationForLocation } from "@/hooks/use-chef-kitchen-applications";
import { useToast } from "@/hooks/use-toast";
import { useFileUpload } from "@/hooks/useFileUpload";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Check,
  ChefHat,
  Clock,
  FileText,
  Loader2,
  MapPin,
  Send,
  Shield,
  Upload,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useLocation } from "wouter";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileUpload } from "@/components/ui/file-upload";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

// Schema for kitchen application form
const kitchenApplicationSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  phone: z.string().min(10, "Please enter a valid phone number"),
  kitchenPreference: z.enum(["commercial", "home", "notSure"]),
  businessDescription: z.string().optional(),
  cookingExperience: z.string().optional(),
  foodSafetyLicense: z.enum(["yes", "no", "notSure"]),
  foodEstablishmentCert: z.enum(["yes", "no", "notSure"]),
});

type KitchenApplicationFormData = z.infer<typeof kitchenApplicationSchema>;

interface LocationInfo {
  id: number;
  name: string;
  address: string;
  city?: string;
  brandImageUrl?: string | null;
}

interface KitchenApplicationFormProps {
  location: LocationInfo;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export default function KitchenApplicationForm({
  location,
  onSuccess,
  onCancel,
}: KitchenApplicationFormProps) {
  const { user } = useFirebaseAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { createApplication, refetch } = useChefKitchenApplications();
  const { application, hasApplication, refetch: refetchLocationApp } = useChefKitchenApplicationForLocation(location.id);
  
  // File upload state
  const [foodSafetyFile, setFoodSafetyFile] = useState<File | null>(null);
  const [foodEstablishmentFile, setFoodEstablishmentFile] = useState<File | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 3;
  
  // File upload hook
  const { uploadFile, isUploading, uploadProgress, error: uploadError } = useFileUpload({
    maxSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    onSuccess: (response) => {
      toast({
        title: "File uploaded successfully",
        description: `${response.fileName} has been uploaded.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error,
        variant: "destructive",
      });
    },
  });

  const form = useForm<KitchenApplicationFormData>({
    resolver: zodResolver(kitchenApplicationSchema),
    defaultValues: {
      fullName: user?.displayName || "",
      email: user?.email || "",
      phone: "",
      kitchenPreference: "notSure",
      businessDescription: "",
      cookingExperience: "",
      foodSafetyLicense: "notSure",
      foodEstablishmentCert: "notSure",
    },
  });

  const onSubmit = async (data: KitchenApplicationFormData) => {
    try {
      // Create FormData for multipart submission
      const formData = new FormData();
      
      // Add form fields
      formData.append("locationId", location.id.toString());
      formData.append("fullName", data.fullName);
      formData.append("email", data.email);
      formData.append("phone", data.phone);
      formData.append("kitchenPreference", data.kitchenPreference);
      if (data.businessDescription) {
        formData.append("businessDescription", data.businessDescription);
      }
      if (data.cookingExperience) {
        formData.append("cookingExperience", data.cookingExperience);
      }
      formData.append("foodSafetyLicense", data.foodSafetyLicense);
      formData.append("foodEstablishmentCert", data.foodEstablishmentCert);
      
      // Add files if present - use separate field names for files
      if (foodSafetyFile) {
        formData.append("foodSafetyLicenseFile", foodSafetyFile);
      }
      if (foodEstablishmentFile) {
        formData.append("foodEstablishmentCertFile", foodEstablishmentFile);
      }
      
      await createApplication.mutateAsync(formData);
      
      toast({
        title: "Application Submitted!",
        description: `Your application to ${location.name} has been submitted. The kitchen manager will review it soon.`,
      });
      
      refetch();
      refetchLocationApp();
      
      if (onSuccess) {
        onSuccess();
      } else {
        navigate("/dashboard");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to submit application",
        variant: "destructive",
      });
    }
  };

  const goToNextStep = async (e?: React.MouseEvent<HTMLButtonElement>) => {
    // Explicitly prevent any form submission
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    // Don't proceed if we're on the final step (should use submit instead)
    if (currentStep >= totalSteps) {
      return;
    }
    
    // Validate current step fields
    let fieldsToValidate: (keyof KitchenApplicationFormData)[] = [];
    
    if (currentStep === 1) {
      fieldsToValidate = ["fullName", "email", "phone"];
    } else if (currentStep === 2) {
      fieldsToValidate = ["kitchenPreference"];
    }
    
    const isValid = await form.trigger(fieldsToValidate);
    if (isValid) {
      setCurrentStep((prev) => Math.min(prev + 1, totalSteps));
    }
  };

  const goToPreviousStep = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  // Check if user already has an application for this location
  if (hasApplication && application) {
    const statusConfig = {
      inReview: {
        icon: Clock,
        color: "text-yellow-600 bg-yellow-50 border-yellow-200",
        title: "Application Pending",
        description: "Your application is being reviewed by the kitchen manager.",
      },
      approved: {
        icon: Check,
        color: "text-green-600 bg-green-50 border-green-200",
        title: "Application Approved!",
        description: "You can now book kitchens at this location.",
      },
      rejected: {
        icon: XCircle,
        color: "text-red-600 bg-red-50 border-red-200",
        title: "Application Rejected",
        description: application.feedback || "Your application was not approved. You can submit a new application with updated information.",
      },
      cancelled: {
        icon: AlertCircle,
        color: "text-gray-600 bg-gray-50 border-gray-200",
        title: "Application Cancelled",
        description: "Your application was cancelled. You can submit a new application.",
      },
    };

    const config = statusConfig[application.status as keyof typeof statusConfig] || statusConfig.inReview;
    const StatusIcon = config.icon;

    return (
      <Card className="max-w-2xl mx-auto">
        <CardHeader className="text-center">
          <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center ${config.color} mb-4`}>
            <StatusIcon className="h-8 w-8" />
          </div>
          <CardTitle>{config.title}</CardTitle>
          <CardDescription>{config.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
              <Building2 className="h-5 w-5 text-gray-600" />
              <div>
                <p className="font-medium">{location.name}</p>
                <p className="text-sm text-gray-600">{location.address}</p>
              </div>
            </div>
            
            <div className="flex gap-3">
              <Button variant="outline" onClick={onCancel || (() => navigate("/dashboard"))} className="flex-1">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              
              {application.status === "approved" && (
                <Button 
                  onClick={() => navigate(`/book-kitchen?location=${location.id}`)} 
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  Book a Kitchen
                </Button>
              )}
              
              {(application.status === "rejected" || application.status === "cancelled") && (
                <Button 
                  onClick={() => {
                    // Reset the form state to allow re-application
                    window.location.reload();
                  }}
                  className="flex-1"
                >
                  Re-apply
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Handle form submission - ONLY allow on final step
  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // Always prevent default first
    e.preventDefault();
    e.stopPropagation();
    
    // Only allow form submission on the final step
    if (currentStep < totalSteps) {
      console.log(`Form submission blocked - on step ${currentStep}, need step ${totalSteps}`);
      return;
    }
    
    // On final step, trigger the actual submit
    form.handleSubmit(onSubmit)(e);
  };

  // Prevent Enter key from submitting form except on final step
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (currentStep < totalSteps) {
        goToNextStep();
      }
    }
  };

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-center gap-3 mb-2">
          {location.brandImageUrl ? (
            <img 
              src={location.brandImageUrl} 
              alt={location.name}
              className="w-12 h-12 rounded-lg object-cover"
            />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
              <Building2 className="h-6 w-6 text-white" />
            </div>
          )}
          <div>
            <CardTitle className="text-xl">Apply to {location.name}</CardTitle>
            <div className="flex items-center text-sm text-gray-600">
              <MapPin className="h-3.5 w-3.5 mr-1" />
              {location.address}
            </div>
          </div>
        </div>
        <CardDescription>
          Complete this application to request access to book kitchens at this location.
        </CardDescription>
        
        {/* Progress Indicator */}
        <div className="flex items-center gap-2 mt-4">
          {[1, 2, 3].map((step) => (
            <div key={step} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                  step === currentStep
                    ? "bg-blue-600 text-white"
                    : step < currentStep
                    ? "bg-green-500 text-white"
                    : "bg-gray-200 text-gray-600"
                }`}
              >
                {step < currentStep ? <Check className="h-4 w-4" /> : step}
              </div>
              {step < 3 && (
                <div
                  className={`w-12 h-1 mx-1 rounded ${
                    step < currentStep ? "bg-green-500" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-between text-xs text-gray-600 mt-1 px-1">
          <span>Personal Info</span>
          <span>Kitchen Preference</span>
          <span>Certifications</span>
        </div>
      </CardHeader>
      
      <CardContent>
        <Form {...form}>
          <form onSubmit={handleFormSubmit} onKeyDown={handleKeyDown} className="space-y-6">
            <AnimatePresence mode="wait">
              {/* Step 1: Personal Information */}
              {currentStep === 1 && (
                <motion.div
                  key="step1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="fullName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Your full name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="your@email.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone Number</FormLabel>
                        <FormControl>
                          <Input type="tel" placeholder="(416) 555-0123" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </motion.div>
              )}
              
              {/* Step 2: Kitchen Preference & Business Info */}
              {currentStep === 2 && (
                <motion.div
                  key="step2"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="kitchenPreference"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>What type of kitchen are you looking for?</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="grid gap-3"
                          >
                            <div className="flex items-center space-x-3 p-4 rounded-lg border hover:bg-gray-50 cursor-pointer">
                              <RadioGroupItem value="commercial" id="commercial" />
                              <Label htmlFor="commercial" className="cursor-pointer flex-1">
                                <span className="font-medium">Commercial Kitchen</span>
                                <p className="text-sm text-gray-600">Professional kitchen for food production</p>
                              </Label>
                            </div>
                            <div className="flex items-center space-x-3 p-4 rounded-lg border hover:bg-gray-50 cursor-pointer">
                              <RadioGroupItem value="home" id="home" />
                              <Label htmlFor="home" className="cursor-pointer flex-1">
                                <span className="font-medium">Home Kitchen</span>
                                <p className="text-sm text-gray-600">Residential kitchen approved for food prep</p>
                              </Label>
                            </div>
                            <div className="flex items-center space-x-3 p-4 rounded-lg border hover:bg-gray-50 cursor-pointer">
                              <RadioGroupItem value="notSure" id="notSure" />
                              <Label htmlFor="notSure" className="cursor-pointer flex-1">
                                <span className="font-medium">Not Sure Yet</span>
                                <p className="text-sm text-gray-600">I'd like to explore options</p>
                              </Label>
                            </div>
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="businessDescription"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tell us about your food business (optional)</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="What type of food do you prepare? What's your business model?"
                            className="resize-none"
                            rows={3}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="cookingExperience"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Your cooking experience (optional)</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="How long have you been cooking? Any professional experience?"
                            className="resize-none"
                            rows={3}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </motion.div>
              )}
              
              {/* Step 3: Certifications */}
              {currentStep === 3 && (
                <motion.div
                  key="step3"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-6"
                >
                  {/* Food Safety License */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Shield className="h-5 w-5 text-blue-600" />
                      <h3 className="font-semibold">Food Safety License</h3>
                    </div>
                    
                    <FormField
                      control={form.control}
                      name="foodSafetyLicense"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Do you have a Food Handler's Certificate?</FormLabel>
                          <FormControl>
                            <RadioGroup
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                              className="flex flex-wrap gap-4"
                            >
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="yes" id="foodSafety-yes" />
                                <Label htmlFor="foodSafety-yes">Yes</Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="no" id="foodSafety-no" />
                                <Label htmlFor="foodSafety-no">No</Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="notSure" id="foodSafety-notSure" />
                                <Label htmlFor="foodSafety-notSure">Not Sure</Label>
                              </div>
                            </RadioGroup>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    {form.watch("foodSafetyLicense") === "yes" && (
                      <div className="pl-4 border-l-2 border-blue-200">
                        <FileUpload
                          fieldName="foodSafetyLicenseFile"
                          label="Upload your Food Safety Certificate"
                          accept="image/*,application/pdf"
                          maxSize={10}
                          description="PDF or image file"
                          currentFile={foodSafetyFile}
                          onFileChange={(file: File | null) => setFoodSafetyFile(file)}
                        />
                      </div>
                    )}
                  </div>
                  
                  {/* Food Establishment Certificate */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-green-600" />
                      <h3 className="font-semibold">Food Establishment Certificate</h3>
                    </div>
                    
                    <FormField
                      control={form.control}
                      name="foodEstablishmentCert"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Do you have a Food Establishment License?</FormLabel>
                          <FormDescription className="text-xs">
                            This is typically required for commercial food production.
                          </FormDescription>
                          <FormControl>
                            <RadioGroup
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                              className="flex flex-wrap gap-4"
                            >
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="yes" id="foodEstab-yes" />
                                <Label htmlFor="foodEstab-yes">Yes</Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="no" id="foodEstab-no" />
                                <Label htmlFor="foodEstab-no">No</Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="notSure" id="foodEstab-notSure" />
                                <Label htmlFor="foodEstab-notSure">Not Sure</Label>
                              </div>
                            </RadioGroup>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    {form.watch("foodEstablishmentCert") === "yes" && (
                      <div className="pl-4 border-l-2 border-green-200">
                        <FileUpload
                          fieldName="foodEstablishmentCertFile"
                          label="Upload your Food Establishment Certificate"
                          accept="image/*,application/pdf"
                          maxSize={10}
                          description="PDF or image file"
                          currentFile={foodEstablishmentFile}
                          onFileChange={(file: File | null) => setFoodEstablishmentFile(file)}
                        />
                      </div>
                    )}
                  </div>
                  
                  {/* Info Box */}
                  <div className="p-4 bg-blue-50 rounded-lg flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-800">
                      <p className="font-medium">Don't have certifications yet?</p>
                      <p className="mt-1">
                        No problem! You can still apply. The kitchen manager may require 
                        certifications before you can start booking.
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            
            {/* Navigation Buttons */}
            <div className="flex gap-3 pt-4 border-t">
              {currentStep > 1 ? (
                <Button type="button" variant="outline" onClick={goToPreviousStep}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={onCancel || (() => window.history.back())}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
              )}
              
              <div className="flex-1" />
              
              {currentStep < totalSteps ? (
                <Button type="button" onClick={(e) => goToNextStep(e)}>
                  Continue
                </Button>
              ) : (
                <Button 
                  type="submit" 
                  disabled={createApplication.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {createApplication.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      Submit Application
                    </>
                  )}
                </Button>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

