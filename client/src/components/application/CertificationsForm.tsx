import { logger } from "@/lib/logger";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useFileUpload } from "@/hooks/useFileUpload";
import { ApplicationFormData } from "@/lib/applicationSchema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, CheckCircle2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useLocation } from "wouter";
import { z } from "zod";
import { useApplicationForm } from "./ApplicationFormContext";
import { useTranslation } from "react-i18next";
import { auth } from "@/lib/firebase";
import { InfoHint } from "@/components/chef/ui";
import { ApplicationStepFooter } from "./ApplicationStepFooter";

import { FileUpload } from "@/components/ui/file-upload";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Create a schema for just the certifications fields
const certificationsSchema = z.object({
  foodSafetyLicense: z.enum(["yes", "no"]),
  foodEstablishmentCert: z.enum(["yes", "no"]),
  feedback: z.string().optional(),
});

type CertificationsFormData = z.infer<typeof certificationsSchema>;

export default function CertificationsForm() {
  const { t } = useTranslation("chef");
  const { formData, updateFormData, setIsBusy } = useApplicationForm();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useFirebaseAuth();
  const queryClient = useQueryClient();
  const [fileUploads, setFileUploads] = useState<Record<string, File>>({});
  const [uploadDialog, setUploadDialog] = useState<"foodSafetyLicense" | "foodEstablishmentCert" | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const uploadingRef = useRef(false);
  
  // URL states for document links
  const [documentUrls, setDocumentUrls] = useState({
    foodSafetyLicenseUrl: formData.foodSafetyLicenseUrl || "",
    foodEstablishmentCertUrl: formData.foodEstablishmentCertUrl || ""
  });

  // Initialize file upload hook
  const { uploadFile, uploadProgress, error: uploadError } = useFileUpload({
    maxSize: 4.5 * 1024 * 1024,
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

  const { mutate, isPending, isSuccess } = useMutation({
    mutationFn: async (data: ApplicationFormData) => {
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

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`
      };
      const urlParams = new URLSearchParams(window.location.search);
      const redirectUrl = urlParams.get('redirect');
      let intendedLocationId;
      if (redirectUrl) {
        const match = redirectUrl.match(/\/(?:kitchen|apply-kitchen|kitchen-preview)\/(.+)/);
        if (match && match[1]) intendedLocationId = match[1];
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
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/firebase/applications/my"] });
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

  const busy = isUploading || isPending || isSuccess;
  useEffect(() => {
    setIsBusy(busy);
    return () => setIsBusy(false);
  }, [busy, setIsBusy]);

  const onSubmit = async (data: CertificationsFormData) => {
    if (busy || uploadingRef.current) return;
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
    if (data.foodSafetyLicense === "yes" && !documentUrls.foodSafetyLicenseUrl.trim()) {
      toast({
        title: "Food Safety License Required",
        description: "Please upload your Food Safety License document or provide a URL since you indicated you have one.",
        variant: "destructive",
      });
      return;
    }

    // Submit only completed document URLs, never a second copy of the files.
    mutate({
      ...formData,
      ...data,
      foodSafetyLicenseUrl: data.foodSafetyLicense === "yes" ? documentUrls.foodSafetyLicenseUrl.trim() : "",
      foodEstablishmentCertUrl: data.foodEstablishmentCert === "yes" ? documentUrls.foodEstablishmentCertUrl.trim() : "",
      userId: user.uid,
    } as ApplicationFormData);
  };

  // File upload handlers
  const handleFileUpload = async (fieldName: "foodSafetyLicense" | "foodEstablishmentCert", file: File | null) => {
    if (uploadingRef.current) return;
    const urlField = `${fieldName}Url` as const;
    if (!file) {
      setFileUploads(prev => { const next = { ...prev }; delete next[fieldName]; return next; });
      setDocumentUrls(prev => ({ ...prev, [urlField]: "" }));
      updateFormData({ [urlField]: "" });
      return;
    }
    uploadingRef.current = true;
    setIsUploading(true);
    try {
      const result = await uploadFile(file);
      if (result?.success && result.url) {
        setFileUploads(prev => ({ ...prev, [fieldName]: file }));
        setDocumentUrls(prev => ({ ...prev, [urlField]: result.url }));
        updateFormData({ [fieldName]: "yes", [urlField]: result.url });
      }
    } finally {
      uploadingRef.current = false;
      setIsUploading(false);
    }
  };

  const closeUploadDialog = (fieldName: "foodSafetyLicense" | "foodEstablishmentCert") => {
    if (uploadingRef.current) return;
    const urlField = `${fieldName}Url` as const;
    const url = documentUrls[urlField].trim();
    const value = url ? "yes" : "no";
    form.setValue(fieldName, value, { shouldValidate: true, shouldDirty: true });
    updateFormData({ [fieldName]: value, [urlField]: url });
    setUploadDialog(null);
  };

  return (
    <Form {...form}>
      {(isPending || isSuccess) && (
        <div role="status" className="mb-4 flex items-center justify-center gap-3 rounded-xl border bg-muted/50 p-4">
          <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
          <p className="font-medium text-foreground">{t("sellerApp_certSubmitting")}</p>
        </div>
      )}
      <form onSubmit={form.handleSubmit(onSubmit)} aria-busy={busy} data-testid="seller-application-step-3">
        <fieldset disabled={busy} className="grid min-w-0 gap-4 lg:grid-cols-2">
        {/* Food Safety License */}
        <section className="grid grid-rows-[auto_auto_1fr] rounded-xl border p-4">
          <div className="grid gap-2 border-b pb-3">
            <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <h3 className="text-base font-medium">{t("sellerApp_foodSafetyTitle")}</h3>
                <InfoHint title={t("sellerApp_aboutFoodSafety")}>
                  <p>{t("sellerApp_certFslHelp")}</p>
                  <div className="mt-1 pt-2 border-t">
                    <a href="https://skillspassnl.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium inline-flex items-center gap-1 text-sm rounded-md">Visit SkillsPass NL <ExternalLink className="h-3 w-3" /></a>
                  </div>
                </InfoHint>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{t("sellerApp_foodSafetyDesc")}</p>
            </div>
            </div>
            </div>

          <p className="pb-2 pt-3 text-sm font-medium">{t("sellerApp_foodSafetyQuestion")}</p>
          <RadioGroup
            value={form.watch("foodSafetyLicense") || ""}
            disabled={busy}
            aria-label={t("sellerApp_foodSafetyQuestion")}
            onValueChange={(value) => { form.setValue("foodSafetyLicense", value as "yes" | "no"); updateFormData({ foodSafetyLicense: value as "yes" | "no" }); if (value === "yes") setUploadDialog("foodSafetyLicense"); }}
            className="mt-auto gap-2"
          >
            <label
              className="flex h-11 w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5"
              onClick={() => !busy && form.watch("foodSafetyLicense") === "yes" && setUploadDialog("foodSafetyLicense")}
              data-testid="seller-food-safety-yes"
            >
              <RadioGroupItem value="yes" />
              <span className="text-sm font-medium">{t("sellerApp_yes")}</span>
              {documentUrls.foodSafetyLicenseUrl && (
                <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-500">
                  <CheckCircle2 className="size-4" />
                  Uploaded
                </span>
              )}
            </label>
            <Dialog open={uploadDialog === "foodSafetyLicense"} onOpenChange={(open) => {
              if (!open) {
                closeUploadDialog("foodSafetyLicense");
              }
            }}>
                <DialogContent showCloseButton={false} className="max-w-lg rounded-2xl sm:rounded-2xl" onEscapeKeyDown={event => { if (isUploading) event.preventDefault(); }} onPointerDownOutside={event => { if (isUploading) event.preventDefault(); }}>
                  <DialogHeader><DialogTitle>{t("sellerApp_uploadFoodSafety")}</DialogTitle><DialogDescription>{t("sellerApp_uploadFromDevice")} {t("sellerApp_uploadFoodSafetyTip")}</DialogDescription></DialogHeader>
                <fieldset disabled={isUploading} className="min-w-0">
                <div className="mt-3">
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
                    {isUploading && uploadDialog === "foodSafetyLicense" && (
                      <div className="mt-3" role="status">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" aria-hidden />{t("sellerApp_uploadingFiles")}</span>
                          <span>{Math.round(uploadProgress)}%</span>
                        </div>
                        <div role="progressbar" aria-label={t("sellerApp_uploadingFiles")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(uploadProgress)} className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                        </div>
                      </div>
                    )}
                </div>
                </fieldset>
                {uploadError && <p role="alert" className="text-sm text-destructive">{uploadError}</p>}
                
                <DialogFooter className="mt-2 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 gap-2 sm:gap-0">
                  <Button variant="outline" type="button" onClick={() => {
                      handleFileUpload("foodSafetyLicense", null);
                      setDocumentUrls(prev => ({ ...prev, foodSafetyLicenseUrl: "" }));
                      form.setValue("foodSafetyLicense", "no", { shouldValidate: true, shouldDirty: true });
                      updateFormData({ foodSafetyLicense: "no", foodSafetyLicenseUrl: "" });
                      setUploadDialog(null);
                  }} className="rounded-xl">
                    Remove
                  </Button>
                  <Button type="button" onClick={() => closeUploadDialog("foodSafetyLicense")} className="rounded-xl">
                    Done
                  </Button>
                </DialogFooter>
                </DialogContent>
              </Dialog>
            <label
              className="flex h-11 w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5"
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
        <section className="grid grid-rows-[auto_auto_1fr] rounded-xl border p-4">
          <div className="grid gap-2 border-b pb-3">
            <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <h3 className="text-base font-medium">{t("sellerApp_foodEstTitle")}</h3>
                <InfoHint title={t("sellerApp_aboutFoodEst")}>
                  <p>{t("sellerApp_certFecHelp")}</p>
                  <div className="mt-1 pt-2 border-t">
                    <a href="https://www.gov.nl.ca/dgsnl/licences/env-health/food/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium inline-flex items-center gap-1 text-sm rounded-md">Visit Gov.nl.ca Food Safety <ExternalLink className="h-3 w-3" /></a>
                  </div>
                </InfoHint>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{t("sellerApp_foodEstDesc")}</p>
            </div>
            </div>
            </div>

          <p className="pb-2 pt-3 text-sm font-medium">{t("sellerApp_foodEstQuestion")}</p>
          <RadioGroup
            value={form.watch("foodEstablishmentCert") || ""}
            disabled={busy}
            aria-label={t("sellerApp_foodEstQuestion")}
            onValueChange={(value) => { form.setValue("foodEstablishmentCert", value as "yes" | "no"); updateFormData({ foodEstablishmentCert: value as "yes" | "no" }); if (value === "yes") setUploadDialog("foodEstablishmentCert"); }}
            className="mt-auto gap-2"
          >
            <label className="flex h-11 w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5" onClick={() => !busy && form.watch("foodEstablishmentCert") === "yes" && setUploadDialog("foodEstablishmentCert")}>
              <RadioGroupItem value="yes" />
              <span className="text-sm font-medium">{t("sellerApp_yes")}</span>
              {documentUrls.foodEstablishmentCertUrl && (
                <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-500">
                  <CheckCircle2 className="size-4" />
                  Uploaded
                </span>
              )}
            </label>
            <Dialog open={uploadDialog === "foodEstablishmentCert"} onOpenChange={(open) => {
              if (!open) {
                closeUploadDialog("foodEstablishmentCert");
              }
            }}>
                <DialogContent showCloseButton={false} className="max-w-lg rounded-2xl sm:rounded-2xl" onEscapeKeyDown={event => { if (isUploading) event.preventDefault(); }} onPointerDownOutside={event => { if (isUploading) event.preventDefault(); }}>
                  <DialogHeader><DialogTitle>{t("sellerApp_uploadFoodEst")}</DialogTitle><DialogDescription>{t("sellerApp_optionalRecommended")} {t("sellerApp_uploadFoodEstTip")}</DialogDescription></DialogHeader>
                <fieldset disabled={isUploading} className="min-w-0">
                <div className="mt-3">
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
                    {isUploading && uploadDialog === "foodEstablishmentCert" && (
                      <div className="mt-3" role="status">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" aria-hidden />{t("sellerApp_uploadingFiles")}</span>
                          <span>{Math.round(uploadProgress)}%</span>
                        </div>
                        <div role="progressbar" aria-label={t("sellerApp_uploadingFiles")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(uploadProgress)} className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                        </div>
                      </div>
                    )}
                </div>
                </fieldset>
                {uploadError && <p role="alert" className="text-sm text-destructive">{uploadError}</p>}
                
                <DialogFooter className="mt-2 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 gap-2 sm:gap-0">
                  <Button variant="outline" type="button" onClick={() => {
                      handleFileUpload("foodEstablishmentCert", null);
                      setDocumentUrls(prev => ({ ...prev, foodEstablishmentCertUrl: "" }));
                      form.setValue("foodEstablishmentCert", "no", { shouldValidate: true, shouldDirty: true });
                      updateFormData({ foodEstablishmentCert: "no", foodEstablishmentCertUrl: "" });
                      setUploadDialog(null);
                  }} className="rounded-xl">
                    Remove
                  </Button>
                  <Button type="button" onClick={() => closeUploadDialog("foodEstablishmentCert")} className="rounded-xl">
                    Done
                  </Button>
                </DialogFooter>
                </DialogContent>
              </Dialog>
            <label
              className="flex h-11 w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5"
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
        <section className="space-y-2 lg:col-span-2">
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
                    className="h-16 resize-none"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <div className="lg:col-span-2"><ApplicationStepFooter
          showPrevious
          continueDisabled={busy}
          continueTestId="seller-application-submit"
          showContinueArrow={!busy}
          continueLabel={
            isUploading ? (
              <>
                {t("sellerApp_uploadingFiles")}
                {uploadProgress > 0 ? ` ${Math.round(uploadProgress)}%` : ""}
              </>
            ) : isPending || isSuccess ? (
              t("sellerApp_certSubmitting")
            ) : (
              t("sellerApp_submitApp")
            )
          }
        /></div>
        </fieldset>
      </form>
    </Form>
  );
}
