/**
 * Facility Docs Settings Component
 * Standalone page for managing facility documents (floor plans, ventilation specs)
 * Uses the same data as the Application Requirements wizard's Facility Info step
 */

import { useState, useEffect, useCallback } from "react";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Upload, FileText, X, Loader2, FolderOpen, Wind, Info, CheckCircle2 } from "@/components/ui/manager-icons";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { usePresignedDocumentUrl } from "@/hooks/use-presigned-document-url";
import { SettingsFileUpload } from "./SettingsFileUpload";
import { ChefPageHeader } from "@/components/chef/ui";

interface Location {
  id: number;
  name: string;
  kitchenTermsUrl?: string;
}

interface LocationRequirements {
  id?: number;
  floor_plans_url?: string;
  ventilation_specs?: string;
  ventilation_specs_url?: string;
}

interface FacilityDocsSettingsProps {
  location: Location;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const currentFirebaseUser = auth.currentUser;
  if (!currentFirebaseUser) {
    throw new Error(tt('firebaseUserNotAvailable'));
  }
  const token = await currentFirebaseUser.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

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

export default function FacilityDocsSettings({ location }: FacilityDocsSettingsProps) {
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [floorPlansFile, setFloorPlansFile] = useState<File | null>(null);
  const [ventilationFile, setVentilationFile] = useState<File | null>(null);
  const [ventilationSpecs, setVentilationSpecs] = useState('');
  const [termsFile, setTermsFile] = useState<File | null>(null);
  const [isUploadingTerms, setIsUploadingTerms] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const { uploadFile, isUploading, uploadProgress } = useFileUpload({
    maxSize: 4.5 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    onSuccess: (response) => {
      toast({ title: mt("fileUploadedSuccessfully"),
        description: `${response.fileName} has been uploaded.`,
      });
    },
    onError: (error) => {
      toast({ title: mt("uploadFailed2"),
        description: error,
        variant: 'destructive',
      });
    },
  });

  // Fetch current requirements (same endpoint as Application Requirements wizard)
  const { data: requirements, isLoading } = useQuery<LocationRequirements>({
    queryKey: [`/api/manager/locations/${location.id}/requirements`],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations/${location.id}/requirements`, {
        credentials: 'include',
        headers,
      });
      if (!response.ok) throw new Error(tt('failedToFetchRequirements'));
      return response.json();
    },
    enabled: !!location.id,
  });

  // Initialize state from fetched data
  useEffect(() => {
    if (requirements) {
      setVentilationSpecs(requirements.ventilation_specs || '');
      setHasUnsavedChanges(false);
    }
  }, [requirements]);

  // Save mutation (same endpoint as Application Requirements wizard)
  const saveMutation = useMutation({
    mutationFn: async (updates: Partial<LocationRequirements>) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations/${location.id}/requirements`, {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || error.error || 'Failed to save');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/manager/locations/${location.id}/requirements`] });
      setHasUnsavedChanges(false);
      toast({ title: mt("saved"),
        description: mt("facilityDocumentsUpdatedSuccessfully"),
      });
    },
    onError: (error: Error) => {
      toast({ title: mt("saveFailed"),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleFloorPlansUpload = async () => {
    if (!floorPlansFile) return;
    try {
      const result = await uploadFile(floorPlansFile);
      if (result) {
        saveMutation.mutate({ floor_plans_url: result.url });
        setFloorPlansFile(null);
      }
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleVentilationUpload = async () => {
    if (!ventilationFile) return;
    try {
      const result = await uploadFile(ventilationFile);
      if (result) {
        saveMutation.mutate({ ventilation_specs_url: result.url });
        setVentilationFile(null);
      }
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleRemoveFloorPlans = () => {
    saveMutation.mutate({ floor_plans_url: '' });
  };

  const handleRemoveVentilationDoc = () => {
    saveMutation.mutate({ ventilation_specs_url: '' });
  };

  const handleTermsUpload = async () => {
    if (!termsFile) return;
    setIsUploadingTerms(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error(tt("firebaseUserNotAvailable"));
      const token = await currentUser.getIdToken();
      const formData = new FormData();
      formData.append("file", termsFile);
      const uploadResponse = await fetch("/api/files/upload-file", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
        body: formData,
      });
      if (!uploadResponse.ok) throw new Error((await uploadResponse.json().catch(() => ({}))).error || tt("failedToUploadTermsDoc"));
      const uploaded = await uploadResponse.json();
      const updateResponse = await fetch(`/api/manager/locations/${location.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ kitchenTermsUrl: uploaded.url }),
      });
      if (!updateResponse.ok) throw new Error((await updateResponse.json().catch(() => ({}))).error || tt("failedToUploadTermsDoc"));
      setTermsFile(null);
      queryClient.invalidateQueries({ queryKey: ["locationDetails", location.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
      toast({ title: mt("termsUploaded"), description: mt("yourTermsAndConditionsHaveBeenUploadedSuccessfully") });
    } catch (error) {
      toast({ title: mt("uploadFailed"), description: error instanceof Error ? error.message : tt("failedToUploadTermsDoc"), variant: "destructive" });
    } finally {
      setIsUploadingTerms(false);
    }
  };

  const saveVentilationAction = useStatusButton(
    useCallback(async () => {
      await saveMutation.mutateAsync({ ventilation_specs: ventilationSpecs });
    }, [saveMutation, ventilationSpecs]),
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{mt("loadingFacilityDocuments")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ChefPageHeader title={mt("facilityDocuments")} description={`Manage floor plans and ventilation specifications for ${location.name}. These documents are automatically shared with approved chefs.`} />
      <div className="space-y-4">
      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-lg">{mt("termsConditions")}</CardTitle>
          <CardDescription>{mt("uploadTermsThatChefsMustAgreeToWhenBooking")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          {location.kitchenTermsUrl && (
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
              <span className="text-sm">{mt("currentTermsDocumentUploaded")}</span>
              <AuthenticatedDocumentLink url={location.kitchenTermsUrl} className="text-sm text-primary hover:underline">{mt("viewDocument")}</AuthenticatedDocumentLink>
            </div>
          )}
          <SettingsFileUpload id="terms-upload" accept=".pdf" file={termsFile} label="Choose terms and conditions" hint={mt("pDFOnlyMax5MB")} disabled={isUploadingTerms} onChange={setTermsFile} />
          {termsFile && (
            <div className="flex justify-end">
              <Button onClick={handleTermsUpload} disabled={isUploadingTerms}>
                {isUploadingTerms ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                {isUploadingTerms ? mt("uploading") : mt("uploadTerms")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      {/* Floor Plans */}
      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-lg">{mt("floorPlans")}</CardTitle>
          <CardDescription>{mt("uploadYourKitchenLayoutToHelpChefsNavigateTheSpace")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          {/* Current Floor Plans */}
          {requirements?.floor_plans_url && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-emerald-800">{mt("floorPlansUploaded")}</p>
                <AuthenticatedDocumentLink
                  url={requirements.floor_plans_url}
                  className="text-xs text-emerald-600 hover:underline truncate block"
                >{mt("viewDocument")}</AuthenticatedDocumentLink>
              </div>
              <Button
                onClick={handleRemoveFloorPlans}
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                disabled={saveMutation.isPending}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Upload Floor Plans */}
          <div className="space-y-3">
            <SettingsFileUpload id="floor_plans_file" accept=".pdf,.jpg,.jpeg,.png,.webp" file={floorPlansFile} label="Choose floor plans" hint={mt("pDFJPGPNGOrWebPMax45MB")} disabled={isUploading} onChange={setFloorPlansFile} />

            {floorPlansFile && (
              <Button
                onClick={handleFloorPlansUpload}
                disabled={isUploading}
                className="w-full"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading... {uploadProgress}%
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />{mt("uploadFloorPlans")}</>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Ventilation Specifications */}
      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-lg">{mt("ventilationSpecifications")}</CardTitle>
          <CardDescription>{mt("documentYourVentilationSystemForComplianceAndChefAwareness")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="ventilation_specs">{mt("ventilationDescription")}</Label>
            <Textarea
              id="ventilation_specs"
              value={ventilationSpecs}
              onChange={(e) => {
                setVentilationSpecs(e.target.value);
                setHasUnsavedChanges(true);
              }}
              placeholder={mt("placeholderVentilationSystem")}
              rows={3}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">{mt("includeDetailsAboutCFMCapacityHoodTypeAndExhaustLocations")}</p>
          </div>

          {hasUnsavedChanges && (
            <div className="flex justify-end pt-2">
              <StatusButton
                status={saveVentilationAction.status}
                onClick={saveVentilationAction.execute}
                labels={{ idle: tt("saveDescription"), loading: mt("savingShort"), success: mt("saved") }}
              />
            </div>
          )}

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-3 text-slate-400">{mt("andOrUploadDocument")}</span>
            </div>
          </div>

          {/* Current Ventilation Document */}
          {requirements?.ventilation_specs_url && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-emerald-800">{mt("ventilationDocumentUploaded")}</p>
                <AuthenticatedDocumentLink
                  url={requirements.ventilation_specs_url}
                  className="text-xs text-emerald-600 hover:underline truncate block"
                >{mt("viewDocument")}</AuthenticatedDocumentLink>
              </div>
              <Button
                onClick={handleRemoveVentilationDoc}
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                disabled={saveMutation.isPending}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Upload Ventilation Document */}
          <div className="space-y-3">
            <Label>{mt("uploadDocumentationOptional")}</Label>
            <SettingsFileUpload id="ventilation_file" accept=".pdf,.jpg,.jpeg,.png,.webp" file={ventilationFile} label="Choose ventilation document" hint={mt("pDFJPGPNGOrWebPMax45MB")} disabled={isUploading} onChange={setVentilationFile} />

            {ventilationFile && (
              <Button
                onClick={handleVentilationUpload}
                disabled={isUploading}
                className="w-full"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading... {uploadProgress}%
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />{mt("uploadDocument")}</>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
