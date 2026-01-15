import { useFirebaseAuth } from "@/hooks/use-auth";
import { useChefKitchenApplications, useChefKitchenApplicationForLocation } from "@/hooks/use-chef-kitchen-applications";
import { useToast } from "@/hooks/use-toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Check,
  ChefHat,
  Clock,
  FileText,
  Info,
  Loader2,
  MapPin,
  Send,
  Upload,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useLocation } from "wouter";
import { z } from "zod";
import { phoneNumberSchema } from "@shared/phone-validation";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// Schema for kitchen application form
const kitchenApplicationSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Please enter a valid email address"),
  phone: phoneNumberSchema, // Use shared phone validation schema
  businessName: z.string().min(1, "Business name is required"),
  businessType: z.string().min(1, "Please select a business type"),
  experience: z.string().min(1, "Please select your experience level"),
  businessDescription: z.string().optional(),
  foodHandlerCertExpiry: z.string().min(1, "Certificate expiry date is required"),
  foodEstablishmentCertExpiry: z.string().optional(),
  usageFrequency: z.string().min(1, "Please select usage frequency"),
  sessionDuration: z.string().min(1, "Please select session duration"),
  termsAgree: z.boolean().refine(val => val === true, "You must agree to the terms"),
  accuracyAgree: z.boolean().refine(val => val === true, "You must certify accuracy"),
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

// Business type options
const businessTypes = [
  { value: "catering", label: "Catering & Events" },
  { value: "bakery", label: "Bakery & Baked Goods" },
  { value: "meal-prep", label: "Meal Prep & Meal Plans" },
  { value: "specialty", label: "Specialty/Artisanal Foods" },
  { value: "pasta", label: "Pasta & Noodles" },
  { value: "sauce", label: "Sauces & Condiments" },
  { value: "prepared", label: "Prepared Meals" },
  { value: "other", label: "Other" },
];

// Experience options
const experienceLevels = [
  { value: "0-2", label: "0-2 years (Just starting)" },
  { value: "2-5", label: "2-5 years (Growing)" },
  { value: "5-10", label: "5-10 years (Established)" },
  { value: "10+", label: "10+ years (Expert)" },
];

// Frequency options
const usageFrequencies = [
  { value: "weekly", label: "Weekly (regular user)" },
  { value: "biweekly", label: "Bi-weekly (every 2 weeks)" },
  { value: "monthly", label: "Monthly or less" },
  { value: "as-needed", label: "As-needed (event-based)" },
];

// Duration options
const sessionDurations = [
  { value: "2-4", label: "2-4 hours" },
  { value: "4-8", label: "4-8 hours" },
  { value: "8-12", label: "8-12 hours (full day)" },
  { value: "12+", label: "12+ hours (extended)" },
];

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
  const [foodHandlerFile, setFoodHandlerFile] = useState<File | null>(null);
  const [businessLicenseFile, setBusinessLicenseFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Split user's display name into first and last
  const nameParts = user?.displayName?.split(' ') || ['', ''];
  const defaultFirstName = nameParts[0] || '';
  const defaultLastName = nameParts.slice(1).join(' ') || '';

  const form = useForm<KitchenApplicationFormData>({
    resolver: zodResolver(kitchenApplicationSchema),
    defaultValues: {
      firstName: defaultFirstName,
      lastName: defaultLastName,
      email: user?.email || "",
      phone: "",
      businessName: "",
      businessType: "",
      experience: "",
      businessDescription: "",
      foodHandlerCertExpiry: "",
      foodEstablishmentCertExpiry: "",
      usageFrequency: "",
      sessionDuration: "",
      termsAgree: false,
      accuracyAgree: false,
    },
    mode: "onChange",
  });

  // Watch all form values for progress calculation
  const watchedValues = useWatch({ control: form.control });

  // Calculate section progress
  const sectionProgress = useMemo(() => {
    const section1Fields = ['firstName', 'lastName', 'email', 'phone'] as const;
    const section2Fields = ['businessName', 'businessType', 'experience'] as const;
    const section3Fields = ['foodHandlerCertExpiry'] as const;
    const section4Fields = ['usageFrequency', 'sessionDuration'] as const;
    const section5Fields = ['termsAgree', 'accuracyAgree'] as const;

    const calcSectionProgress = (fields: readonly (keyof KitchenApplicationFormData)[]) => {
      let filled = 0;
      fields.forEach(field => {
        const value = watchedValues[field];
        if (typeof value === 'boolean') {
          if (value) filled++;
        } else if (value && String(value).trim()) {
          filled++;
        }
      });
      return Math.round((filled / fields.length) * 100);
    };

    // Section 3 includes file upload
    const section3Progress = () => {
      let filled = 0;
      let total = 2; // file + expiry date
      if (foodHandlerFile) filled++;
      if (watchedValues.foodHandlerCertExpiry) filled++;
      return Math.round((filled / total) * 100);
    };

    return {
      section1: calcSectionProgress(section1Fields),
      section2: calcSectionProgress(section2Fields),
      section3: section3Progress(),
      section4: calcSectionProgress(section4Fields),
      section5: calcSectionProgress(section5Fields),
    };
  }, [watchedValues, foodHandlerFile]);

  // Calculate overall progress
  const overallProgress = useMemo(() => {
    const { section1, section2, section3, section4, section5 } = sectionProgress;
    return Math.round((section1 + section2 + section3 + section4 + section5) / 5);
  }, [sectionProgress]);

  const onSubmit = async (data: KitchenApplicationFormData) => {
    // Validate file upload
    if (!foodHandlerFile) {
      toast({
        title: "Missing Document",
        description: "Please upload your Food Handler Certificate",
        variant: "destructive",
      });
      return;
    }

    // Validate expiry date (must be at least 6 months from now)
    const expiryDate = new Date(data.foodHandlerCertExpiry);
    const sixMonthsFromNow = new Date();
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
    
    if (expiryDate < sixMonthsFromNow) {
      toast({
        title: "Certificate Expiring Soon",
        description: "Your certificate must be valid for at least 6 months",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    
    try {
      const formData = new FormData();
      
      // Core fields
      formData.append("locationId", location.id.toString());
      formData.append("fullName", `${data.firstName} ${data.lastName}`);
      formData.append("email", data.email);
      formData.append("phone", data.phone);
      formData.append("kitchenPreference", "commercial"); // Default for new form
      
      // Business info - store in businessDescription field
      const businessInfo = JSON.stringify({
        businessName: data.businessName,
        businessType: data.businessType,
        experience: data.experience,
        description: data.businessDescription || "",
        usageFrequency: data.usageFrequency,
        sessionDuration: data.sessionDuration,
        foodHandlerCertExpiry: data.foodHandlerCertExpiry,
        foodEstablishmentCertExpiry: data.foodEstablishmentCertExpiry || null,
      });
      formData.append("businessDescription", businessInfo);
      formData.append("cookingExperience", data.experience);
      
      // Certification status
      formData.append("foodSafetyLicense", "yes");
      formData.append("foodEstablishmentCert", businessLicenseFile ? "yes" : "no");
      
      // Expiry dates
      formData.append("foodSafetyLicenseExpiry", data.foodHandlerCertExpiry);
      if (data.foodEstablishmentCertExpiry) {
        formData.append("foodEstablishmentCertExpiry", data.foodEstablishmentCertExpiry);
      }
      
      // Files
      if (foodHandlerFile) {
        formData.append("foodSafetyLicenseFile", foodHandlerFile);
      }
      if (businessLicenseFile) {
        formData.append("foodEstablishmentCertFile", businessLicenseFile);
      }
      
      await createApplication.mutateAsync(formData);
      
      setShowSuccess(true);
      refetch();
      refetchLocationApp();
      
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to submit application",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // File change handlers
  const handleFoodHandlerFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File Too Large",
          description: "Maximum file size is 5MB",
          variant: "destructive",
        });
        return;
      }
      setFoodHandlerFile(file);
    }
  };

  const handleBusinessLicenseFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File Too Large",
          description: "Maximum file size is 5MB",
          variant: "destructive",
        });
        return;
      }
      setBusinessLicenseFile(file);
    }
  };

  // Success screen
  if (showSuccess) {
    return (
      <div className="max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-12 px-6"
        >
          <div className="w-20 h-20 bg-[#2BA89F]/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="h-10 w-10 text-[#2BA89F]" />
          </div>
          <h2 className="text-2xl font-semibold text-gray-900 mb-3">Application Submitted!</h2>
          <p className="text-gray-600 mb-8 max-w-md mx-auto">
            Thank you! We've received your kitchen application and will review it within 24 hours. 
            Check your email for updates.
          </p>
          
          <div className="grid grid-cols-3 gap-4 mb-10">
            <div className="p-4 bg-[#208D80]/5 rounded-lg">
              <div className="text-2xl font-bold text-[#208D80] mb-1">1</div>
              <div className="text-xs text-gray-600">Documents Verified<br/>(24 hours)</div>
            </div>
            <div className="p-4 bg-[#208D80]/5 rounded-lg">
              <div className="text-2xl font-bold text-[#208D80] mb-1">2</div>
              <div className="text-xs text-gray-600">Account<br/>Activated</div>
            </div>
            <div className="p-4 bg-[#208D80]/5 rounded-lg">
              <div className="text-2xl font-bold text-[#208D80] mb-1">3</div>
              <div className="text-xs text-gray-600">Start Booking<br/>Kitchens</div>
            </div>
          </div>
          
          <Button 
            onClick={() => onSuccess ? onSuccess() : navigate("/dashboard")}
            className="w-full bg-[#208D80] hover:bg-[#1A7470]"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </motion.div>
      </div>
    );
  }

  // Check if user already has an application for this location
  if (hasApplication && application) {
    const statusConfig = {
      inReview: {
        icon: Clock,
        color: "text-amber-600 bg-amber-50",
        title: "Application Pending",
        description: "Your application is being reviewed by the kitchen manager.",
      },
      approved: {
        icon: Check,
        color: "text-[#2BA89F] bg-[#2BA89F]/10",
        title: "Application Approved!",
        description: "You can now book kitchens at this location.",
      },
      rejected: {
        icon: XCircle,
        color: "text-red-600 bg-red-50",
        title: "Application Rejected",
        description: application.feedback || "Your application was not approved. You can submit a new application.",
      },
      cancelled: {
        icon: AlertCircle,
        color: "text-gray-600 bg-gray-50",
        title: "Application Cancelled",
        description: "Your application was cancelled. You can submit a new application.",
      },
    };

    const config = statusConfig[application.status as keyof typeof statusConfig] || statusConfig.inReview;
    const StatusIcon = config.icon;

    return (
      <div className="max-w-2xl mx-auto">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-8 text-center">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${config.color}`}>
              <StatusIcon className="h-8 w-8" />
            </div>
            <h2 className="text-xl font-semibold mb-2">{config.title}</h2>
            <p className="text-gray-600 mb-6">{config.description}</p>
            
            <div className="flex items-center justify-center gap-3 p-4 bg-gray-50 rounded-lg mb-6">
              <Building2 className="h-5 w-5 text-gray-600" />
              <div className="text-left">
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
                  className="flex-1 bg-[#208D80] hover:bg-[#1A7470]"
                >
                  Book a Kitchen
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-[700px] mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2 flex items-center justify-center gap-2">
          <span>🍳</span> Chef Kitchen Application
        </h1>
        <p className="text-gray-600 text-sm">
          Apply to cook at <span className="font-medium">{location.name}</span>
        </p>
      </div>

      {/* Progress Bar */}
      <div className="mb-10">
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <motion.div 
            className="h-full bg-[#208D80] rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${overallProgress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
        <div className="text-right mt-1">
          <span className="text-xs text-gray-500">{overallProgress}% complete</span>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* SECTION 1: About You */}
          <Card className="border border-gray-200 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-6 pb-3 border-b-2 border-[#208D80]/10">
                <h3 className="font-semibold text-gray-900">About You</h3>
                <span className="text-xs font-medium text-[#208D80] bg-[#208D80]/10 px-2 py-1 rounded-full">
                  {sectionProgress.section1}%
                </span>
              </div>

              <div className="bg-[#208D80]/5 border-l-4 border-[#208D80] p-4 rounded-r-lg mb-6">
                <div className="flex gap-2">
                  <Info className="h-4 w-4 text-[#208D80] flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-gray-700">
                    We typically review applications within 24 hours. You'll need food safety certification to get started.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">
                        First Name <span className="text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} className="h-11" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">
                        Last Name <span className="text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} className="h-11" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">
                        Email Address <span className="text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input type="email" {...field} className="h-11" />
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
                      <FormLabel className="text-sm font-medium">
                        Phone Number <span className="text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input type="tel" placeholder="(709) 000-0000" {...field} className="h-11" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* SECTION 2: Your Food Business */}
          <Card className="border border-gray-200 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-6 pb-3 border-b-2 border-[#208D80]/10">
                <h3 className="font-semibold text-gray-900">Your Food Business</h3>
                <span className="text-xs font-medium text-[#208D80] bg-[#208D80]/10 px-2 py-1 rounded-full">
                  {sectionProgress.section2}%
                </span>
              </div>

              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="businessName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">
                        Business Name <span className="text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="e.g., Sarah's Catering, Artisan Bakery Co." 
                          {...field} 
                          className="h-11" 
                        />
                      </FormControl>
                      <p className="text-xs text-gray-500 mt-1">
                        What is your food business called? (If freelance, use your name)
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="businessType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">
                        Type of Food Business <span className="text-red-500">*</span>
                      </FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="h-11">
                            <SelectValue placeholder="-- Select your business type --" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {businessTypes.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="experience"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">
                        Years of Experience <span className="text-red-500">*</span>
                      </FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="h-11">
                            <SelectValue placeholder="-- Select experience level --" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {experienceLevels.map((level) => (
                            <SelectItem key={level.value} value={level.value}>
                              {level.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="businessDescription"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">Tell Us About Your Business</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Brief description of what you prepare, your target market, etc."
                          className="min-h-[80px] resize-none"
                          {...field}
                        />
                      </FormControl>
                      <p className="text-xs text-gray-500 mt-1">
                        Optional, but helps us connect you with suitable kitchen times
                      </p>
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* SECTION 3: Food Safety & Certifications */}
          <Card className="border border-gray-200 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-6 pb-3 border-b-2 border-[#208D80]/10">
                <h3 className="font-semibold text-gray-900">Food Safety & Certifications</h3>
                <span className="text-xs font-medium text-[#208D80] bg-[#208D80]/10 px-2 py-1 rounded-full">
                  {sectionProgress.section3}%
                </span>
              </div>

              <div className="bg-[#2BA89F]/5 border-l-4 border-[#2BA89F] p-4 rounded-r-lg mb-6">
                <div className="flex gap-2">
                  <Check className="h-4 w-4 text-[#2BA89F] flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-gray-700">
                    All chefs must have current <strong>Food Handler Certification</strong> to use our kitchens.
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                {/* Food Handler Certificate Upload */}
                <div>
                  <Label className="text-sm font-medium block mb-2">
                    Food Handler Certification <span className="text-red-500">*</span>
                  </Label>
                  <p className="text-xs text-gray-500 mb-3">
                    Upload a photo or PDF of your current food handler certificate (must be valid and current)
                  </p>
                  
                  <label 
                    htmlFor="foodHandlerCert" 
                    className={`flex items-center justify-center gap-3 p-5 border-2 border-dashed rounded-lg cursor-pointer transition-all
                      ${foodHandlerFile 
                        ? 'border-[#2BA89F] bg-[#2BA89F]/5' 
                        : 'border-gray-300 bg-[#208D80]/5 hover:border-[#208D80] hover:bg-[#208D80]/10'
                      }`}
                  >
                    <FileText className={`h-5 w-5 ${foodHandlerFile ? 'text-[#2BA89F]' : 'text-gray-600'}`} />
                    <div className="text-left">
                      <p className="text-sm font-medium text-gray-900">
                        {foodHandlerFile ? foodHandlerFile.name : 'Click to upload certificate'}
                      </p>
                      <p className="text-xs text-gray-500">PDF, JPG, PNG (max 5MB)</p>
                    </div>
                    {foodHandlerFile && <Check className="h-5 w-5 text-[#2BA89F] ml-auto" />}
                  </label>
                  <input 
                    type="file" 
                    id="foodHandlerCert" 
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleFoodHandlerFileChange}
                    className="hidden"
                  />
                  
                  {foodHandlerFile && (
                    <div className="flex items-center gap-2 mt-2 p-2 bg-[#2BA89F]/10 rounded text-[#2BA89F] text-sm">
                      <Check className="h-4 w-4" />
                      Food Handler Certificate uploaded
                    </div>
                  )}
                </div>

                {/* Food Handler Expiry Date */}
                <FormField
                  control={form.control}
                  name="foodHandlerCertExpiry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">
                        Food Handler Certificate Expiry Date <span className="text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input type="date" {...field} className="h-11" />
                      </FormControl>
                      <p className="text-xs text-gray-500 mt-1">
                        Your certification must be valid for at least 6 months
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Food Establishment License (Optional) */}
                <div>
                  <Label className="text-sm font-medium block mb-2">
                    Food Establishment License/Permit
                  </Label>
                  <p className="text-xs text-gray-500 mb-3">
                    If you operate as a registered food business, upload proof of license.
                  </p>
                  
                  <label 
                    htmlFor="businessLicense" 
                    className={`flex items-center justify-center gap-3 p-5 border-2 border-dashed rounded-lg cursor-pointer transition-all
                      ${businessLicenseFile 
                        ? 'border-[#2BA89F] bg-[#2BA89F]/5' 
                        : 'border-gray-300 bg-[#208D80]/5 hover:border-[#208D80] hover:bg-[#208D80]/10'
                      }`}
                  >
                    <Upload className={`h-5 w-5 ${businessLicenseFile ? 'text-[#2BA89F]' : 'text-gray-600'}`} />
                    <div className="text-left">
                      <p className="text-sm font-medium text-gray-900">
                        {businessLicenseFile ? businessLicenseFile.name : 'Click to upload license (optional)'}
                      </p>
                      <p className="text-xs text-gray-500">PDF, JPG, PNG (max 5MB)</p>
                    </div>
                    {businessLicenseFile && <Check className="h-5 w-5 text-[#2BA89F] ml-auto" />}
                  </label>
                  <input 
                    type="file" 
                    id="businessLicense" 
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleBusinessLicenseFileChange}
                    className="hidden"
                  />
                  
                  {businessLicenseFile && (
                    <div className="flex items-center gap-2 mt-2 p-2 bg-[#2BA89F]/10 rounded text-[#2BA89F] text-sm">
                      <Check className="h-4 w-4" />
                      Business License uploaded
                    </div>
                  )}
                </div>

                {/* Food Establishment Expiry (optional, shown always) */}
                <FormField
                  control={form.control}
                  name="foodEstablishmentCertExpiry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">
                        Food Establishment License Expiry Date
                      </FormLabel>
                      <FormControl>
                        <Input type="date" {...field} className="h-11" />
                      </FormControl>
                      <p className="text-xs text-gray-500 mt-1">
                        Optional - Enter if you have a food establishment license
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* SECTION 4: Kitchen Usage */}
          <Card className="border border-gray-200 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-6 pb-3 border-b-2 border-[#208D80]/10">
                <h3 className="font-semibold text-gray-900">Kitchen Usage</h3>
                <span className="text-xs font-medium text-[#208D80] bg-[#208D80]/10 px-2 py-1 rounded-full">
                  {sectionProgress.section4}%
                </span>
              </div>

              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="usageFrequency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">
                        How Often Do You Need Kitchen Space? <span className="text-red-500">*</span>
                      </FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="h-11">
                            <SelectValue placeholder="-- Select frequency --" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {usageFrequencies.map((freq) => (
                            <SelectItem key={freq.value} value={freq.value}>
                              {freq.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="sessionDuration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">
                        Typical Session Length <span className="text-red-500">*</span>
                      </FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="h-11">
                            <SelectValue placeholder="-- Select duration --" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {sessionDurations.map((dur) => (
                            <SelectItem key={dur.value} value={dur.value}>
                              {dur.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* SECTION 5: Terms & Agreements */}
          <Card className="border border-gray-200 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-6 pb-3 border-b-2 border-[#208D80]/10">
                <h3 className="font-semibold text-gray-900">Terms & Agreements</h3>
                <span className="text-xs font-medium text-[#208D80] bg-[#208D80]/10 px-2 py-1 rounded-full">
                  {sectionProgress.section5}%
                </span>
              </div>

              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="termsAgree"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          className="mt-1 data-[state=checked]:bg-[#208D80] data-[state=checked]:border-[#208D80]"
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-sm text-gray-700 font-normal cursor-pointer">
                          I agree to Local Cooks' kitchen usage policies and food safety standards, 
                          and understand that all chefs must maintain current food safety certifications.
                        </FormLabel>
                        <FormMessage />
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="accuracyAgree"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          className="mt-1 data-[state=checked]:bg-[#208D80] data-[state=checked]:border-[#208D80]"
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-sm text-gray-700 font-normal cursor-pointer">
                          I certify that all information provided is accurate and complete. 
                          I understand that misrepresentation may result in account suspension.
                        </FormLabel>
                        <FormMessage />
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <Button 
              type="button" 
              variant="outline" 
              onClick={onCancel || (() => window.history.back())}
              className="flex-shrink-0"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isSubmitting}
              className="flex-1 bg-[#208D80] hover:bg-[#1A7470] h-12 text-base font-semibold"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  Submit Application
                  <span className="ml-2">→</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
