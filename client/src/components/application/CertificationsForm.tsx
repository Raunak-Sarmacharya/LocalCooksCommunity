import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useApplicationForm } from "./ApplicationFormContext";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { ApplicationFormData } from "@/lib/applicationSchema";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useState } from "react";
import { Info, ExternalLink, Check, HelpCircle, ArrowRight, AlertTriangle, Upload, Link as LinkIcon } from "lucide-react";

import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileUpload } from "@/components/ui/file-upload";

// Create a schema for just the certifications fields
const certificationsSchema = z.object({
  foodSafetyLicense: z.enum(["yes", "no", "notSure"]),
  foodEstablishmentCert: z.enum(["yes", "no", "notSure"]),
  feedback: z.string().optional(),
});

type CertificationsFormData = z.infer<typeof certificationsSchema>;

export default function CertificationsForm() {
  const { formData, updateFormData, goToPreviousStep } = useApplicationForm();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  
  // Check if we're in production (Vercel)
  const isProduction = process.env.NODE_ENV === 'production';
  const [fileUploads, setFileUploads] = useState<Record<string, File>>({});
  
  // URL states for document links
  const [documentUrls, setDocumentUrls] = useState({
    foodSafetyLicenseUrl: "",
    foodEstablishmentCertUrl: ""
  });

  // Initialize file upload hook
  const { uploadFile, isUploading, uploadProgress, error: uploadError } = useFileUpload({
    maxSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
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
    }
  });

  const form = useForm<CertificationsFormData>({
    resolver: zodResolver(certificationsSchema),
    defaultValues: {
      foodSafetyLicense: formData.foodSafetyLicense,
      foodEstablishmentCert: formData.foodEstablishmentCert,
      feedback: formData.feedback || "",
    },
  });

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: ApplicationFormData & { files?: Record<string, File> }) => {
      console.log("Submitting application with data:", data);

      // Create FormData for multipart submission if files are included
      const hasFiles = data.files && Object.keys(data.files).length > 0;
      
      if (hasFiles) {
        const formData = new FormData();
        
        // Add all form fields
        Object.entries(data).forEach(([key, value]) => {
          if (key !== 'files' && value !== undefined) {
            formData.append(key, String(value));
          }
        });
        
        // Add files
        Object.entries(data.files!).forEach(([fieldName, file]) => {
          formData.append(fieldName, file);
        });
        
        const headers: Record<string, string> = {};
        if (user?.id) {
          headers["X-User-ID"] = user.id.toString();
        }

        const response = await fetch("/api/applications", {
          method: "POST",
          headers,
          body: formData,
          credentials: "include",
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || response.statusText);
        }

        return response.json();
      } else {
        // JSON submission for non-file data
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (user?.id) {
          headers["X-User-ID"] = user.id.toString();
        }

        const response = await fetch("/api/applications", {
          method: "POST",
          headers,
          body: JSON.stringify(data),
          credentials: "include",
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || response.statusText);
        }

        return response.json();
      }
    },
    onSuccess: () => {
      navigate("/success");
    },
    onError: (error: any) => {
      console.error("Application submission error:", error);
      let errorMessage = "Please try again later.";
      let title = "Error submitting application";
      let isAuthError = false;

      // Try to extract detailed error message from response
      if (error.message === "Authentication required" ||
        (error.response && error.response.status === 401)) {
        errorMessage = "You must be logged in to submit an application. Please log in and try again.";
        title = "Authentication Required";
        isAuthError = true;
      } else if (error.response) {
        try {
          errorMessage = error.response.error || error.message || errorMessage;
        } catch (e) {
          console.error("Error parsing error response:", e);
        }
      }

      toast({
        title: title,
        description: errorMessage,
        variant: "destructive",
      });

      // If it's an auth error, redirect to login
      if (isAuthError) {
        setTimeout(() => {
          navigate("/auth?redirect=/apply");
        }, 1500);
      }
    },
  });

  const onSubmit = async (data: CertificationsFormData) => {
    // Update the form data with the certification information
    updateFormData(data);

    // Check if user is authenticated
    if (!user) {
      toast({
        title: "Authentication required",
        description: "Please log in to submit your application.",
        variant: "destructive",
      });
      // Redirect to auth page
      navigate("/auth");
      return;
    }

    // Validate document submission for "yes" responses
    if (data.foodSafetyLicense === "yes" && !fileUploads.foodSafetyLicense && !documentUrls.foodSafetyLicenseUrl.trim()) {
      toast({
        title: "Food Safety License Required",
        description: "Please upload your Food Safety License document or provide a URL since you indicated you have one.",
        variant: "destructive",
      });
      return;
    }

    try {
      let uploadedFileUrls: Record<string, string> = {};

      // Upload files to cloud storage if any
      if (Object.keys(fileUploads).length > 0) {
        for (const [fieldName, file] of Object.entries(fileUploads)) {
          const result = await uploadFile(file);
          if (result) {
            // Store the uploaded file URL for the application
            uploadedFileUrls[`${fieldName}Url`] = result.url;
          } else {
            throw new Error(`Failed to upload ${fieldName}`);
          }
        }
      }

      // Combine all data and submit the complete form with user ID
      const completeFormData = {
        ...formData,
        ...data,
        ...uploadedFileUrls, // Add uploaded file URLs
        ...documentUrls, // Add direct URLs
        userId: user.id,
      } as ApplicationFormData;

      // Log for debugging
      console.log("Submitting application:", completeFormData);

      mutate(completeFormData);
      
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload files",
        variant: "destructive",
      });
    }
  };

  // File upload handlers
  const handleFileUpload = (fieldName: string, file: File | null) => {
    setFileUploads(prev => {
      const updated = { ...prev };
      if (file) {
        // Validate file type
        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
          toast({
            title: "Invalid file type",
            description: "Please upload PDF, JPG, PNG, or WebP files only.",
            variant: "destructive",
          });
          return prev;
        }
        
        // Validate file size (10MB limit)
        if (file.size > 10 * 1024 * 1024) {
          toast({
            title: "File too large",
            description: "Please upload files smaller than 10MB.",
            variant: "destructive",
          });
          return prev;
        }
        
        updated[fieldName] = file;
      } else {
        delete updated[fieldName];
      }
      return updated;
    });
  };



  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {/* Info Banner */}
        <div className="mb-8 bg-gradient-to-r from-indigo-50 to-blue-50 border-l-4 border-indigo-400 rounded-lg overflow-hidden">
          <div className="p-5">
            <div className="flex items-start">
              <div className="bg-indigo-200 rounded-full p-2 mr-3">
                <Info className="h-5 w-5 text-indigo-700" />
              </div>
              <div>
                <h3 className="text-indigo-800 font-medium text-lg mb-1">We're here to help!</h3>
                <p className="text-indigo-700 text-sm leading-relaxed mb-2">
                  Don't worry if you don't have certifications yet. We can guide you through the process once you're approved.
                </p>
                <p className="text-indigo-600 text-xs font-medium">
                  💡 If you have documents, you can upload files directly or provide cloud storage links (Google Drive, Dropbox, etc.)
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-8">
          {/* Food Safety License Section */}
          <div className="p-6 md:p-7 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
              <div>
                <div className="flex items-center">
                  <span className="bg-green-100 p-2 rounded-full mr-3">
                    <Check className="h-5 w-5 text-green-600" />
                  </span>
                  <h3 className="text-xl font-semibold text-gray-800">Food Safety License</h3>
                </div>
                <p className="text-gray-600 mt-2 ml-10 max-w-xl">Required for professional food preparation</p>
              </div>
              <a
                href="https://skillspassnl.com"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-medium py-2 px-4 rounded-lg transition-all duration-200 inline-flex items-center whitespace-nowrap border border-blue-200"
              >
                Learn more <ExternalLink className="h-3.5 w-3.5 ml-2" />
              </a>
            </div>

            <div className="ml-10">
              <p className="mb-4 text-gray-700 font-medium">Do you have a Food Safety License?*</p>
              <div className="flex flex-col space-y-4">
                <div 
                  className="flex items-start space-x-3 py-2 cursor-pointer" 
                  onClick={() => form.setValue("foodSafetyLicense", "yes")}
                >
                  <div className="relative flex-shrink-0 mt-1">
                    <div className={`h-4 w-4 rounded-full border-2 ${form.watch("foodSafetyLicense") === "yes" ? 'border-primary' : 'border-gray-300'}`}>
                      {form.watch("foodSafetyLicense") === "yes" && (
                        <div className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-primary" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
                      )}
                    </div>
                  </div>
                  <div className="flex-1">
                    <span className="font-medium cursor-pointer">Yes, I have a license</span>
                    <p className="text-sm text-gray-500 mt-1">I've completed the food safety training course</p>
                    
                    {/* Document Upload Section for Food Safety License */}
                    {form.watch("foodSafetyLicense") === "yes" && (
                      <div onClick={(e) => e.stopPropagation()}>
                        <Tabs defaultValue="upload" className="w-full mt-4">
                          <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="upload" className="flex items-center gap-2 text-xs">
                              <Upload className="h-3 w-3" />
                              Upload File
                            </TabsTrigger>
                            <TabsTrigger value="url" className="flex items-center gap-2 text-xs">
                              <LinkIcon className="h-3 w-3" />
                              Provide URL
                            </TabsTrigger>
                          </TabsList>
                          
                          <TabsContent value="upload" className="mt-3">
                            <FileUpload
                              fieldName="foodSafetyLicense"
                              label="Upload Food Safety License"
                              required={true}
                              currentFile={fileUploads.foodSafetyLicense}
                              onFileChange={(file) => handleFileUpload("foodSafetyLicense", file)}
                            />
                            <div className="mt-2 p-3 bg-blue-50 rounded-md">
                              <div className="flex items-start space-x-2">
                                <AlertTriangle className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                                <p className="text-sm text-blue-700">
                                  <strong>Upload from device:</strong> Select a clear photo or scan of your Food Safety License certificate.
                                </p>
                              </div>
                            </div>
                          </TabsContent>
                          
                          <TabsContent value="url" className="mt-3">
                            <div className="space-y-2">
                              <Label htmlFor="foodSafetyLicenseUrl" className="text-sm font-medium">
                                Food Safety License URL
                              </Label>
                              <Input
                                id="foodSafetyLicenseUrl"
                                type="url"
                                placeholder="https://drive.google.com/file/your-document..."
                                value={documentUrls.foodSafetyLicenseUrl}
                                onChange={(e) => setDocumentUrls(prev => ({ 
                                  ...prev, 
                                  foodSafetyLicenseUrl: e.target.value 
                                }))}
                                className="w-full"
                              />
                              <div className="mt-2 p-3 bg-green-50 rounded-md">
                                <div className="flex items-start space-x-2">
                                  <Info className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                                  <p className="text-sm text-green-700">
                                    <strong>Cloud storage:</strong> Provide a shareable link from Google Drive, Dropbox, OneDrive, etc. Make sure the link allows public viewing.
                                  </p>
                                </div>
                              </div>
                            </div>
                          </TabsContent>
                        </Tabs>
                      </div>
                    )}
                  </div>
                </div>
                <div 
                  className="flex items-start space-x-3 py-2 cursor-pointer" 
                  onClick={() => form.setValue("foodSafetyLicense", "no")}
                >
                  <div className="relative flex-shrink-0 mt-1">
                    <div className={`h-4 w-4 rounded-full border-2 ${form.watch("foodSafetyLicense") === "no" ? 'border-primary' : 'border-gray-300'}`}>
                      {form.watch("foodSafetyLicense") === "no" && (
                        <div className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-primary" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="font-medium cursor-pointer">Not yet, but I'd like to learn</span>
                    <p className="text-sm text-gray-500 mt-1">We'll guide you through the simple process</p>
                  </div>
                </div>
                <div 
                  className="flex items-start space-x-3 py-2 cursor-pointer" 
                  onClick={() => form.setValue("foodSafetyLicense", "notSure")}
                >
                  <div className="relative flex-shrink-0 mt-1">
                    <div className={`h-4 w-4 rounded-full border-2 ${form.watch("foodSafetyLicense") === "notSure" ? 'border-primary' : 'border-gray-300'}`}>
                      {form.watch("foodSafetyLicense") === "notSure" && (
                        <div className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-primary" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="font-medium cursor-pointer">I'd like to learn more</span>
                    <p className="text-sm text-gray-500 mt-1">I'm exploring my options and need more information</p>
                  </div>
                </div>
              </div>
              {form.formState.errors.foodSafetyLicense && (
                <p className="text-primary text-sm mt-2">
                  {form.formState.errors.foodSafetyLicense.message}
                </p>
              )}

              <div className="mt-5 p-4 bg-gray-50 rounded-lg border border-gray-100">
                <p className="text-sm text-gray-600 flex items-start">
                  <HelpCircle className="h-4 w-4 mr-2 text-primary mt-0.5 flex-shrink-0" />
                  <span>The Food Safety License is typically obtained through a 1-day course offered by SkillsPassNL. It teaches proper food handling, storage, and preparation methods to prevent foodborne illness.</span>
                </p>
              </div>
            </div>
          </div>

          {/* Food Establishment Certificate Section */}
          <div className="p-6 md:p-7 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
              <div>
                <div className="flex items-center">
                  <span className="bg-orange-100 p-2 rounded-full mr-3">
                    <Check className="h-5 w-5 text-orange-600" />
                  </span>
                  <h3 className="text-xl font-semibold text-gray-800">Food Establishment Certificate</h3>
                </div>
                <p className="text-gray-600 mt-2 ml-10 max-w-xl">Required for operating a food business</p>
              </div>
              <a
                href="https://www.gov.nl.ca/dgsnl/licences/env-health/food/"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-orange-50 hover:bg-orange-100 text-orange-700 text-sm font-medium py-2 px-4 rounded-lg transition-all duration-200 inline-flex items-center whitespace-nowrap border border-orange-200"
              >
                Provincial Guidelines <ExternalLink className="h-3.5 w-3.5 ml-2" />
              </a>
            </div>

            <div className="ml-10">
              <p className="mb-4 text-gray-700 font-medium">Do you have a Food Establishment Certificate?*</p>
              <div className="flex flex-col space-y-4">
                <div 
                  className="flex items-start space-x-3 py-2 cursor-pointer" 
                  onClick={() => form.setValue("foodEstablishmentCert", "yes")}
                >
                  <div className="relative flex-shrink-0 mt-1">
                    <div className={`h-4 w-4 rounded-full border-2 ${form.watch("foodEstablishmentCert") === "yes" ? 'border-primary' : 'border-gray-300'}`}>
                      {form.watch("foodEstablishmentCert") === "yes" && (
                        <div className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-primary" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
                      )}
                    </div>
                  </div>
                  <div className="flex-1">
                    <span className="font-medium cursor-pointer">Yes, I have a certificate</span>
                    <p className="text-sm text-gray-500 mt-1">My kitchen has been inspected and approved</p>
                    
                    {/* Document Upload Section for Food Establishment Certificate */}
                    {form.watch("foodEstablishmentCert") === "yes" && (
                      <div onClick={(e) => e.stopPropagation()}>
                        <Tabs defaultValue="upload" className="w-full mt-4">
                          <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="upload" className="flex items-center gap-2 text-xs">
                              <Upload className="h-3 w-3" />
                              Upload File
                            </TabsTrigger>
                            <TabsTrigger value="url" className="flex items-center gap-2 text-xs">
                              <LinkIcon className="h-3 w-3" />
                              Provide URL
                            </TabsTrigger>
                          </TabsList>
                          
                          <TabsContent value="upload" className="mt-3">
                            <FileUpload
                              fieldName="foodEstablishmentCert"
                              label="Upload Food Establishment Certificate"
                              required={false}
                              currentFile={fileUploads.foodEstablishmentCert}
                              onFileChange={(file) => handleFileUpload("foodEstablishmentCert", file)}
                            />
                            <div className="mt-2 p-3 bg-green-50 rounded-md">
                              <div className="flex items-start space-x-2">
                                <Check className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                                <p className="text-sm text-green-700">
                                  <strong>Optional but recommended:</strong> Upload your Food Establishment Certificate to speed up the verification process.
                                </p>
                              </div>
                            </div>
                          </TabsContent>
                          
                          <TabsContent value="url" className="mt-3">
                            <div className="space-y-2">
                              <Label htmlFor="foodEstablishmentCertUrl" className="text-sm font-medium">
                                Food Establishment Certificate URL (Optional)
                              </Label>
                              <Input
                                id="foodEstablishmentCertUrl"
                                type="url"
                                placeholder="https://drive.google.com/file/your-certificate..."
                                value={documentUrls.foodEstablishmentCertUrl}
                                onChange={(e) => setDocumentUrls(prev => ({ 
                                  ...prev, 
                                  foodEstablishmentCertUrl: e.target.value 
                                }))}
                                className="w-full"
                              />
                              <div className="mt-2 p-3 bg-orange-50 rounded-md">
                                <div className="flex items-start space-x-2">
                                  <Info className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
                                  <p className="text-sm text-orange-700">
                                    <strong>Optional:</strong> Provide a shareable link to your Food Establishment Certificate. This helps us verify your business setup faster.
                                  </p>
                                </div>
                              </div>
                            </div>
                          </TabsContent>
                        </Tabs>
                      </div>
                    )}
                  </div>
                </div>
                <div 
                  className="flex items-start space-x-3 py-2 cursor-pointer" 
                  onClick={() => form.setValue("foodEstablishmentCert", "no")}
                >
                  <div className="relative flex-shrink-0 mt-1">
                    <div className={`h-4 w-4 rounded-full border-2 ${form.watch("foodEstablishmentCert") === "no" ? 'border-primary' : 'border-gray-300'}`}>
                      {form.watch("foodEstablishmentCert") === "no" && (
                        <div className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-primary" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="font-medium cursor-pointer">Not yet, I'm interested</span>
                    <p className="text-sm text-gray-500 mt-1">We'll connect you with resources to get started</p>
                  </div>
                </div>
                <div 
                  className="flex items-start space-x-3 py-2 cursor-pointer" 
                  onClick={() => form.setValue("foodEstablishmentCert", "notSure")}
                >
                  <div className="relative flex-shrink-0 mt-1">
                    <div className={`h-4 w-4 rounded-full border-2 ${form.watch("foodEstablishmentCert") === "notSure" ? 'border-primary' : 'border-gray-300'}`}>
                      {form.watch("foodEstablishmentCert") === "notSure" && (
                        <div className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-primary" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="font-medium cursor-pointer">Tell me more</span>
                    <p className="text-sm text-gray-500 mt-1">I'd like to discuss my specific situation</p>
                  </div>
                </div>
              </div>
              {form.formState.errors.foodEstablishmentCert && (
                <p className="text-primary text-sm mt-2">
                  {form.formState.errors.foodEstablishmentCert.message}
                </p>
              )}

              <div className="mt-5 p-4 bg-gray-50 rounded-lg border border-gray-100">
                <p className="text-sm text-gray-600 flex items-start">
                  <HelpCircle className="h-4 w-4 mr-2 text-primary mt-0.5 flex-shrink-0" />
                  <span>This certificate is issued by Environmental Health Services after inspecting your food preparation area. It ensures your kitchen meets health and safety standards. We have relationships with commercial kitchens if you need a certified space.</span>
                </p>
              </div>
            </div>
          </div>

          {/* Feedback Field */}
          <div className="p-6 md:p-7 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200">
            <div className="mb-5">
              <div className="flex items-center">
                <span className="bg-purple-100 p-2 rounded-full mr-3">
                  <HelpCircle className="h-5 w-5 text-purple-600" />
                </span>
                <h3 className="text-xl font-semibold text-gray-800">Questions or Feedback?</h3>
              </div>
              <p className="text-gray-600 mt-2 ml-10 max-w-xl">Optional: Share any questions or additional information</p>
            </div>

            <div className="ml-10">
              <FormField
                control={form.control}
                name="feedback"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea
                        placeholder="Any other information you'd like to share or questions you have?"
                        className="resize-none h-28 border-gray-200 focus:border-primary focus:ring-primary"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </div>

        {/* Form Buttons */}
        <div className="flex justify-between items-center pt-8 mt-6 border-t border-gray-100">
          <Button
            type="button"
            variant="outline"
            onClick={goToPreviousStep}
            className="border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 px-5 py-2.5 rounded-lg font-medium text-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L7.414 9H15a1 1 0 110 2H7.414l2.293 2.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Previous Step
          </Button>

          <Button
            type="submit"
            disabled={isPending || isUploading}
            className="bg-primary text-white font-medium py-2.5 px-6 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 flex items-center relative overflow-hidden group"
          >
            <span className="relative z-10 flex items-center">
              {isUploading ? (
                <>Uploading files... {uploadProgress > 0 && `${Math.round(uploadProgress)}%`}</>
              ) : isPending ? (
                <>Submitting...</>
              ) : (
                <>
                  Submit Application
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform duration-200" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L12.586 11H5a1 1 0 110-2h7.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </>
              )}
            </span>
          </Button>
        </div>
      </form>
    </Form>
  );
}