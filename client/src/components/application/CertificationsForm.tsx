import { logger } from "@/lib/logger";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useFileUpload } from "@/hooks/useFileUpload";
import { ApplicationFormData } from "@/lib/applicationSchema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, Link as LinkIcon, Upload } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useLocation } from "wouter";
import { z } from "zod";
import { useApplicationForm } from "./ApplicationFormContext";
import { useTranslation } from "react-i18next";
import { auth } from "@/lib/firebase";
import { InfoHint } from "@/components/chef/ui";
import { ApplicationStepFooter } from "./ApplicationStepFooter";

import { Button } from "@/components/ui/button";
import { FileUpload } from "@/components/ui/file-upload";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

// Create a schema for just the certifications fields
const certificationsSchema = z.object({
  foodSafetyLicense: z.enum(["yes", "no"]),
  foodEstablishmentCert: z.enum(["yes", "no"]),
  feedback: z.string().optional(),
});

type CertificationsFormData = z.infer<typeof certificationsSchema>;

export default function CertificationsForm() {
  const { t } = useTranslation("chef");
  const { formData, updateFormData } = useApplicationForm();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useFirebaseAuth();
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
      logger.info("🚀 Submitting application with data:", data);

      // Get Firebase auth token
      let authToken: string | null = null;
      const currentFirebaseUser = auth.currentUser;
      if (currentFirebaseUser) {
        try {
          authToken = await currentFirebaseUser.getIdToken();
        } catch (tokenError) {
          logger.error('Failed to get Firebase token:', tokenError);
          throw new Error('Authentication failed. Please log in again.');
        }
      }

      if (!authToken) {
        throw new Error('Authentication required. Please log in to submit your application.');
      }

      // Check if we have any file uploads to handle
      const hasFileUploads = data.files && Object.keys(data.files).length > 0;
      const hasUploadedUrls = data.foodSafetyLicenseUrl || data.foodEstablishmentCertUrl;
      
      logger.info("📋 Submission method decision:", {
        hasFileUploads,
        hasUploadedUrls,
        willUseFormData: hasFileUploads,
        willUseJSON: !hasFileUploads
      });
      
      if (hasFileUploads) {
        // Use FormData for file uploads - backend will handle file upload to blob
        const formData = new FormData();
        
        // Add all form fields
        Object.entries(data).forEach(([key, value]) => {
          if (key !== 'files' && value !== undefined && value !== null) {
            formData.append(key, String(value));
          }
        });
        
        // Add files
        Object.entries(data.files!).forEach(([fieldName, file]) => {
          formData.append(fieldName, file);
        });
        
        // Extract intended location from URL if we are coming from a kitchen page
        const urlParams = new URLSearchParams(window.location.search);
        const redirectUrl = urlParams.get('redirect');
        if (redirectUrl) {
          const match = redirectUrl.match(/\/(?:kitchen|apply-kitchen|kitchen-preview)\/(.+)/);
          if (match && match[1]) {
            formData.append('intendedLocationId', match[1]);
          }
        }
        
        const headers: Record<string, string> = {
          "Authorization": `Bearer ${authToken}`
        };

        logger.info("📤 Submitting via FormData with files to Firebase endpoint");
        const response = await fetch("/api/firebase/applications", {
          method: "POST",
          headers,
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: response.statusText }));
          throw new Error(errorData.error || errorData.message || response.statusText);
        }

        return response.json();
      } else {
        // Use JSON submission - for pre-uploaded file URLs or no files
        const headers: Record<string, string> = { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`
        };

        logger.info("📤 Submitting via JSON with document URLs to Firebase endpoint:", {
          foodSafetyLicenseUrl: data.foodSafetyLicenseUrl || null,
          foodEstablishmentCertUrl: data.foodEstablishmentCertUrl || null
        });

        const urlParams = new URLSearchParams(window.location.search);
        const redirectUrl = urlParams.get('redirect');
        let intendedLocationId;
        if (redirectUrl) {
          const match = redirectUrl.match(/\/(?:kitchen|apply-kitchen|kitchen-preview)\/(.+)/);
          if (match && match[1]) {
            intendedLocationId = match[1];
          }
        }

        const response = await fetch("/api/firebase/applications", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...data, intendedLocationId }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: response.statusText }));
          throw new Error(errorData.error || errorData.message || response.statusText);
        }

        return response.json();
      }
    },
    onSuccess: () => {
      navigate("/success");
    },
    onError: (error: any) => {
      logger.error("Application submission error:", error);
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
          logger.error("Error parsing error response:", e);
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
      // Determine submission method based on what we have
      const hasFiles = Object.keys(fileUploads).length > 0;
      const hasUrls = documentUrls.foodSafetyLicenseUrl.trim() || documentUrls.foodEstablishmentCertUrl.trim();
      
      logger.info("🎯 Form submission strategy:", {
        hasFiles,
        hasUrls,
        fileCount: Object.keys(fileUploads).length,
        urls: documentUrls
      });

      if (hasFiles) {
        // Use direct file upload via FormData - backend will handle blob upload
        const completeFormData = {
          ...formData,
          ...data,
          userId: user.uid,
          files: fileUploads // Include files for FormData submission
        } as ApplicationFormData & { files: Record<string, File> };

        logger.info("📁 Submitting with files directly to backend");
        mutate(completeFormData);
        
      } else if (hasUrls) {
        // Extract intended location from URL if we are coming from a kitchen page
        const urlParams = new URLSearchParams(window.location.search);
        const redirectUrl = urlParams.get('redirect');
        let intendedLocationId;
        if (redirectUrl) {
          const match = redirectUrl.match(/\/(?:kitchen|apply-kitchen|kitchen-preview)\/(.+)/);
          if (match && match[1]) {
            intendedLocationId = match[1];
          }
        }

        // Use pre-uploaded URLs via JSON submission
        const completeFormData = {
          ...formData,
          ...data,
          ...documentUrls, // Add the URL inputs
          userId: user.uid,
          intendedLocationId
        } as ApplicationFormData;

        logger.info("🔗 Submitting with pre-uploaded URLs");
        mutate(completeFormData);
        
      } else {
        // No documents - just submit the application
        const completeFormData = {
          ...formData,
          ...data,
          userId: user.uid,
        } as ApplicationFormData;

        logger.info("📝 Submitting without documents");
        mutate(completeFormData);
      }
      
    } catch (error) {
      toast({
        title: "Submission failed",
        description: error instanceof Error ? error.message : "Failed to submit application",
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
        
        // Validate file size (4.5MB limit - Vercel serverless function limit)
        if (file.size > 4.5 * 1024 * 1024) {
          toast({
            title: "File too large",
            description: "Please upload files smaller than 4.5MB.",
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
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8" data-testid="seller-application-step-3">
        {/* Food Safety License */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <h3 className="text-base font-medium">{t("sellerApp_foodSafetyTitle")}</h3>
                <InfoHint title={t("sellerApp_aboutFoodSafety")}>
                  <p>{t("sellerApp_foodSafetyInfo")}</p>
                  <p>{t("sellerApp_certFslHelp")}</p>
                </InfoHint>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{t("sellerApp_foodSafetyDesc")}</p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href="https://skillspassnl.com" target="_blank" rel="noopener noreferrer">
                {t("sellerApp_learnMore")}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>

          <p className="text-sm font-medium">{t("sellerApp_foodSafetyQuestion")}</p>
          <RadioGroup
            value={form.watch("foodSafetyLicense")}
            onValueChange={(value) => form.setValue("foodSafetyLicense", value as "yes" | "no")}
            className="gap-3"
          >
            <label
              className="flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5"
              data-testid="seller-food-safety-yes"
            >
              <RadioGroupItem value="yes" />
              <span className="text-sm font-medium">{t("sellerApp_yes")}</span>
            </label>
            {form.watch("foodSafetyLicense") === "yes" && (
              <div className="ml-7 space-y-3 rounded-xl border px-3 py-3">
                <Tabs defaultValue="upload" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="upload" className="gap-2 text-xs">
                      <Upload className="h-3 w-3" />
                      {t("sellerApp_uploadFile")}
                    </TabsTrigger>
                    <TabsTrigger value="url" className="gap-2 text-xs">
                      <LinkIcon className="h-3 w-3" />
                      {t("sellerApp_provideUrl")}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="upload" className="mt-3">
                    <FileUpload
                      fieldName="foodSafetyLicense"
                      label={t("sellerApp_uploadFoodSafety")}
                      required
                      currentFile={fileUploads.foodSafetyLicense}
                      onFileChange={(file) => handleFileUpload("foodSafetyLicense", file)}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("sellerApp_uploadFromDevice")} {t("sellerApp_uploadFoodSafetyTip")}
                    </p>
                  </TabsContent>
                  <TabsContent value="url" className="mt-3 space-y-2">
                    <Label htmlFor="foodSafetyLicenseUrl">{t("sellerApp_foodSafetyUrl")}</Label>
                    <Input
                      id="foodSafetyLicenseUrl"
                      type="url"
                      placeholder="https://drive.google.com/file/your-document..."
                      value={documentUrls.foodSafetyLicenseUrl}
                      onChange={(e) =>
                        setDocumentUrls((prev) => ({
                          ...prev,
                          foodSafetyLicenseUrl: e.target.value,
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("sellerApp_cloudStorage")} {t("sellerApp_cloudStorageTip")}
                    </p>
                  </TabsContent>
                </Tabs>
              </div>
            )}
            <label
              className="flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5"
              data-testid="seller-food-safety-no"
            >
              <RadioGroupItem value="no" />
              <span className="text-sm font-medium">{t("sellerApp_no")}</span>
            </label>
          </RadioGroup>
          {form.formState.errors.foodSafetyLicense && (
            <p className="text-sm text-destructive">{form.formState.errors.foodSafetyLicense.message}</p>
          )}
        </section>

        {/* Food Establishment Certificate */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <h3 className="text-base font-medium">{t("sellerApp_foodEstTitle")}</h3>
                <InfoHint title={t("sellerApp_aboutFoodEst")}>
                  <p>{t("sellerApp_foodEstInfo")}</p>
                  <p>{t("sellerApp_certFecHelp")}</p>
                </InfoHint>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{t("sellerApp_foodEstDesc")}</p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a
                href="https://www.gov.nl.ca/dgsnl/licences/env-health/food/"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("sellerApp_provincialGuidelines")}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>

          <p className="text-sm font-medium">{t("sellerApp_foodEstQuestion")}</p>
          <RadioGroup
            value={form.watch("foodEstablishmentCert")}
            onValueChange={(value) => form.setValue("foodEstablishmentCert", value as "yes" | "no")}
            className="gap-3"
          >
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5">
              <RadioGroupItem value="yes" />
              <span className="text-sm font-medium">{t("sellerApp_yes")}</span>
            </label>
            {form.watch("foodEstablishmentCert") === "yes" && (
              <div className="ml-7 space-y-3 rounded-xl border px-3 py-3">
                <Tabs defaultValue="upload" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="upload" className="gap-2 text-xs">
                      <Upload className="h-3 w-3" />
                      {t("sellerApp_uploadFile")}
                    </TabsTrigger>
                    <TabsTrigger value="url" className="gap-2 text-xs">
                      <LinkIcon className="h-3 w-3" />
                      {t("sellerApp_provideUrl")}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="upload" className="mt-3">
                    <FileUpload
                      fieldName="foodEstablishmentCert"
                      label={t("sellerApp_uploadFoodEst")}
                      required={false}
                      currentFile={fileUploads.foodEstablishmentCert}
                      onFileChange={(file) => handleFileUpload("foodEstablishmentCert", file)}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("sellerApp_optionalRecommended")} {t("sellerApp_uploadFoodEstTip")}
                    </p>
                  </TabsContent>
                  <TabsContent value="url" className="mt-3 space-y-2">
                    <Label htmlFor="foodEstablishmentCertUrl">{t("sellerApp_foodEstUrl")}</Label>
                    <Input
                      id="foodEstablishmentCertUrl"
                      type="url"
                      placeholder="https://drive.google.com/file/your-certificate..."
                      value={documentUrls.foodEstablishmentCertUrl}
                      onChange={(e) =>
                        setDocumentUrls((prev) => ({
                          ...prev,
                          foodEstablishmentCertUrl: e.target.value,
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("sellerApp_optional")} {t("sellerApp_foodEstUrlTip")}
                    </p>
                  </TabsContent>
                </Tabs>
              </div>
            )}
            <label
              className="flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5"
              data-testid="seller-establishment-cert-no"
            >
              <RadioGroupItem value="no" />
              <span className="text-sm font-medium">{t("sellerApp_no")}</span>
            </label>
          </RadioGroup>
          {form.formState.errors.foodEstablishmentCert && (
            <p className="text-sm text-destructive">{form.formState.errors.foodEstablishmentCert.message}</p>
          )}
        </section>

        {/* Notes */}
        <section className="space-y-3">
          <div>
            <h3 className="text-base font-medium">{t("sellerApp_feedbackTitle")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("sellerApp_feedbackDesc")}</p>
          </div>
          <FormField
            control={form.control}
            name="feedback"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Textarea
                    placeholder={t("sellerApp_certNotesPlaceholder")}
                    className="h-28 resize-none"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <ApplicationStepFooter
          showPrevious
          continueDisabled={isPending || isUploading}
          continueTestId="seller-application-submit"
          showContinueArrow={!isPending && !isUploading}
          continueLabel={
            isUploading ? (
              <>
                {t("sellerApp_uploadingFiles")}
                {uploadProgress > 0 ? ` ${Math.round(uploadProgress)}%` : ""}
              </>
            ) : isPending ? (
              t("sellerApp_certSubmitting")
            ) : (
              t("sellerApp_submitApp")
            )
          }
        />
      </form>
    </Form>
  );
}
