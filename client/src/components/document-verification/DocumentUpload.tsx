import { logger } from "@/lib/logger";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { InfoChip } from "@/components/chef/info-chip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentVerification } from "@/hooks/use-document-verification";
import { usePresignedDocumentUrl } from "@/hooks/use-presigned-document-url";
import { useToast } from "@/hooks/use-toast";
import { useFileUpload } from "@/hooks/useFileUpload";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Award,
  CheckCircle,
  ChefHat,
  Clock,
  FileText,
  FolderOpen,
  Loader2,
  Plus,
  Upload,
  XCircle
} from "lucide-react";
import React, { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { QuietNotice, InfoHint } from "@/components/chef/ui";

// Helper component for authenticated document links
const AuthenticatedDocumentLink = React.forwardRef<
  HTMLAnchorElement,
  { url: string | null | undefined; className?: string; children: React.ReactNode }
>(function AuthenticatedDocumentLink({ url, className, children }, ref) {
  const { url: presignedUrl } = usePresignedDocumentUrl(url);

  if (!url) return null;

  return (
    <a
      ref={ref}
      href={presignedUrl || url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
});
AuthenticatedDocumentLink.displayName = "AuthenticatedDocumentLink";


// Add types for props
interface DocumentManagementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DocumentUploadProps {
  openInModal?: boolean;
  forceShowForm?: boolean;
  /** Hide duplicate headings/alerts when nested under DocumentVerificationView */
  embedded?: boolean;
}

interface DocumentUploadModalProps {
  documentType: 'foodSafety' | 'establishment';
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { url?: string; file?: File }) => Promise<void>;
  currentDocumentUrl?: string;
  isRequired: boolean;
}

// Individual Document Upload Modal Component
function DocumentUploadModal({
  documentType,
  isOpen,
  onClose,
  onSubmit,
  currentDocumentUrl,
  isRequired
}: DocumentUploadModalProps) {
  const [url, setUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [discardOpen, setDiscardOpen] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation("chef");

  const resetAndClose = () => {
    setUrl("");
    setSelectedFile(null);
    setErrors({});
    setDiscardOpen(false);
    onClose();
  };

  const requestClose = () => {
    // Match booking selection modals: confirm before abandoning the picker
    setDiscardOpen(true);
  };

  const validateUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setSelectedFile(file);
    if (file) setUrl(""); // Clear URL if file is selected
  };

  const handleSubmit = async () => {
    setErrors({});

    if (!selectedFile && !url.trim()) {
      setErrors({ general: t("duSelectFileOrUrl") });
      return;
    }

    if (url.trim() && !validateUrl(url.trim())) {
      setErrors({ url: t("duInvalidUrl") });
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        url: url.trim() || undefined,
        file: selectedFile || undefined
      });

      resetAndClose();

      toast({
        title: t("duUpdatedToastTitle"),
        description: t("duUpdatedToastDesc", {
          docType: documentType === 'foodSafety' ? t("duFoodSafetyTitle") : t("duEstablishmentTitle"),
        }),
      });
    } catch (error) {
      setErrors({ general: t("duUpdateFailed") });
    } finally {
      setIsSubmitting(false);
    }
  };

  const documentTitle = documentType === 'foodSafety'
    ? t('duFoodSafetyTitle')
    : t('duEstablishmentTitle');

  const documentDescription = documentType === 'foodSafety'
    ? t('duFoodSafetyDesc')
    : t('duEstablishmentDesc');

  return (
    <>
      <Dialog open={isOpen}>
        <DialogContent
          className="max-w-md"
          showCloseButton={false}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            requestClose();
          }}
          onPointerDownOutside={(e) => {
            e.preventDefault();
            requestClose();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {documentTitle}
            </DialogTitle>
            <DialogDescription>
              {documentDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {currentDocumentUrl && (
              <div className="rounded-xl border px-4 py-3">
                <p className="mb-2 text-sm font-medium">{t("duCurrentDocument")}</p>
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <AuthenticatedDocumentLink
                    url={currentDocumentUrl}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {t("duViewDocument")}
                  </AuthenticatedDocumentLink>
                </div>
              </div>
            )}

            <Tabs defaultValue="file" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="file">{t("duTabUploadFile")}</TabsTrigger>
                <TabsTrigger value="url">{t("duTabProvideUrl")}</TabsTrigger>
              </TabsList>

              <TabsContent value="file" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor={`file-${documentType}`}>{t("duSelectDocument")}</Label>
                  <div className="relative">
                    <input
                      id={`file-${documentType}`}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      onChange={handleFileSelect}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="flex items-center justify-between rounded-xl border bg-muted/40 p-3 transition-colors hover:bg-muted/60">
                      <div className="flex items-center gap-3">
                        <FolderOpen className="h-5 w-5 text-muted-foreground" />
                        <span className="text-sm text-foreground">
                          {selectedFile ? selectedFile.name : t("duChooseFile")}
                        </span>
                      </div>
                      {selectedFile && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFile(null);
                          }}
                          className="text-destructive hover:text-destructive hover:bg-muted"
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("duFileFormats")}
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="url" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor={`url-${documentType}`}>{t("duDocumentUrl")}</Label>
                  <Input
                    id={`url-${documentType}`}
                    type="url"
                    placeholder="https://example.com/document.pdf"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className={errors.url ? "border-destructive" : ""}
                  />
                  {errors.url && (
                    <p className="flex items-center gap-1 text-sm text-destructive">
                      <AlertTriangle className="h-3 w-3" />
                      {errors.url}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t("duUrlHint")}
                  </p>
                </div>
              </TabsContent>
            </Tabs>

            {errors.general && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {errors.general}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-3">
              <Button variant="outline" onClick={requestClose} className="flex-1">
                {t("duCancel")}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex-1"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("duUploading")}
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    {t("duUpdateBtn")}
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("apDiscardUploadTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("apDiscardUploadDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("apDiscardUploadKeep")}</AlertDialogCancel>
            <AlertDialogAction onClick={resetAndClose}>{t("apDiscardUploadConfirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function DocumentManagementModal({ open, onOpenChange }: DocumentManagementModalProps) {
  const { t } = useTranslation("chef");

  const requestClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-4xl w-full max-h-screen overflow-y-auto p-0 sm:p-6 rounded-lg sm:rounded-2xl"
        showCloseButton={false}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          requestClose();
        }}
        onPointerDownOutside={(e) => {
          e.preventDefault();
          requestClose();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("duManageTitle")}
            <InfoHint title={t("duGoodToKnow")}>
              <p className="font-medium text-foreground">{t("duStatusResetTitle")}</p>
              <p>{t("duStatusResetBody")}</p>
            </InfoHint>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 p-4 sm:p-0">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={requestClose}>
              {t("duCancel")}
            </Button>
          </div>
          <DocumentUpload forceShowForm embedded />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function DocumentUpload({
  openInModal = false,
  forceShowForm = false,
  embedded = false,
}: DocumentUploadProps) {
  const { verification, loading, createMutation, updateMutation, refetch, forceRefresh } = useDocumentVerification();
  const { toast } = useToast();
  const { t } = useTranslation("chef");

  // Modal states for individual document uploads
  const [foodSafetyModalOpen, setFoodSafetyModalOpen] = useState(false);
  const [establishmentModalOpen, setEstablishmentModalOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // Initialize file upload hook
  const { uploadFile, isUploading, uploadProgress, error: uploadError } = useFileUpload({
    maxSize: 4.5 * 1024 * 1024, // 4.5MB (Vercel limit)
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    onSuccess: (response) => {
      toast({
        title: t("duFileUploadedTitle"),
        description: t("duFileUploadedDesc", { name: response.fileName }),
      });
    },
    onError: (error) => {
      toast({
        title: t("duUploadFailedTitle"),
        description: error,
        variant: "destructive",
      });
    }
  });

  // Check if application is in a state that allows document uploads
  const isApplicationActive = () => {
    if (!verification) return false;
    return verification.status !== 'cancelled' && verification.status !== 'rejected';
  };

  // Handle individual document submission
  const handleDocumentSubmit = async (documentType: 'foodSafety' | 'establishment', data: { url?: string; file?: File }) => {
    if (!isApplicationActive()) {
      toast({
        title: t("duUploadNotAllowedTitle"),
        description: t("duUploadNotAllowedDesc"),
        variant: "destructive",
      });
      return;
    }

    try {
      const finalData: Record<string, string> = {};

      if (data.file) {
        logger.info(`Uploading file for ${documentType}:`, {
          fileName: data.file.name,
          fileSize: data.file.size,
          fileType: data.file.type
        });

        const result = await uploadFile(data.file);

        if (result) {
          if (documentType === 'foodSafety') {
            finalData.foodSafetyLicenseUrl = result.url;
          } else {
            finalData.foodEstablishmentCertUrl = result.url;
          }
        } else {
          throw new Error(`Failed to upload ${documentType} document`);
        }
      } else if (data.url) {
        if (documentType === 'foodSafety') {
          finalData.foodSafetyLicenseUrl = data.url;
        } else {
          finalData.foodEstablishmentCertUrl = data.url;
        }
      }

      logger.info('Submitting document data to API:', {
        verificationExists: !!verification,
        finalData,
        documentType
      });

      if (verification) {
        await updateMutation.mutateAsync(finalData);
      } else {
        await createMutation.mutateAsync(finalData);
      }

      // Force refresh the verification data
      await forceRefresh();

    } catch (error) {
      logger.error('Document submission error:', error);
      throw error;
    }
  };

  const getStatusBadge = (status: string): React.ReactNode => {
    const statusConfig = {
      pending: { variant: "warning" as const, icon: Clock, text: t("duStatusPendingReview") },
      approved: { variant: "success" as const, icon: CheckCircle, text: t("duStatusApproved") },
      rejected: { variant: "destructive" as const, icon: XCircle, text: t("duStatusRejected") }
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    const Icon = config.icon;

    return (
      <InfoChip variant={config.variant} icon={<Icon className="w-3 h-3" />}>
        {config.text}
      </InfoChip>
    );
  };

  const getFileDisplayName = (url: string | null): string | null => {
    if (!url) return null;
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      const fileName = path.split('/').pop();
      return fileName && fileName.includes('.') ? fileName : 'Document';
    } catch {
      return 'Document';
    }
  };

  const handleUpdateSuccess = () => {
    toast({
      title: t("duDocsUpdatedTitle"),
      description: t("duDocsUpdatedDesc"),
    });
    forceRefresh();
  };

  // Show loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Show message for cancelled/rejected applications
  if (verification && !isApplicationActive()) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center py-12 px-6"
      >
        <div className="w-16 h-16 mx-auto mb-6 bg-gray-100 rounded-full flex items-center justify-center">
          <XCircle className="h-8 w-8 text-gray-600" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-4">
          {verification.status === 'cancelled' ? t('duAppCancelledTitle') : t('duAppNotActiveTitle')}
        </h3>
        <p className="text-gray-600 mb-6 max-w-md mx-auto">
          {verification.status === 'cancelled'
            ? t('duAppCancelledBody')
            : t('duAppNotActiveBody')}
        </p>
        <div className="space-y-3">
          <Button asChild className="rounded-xl">
            <Link href="/dashboard?view=applications&action=new">
              <ChefHat className="mr-2 h-4 w-4" />
              {t("duSubmitNewApplication")}
            </Link>
          </Button>
          <div>
            <Button variant="outline" asChild className="rounded-xl">
              <Link href="/dashboard">
                <FileText className="mr-2 h-4 w-4" />
                {t("duBackToDashboard")}
              </Link>
            </Button>
          </div>
        </div>
      </motion.div>
    );
  }

  // For fully verified users, show status and allow document management
  if (verification && verification.foodSafetyLicenseStatus === "approved" &&
    (!verification.foodEstablishmentCertUrl || verification.foodEstablishmentCertStatus === "approved") &&
    !forceShowForm && !openInModal) {

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="w-full max-w-2xl mx-auto shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-6 w-6 text-success" />
              {t("duVerifiedTitle")}
              <InfoHint title={t("duGoodToKnow")}>
                <p className="font-medium text-foreground">{t("duWhatsNext")}</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>{t("duNextProfileVerified")}</li>
                  <li>{t("duNextAcceptOrders")}</li>
                  <li>{t("duNextStatusDisplayed")}</li>
                  <li>{t("duNextKeepCurrent")}</li>
                </ul>
                <p className="pt-2 font-medium text-foreground">{t("duUpdateDocsTitle")}</p>
                <p>{t("duUpdateDocsBody")}</p>
              </InfoHint>
            </CardTitle>
            <CardDescription>
              {t("duVerifiedDesc")}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Document Status Cards */}
            <div className="grid gap-4">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{t("duFoodSafetyTitle")}</p>
                    <p className="text-sm text-muted-foreground">
                      {getFileDisplayName(verification.foodSafetyLicenseUrl)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(verification.foodSafetyLicenseStatus)}
                  <AuthenticatedDocumentLink 
                    url={verification.foodSafetyLicenseUrl}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <FileText className="h-4 w-4" />
                  </AuthenticatedDocumentLink>
                </div>
              </div>

              {verification.foodEstablishmentCertUrl && (
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{t("duEstablishmentTitle")}</p>
                      <p className="text-sm text-muted-foreground">
                        {getFileDisplayName(verification.foodEstablishmentCertUrl)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {verification.foodEstablishmentCertStatus && getStatusBadge(verification.foodEstablishmentCertStatus)}
                    <AuthenticatedDocumentLink 
                      url={verification.foodEstablishmentCertUrl}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <FileText className="h-4 w-4" />
                    </AuthenticatedDocumentLink>
                  </div>
                </div>
              )}
            </div>

            {verification.documentsAdminFeedback && (
              <QuietNotice title={t("duAdminComments")}>
                {verification.documentsAdminFeedback}
              </QuietNotice>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-4">
              <Button asChild className="flex-1">
                <Link href="/dashboard">
                  <Award className="h-4 w-4 mr-2" />
                  {t("duGoToDashboard")}
                </Link>
              </Button>
              <Button variant="outline" onClick={() => setModalOpen(true)} className="flex-1">
                <Upload className="h-4 w-4 mr-2" />
                {t("duManageDocuments")}
              </Button>
            </div>
          </CardContent>

          <DocumentManagementModal open={modalOpen} onOpenChange={setModalOpen} />
        </Card>
      </motion.div>
    );
  }

  // If not fully verified, show the streamlined form
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {!embedded && (
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-medium">{t("duRequiredDocuments")}</h3>
            <InfoHint title={t("duGoodToKnow")}>
              <p className="font-medium text-foreground">{t("duUpdateDocsTitle")}</p>
              <p>{t("duUpdateYourDocsBody")}</p>
              <p className="font-medium text-foreground">{t("duStatusResetTitle")}</p>
              <p>{t("duStatusResetBody")}</p>
            </InfoHint>
          </div>
        )}

        {/* Food Safety License */}
        <div className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {t("duFoodSafetyTitle")} <span className="text-muted-foreground">*</span>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {verification?.foodSafetyLicenseUrl ? (
                <>
                  <span className="text-xs text-muted-foreground">{t("duDocumentUploaded")}</span>
                  {verification.foodSafetyLicenseStatus && getStatusBadge(verification.foodSafetyLicenseStatus)}
                </>
              ) : (
                <span className="text-xs text-muted-foreground">{t("duNotUploaded")}</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {verification?.foodSafetyLicenseUrl && (
              <Button variant="ghost" size="sm" asChild>
                <AuthenticatedDocumentLink
                  url={verification.foodSafetyLicenseUrl}
                  className="inline-flex items-center gap-1.5"
                >
                  <FileText className="h-4 w-4" />
                  {t("duViewDocument")}
                </AuthenticatedDocumentLink>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFoodSafetyModalOpen(true)}
            >
              {verification?.foodSafetyLicenseUrl ? (
                <>
                  <Upload className="h-4 w-4" />
                  {t("duUpdateBtn")}
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  {t("duUploadBtn")}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Food Establishment Certificate - Optional/Conditional */}
        {(verification?.foodEstablishmentCert === "yes" || verification?.foodEstablishmentCertUrl) && (
          <div className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t("duEstablishmentTitle")}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {verification?.foodEstablishmentCertUrl ? (
                  <>
                    <span className="text-xs text-muted-foreground">{t("duDocumentUploaded")}</span>
                    {verification.foodEstablishmentCertStatus && getStatusBadge(verification.foodEstablishmentCertStatus)}
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">{t("duNotUploaded")}</span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {verification?.foodEstablishmentCertUrl && (
                <Button variant="ghost" size="sm" asChild>
                  <AuthenticatedDocumentLink
                    url={verification.foodEstablishmentCertUrl}
                    className="inline-flex items-center gap-1.5"
                  >
                    <FileText className="h-4 w-4" />
                    {t("duViewDocument")}
                  </AuthenticatedDocumentLink>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEstablishmentModalOpen(true)}
              >
                {verification?.foodEstablishmentCertUrl ? (
                  <>
                    <Upload className="h-4 w-4" />
                    {t("duUpdateBtn")}
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    {t("duUploadBtn")}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      {verification?.documentsAdminFeedback && (
        <QuietNotice title={t("duAdminFeedback")}>
          {verification.documentsAdminFeedback}
        </QuietNotice>
      )}

      {uploadError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>{t("duUploadError")}</strong> {uploadError}
          </AlertDescription>
        </Alert>
      )}

      <DocumentUploadModal
        documentType="foodSafety"
        isOpen={foodSafetyModalOpen}
        onClose={() => setFoodSafetyModalOpen(false)}
        onSubmit={(data) => handleDocumentSubmit('foodSafety', data)}
        currentDocumentUrl={verification?.foodSafetyLicenseUrl || undefined}
        isRequired={true}
      />

      <DocumentUploadModal
        documentType="establishment"
        isOpen={establishmentModalOpen}
        onClose={() => setEstablishmentModalOpen(false)}
        onSubmit={(data) => handleDocumentSubmit('establishment', data)}
        currentDocumentUrl={verification?.foodEstablishmentCertUrl || undefined}
        isRequired={false}
      />
    </div>
  );
}
 