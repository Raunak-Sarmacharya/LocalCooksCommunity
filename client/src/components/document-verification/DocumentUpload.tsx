import { logger } from "@/lib/logger";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  Info,
  Loader2,
  Plus,
  Upload,
  XCircle
} from "lucide-react";
import React, { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { QuietNotice } from "@/components/chef/ui";

// Helper component for authenticated document links
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

// Add types for props
interface DocumentManagementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DocumentUploadProps {
  openInModal?: boolean;
  forceShowForm?: boolean;
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
  const { toast } = useToast();
  const { t } = useTranslation("chef");

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

      // Reset form and close modal
      setUrl("");
      setSelectedFile(null);
      setErrors({});
      onClose();

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
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
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
          {/* Current Document Display */}
          {currentDocumentUrl && (
            <div className="rounded-lg border px-4 py-3">
              <p className="text-sm font-medium mb-2">{t("duCurrentDocument")}</p>
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <a
                  href={currentDocumentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {t("duViewDocument")}
                </a>
              </div>
            </div>
          )}

          {/* Upload Options */}
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
                  <div className="flex items-center justify-between p-3 border border-gray-300 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                    <div className="flex items-center gap-3">
                      <FolderOpen className="h-5 w-5 text-gray-500" />
                      <span className="text-sm text-gray-700">
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
                <p className="text-xs text-gray-500">
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
                  className={errors.url ? "border-red-500" : ""}
                />
                {errors.url && (
                  <p className="text-sm text-red-500 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {errors.url}
                  </p>
                )}
                <p className="text-xs text-gray-500">
                  {t("duUrlHint")}
                </p>
              </div>
            </TabsContent>
          </Tabs>

          {/* Error Display */}
          {errors.general && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {errors.general}
              </AlertDescription>
            </Alert>
          )}

          {/* Submit Button */}
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} className="flex-1">
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
  );
}

export function DocumentManagementModal({ open, onOpenChange }: DocumentManagementModalProps) {
  const { t } = useTranslation("chef");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-full max-h-screen overflow-y-auto p-0 sm:p-6 rounded-lg sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle>{t("duManageTitle")}</DialogTitle>
          <DialogClose />
        </DialogHeader>
        <div className="p-4 sm:p-0">
          <QuietNotice title={t("duStatusResetTitle")}>
            {t("duStatusResetBody")}
          </QuietNotice>
          <DocumentUpload forceShowForm />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function DocumentUpload({ openInModal = false, forceShowForm = false }: DocumentUploadProps) {
  const { verification, loading, createMutation, updateMutation, refetch, forceRefresh } = useDocumentVerification();
  const { toast } = useToast();
  const { t } = useTranslation("chef");

  // Check if we're in production (Vercel)
  const isProduction = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production';

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
      <Badge variant={config.variant}>
        <Icon className="w-3 h-3 mr-1" />
        {config.text}
      </Badge>
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
                      <p className="font-medium">Food Establishment Certificate</p>
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

            {/* Admin Feedback */}
            {verification.documentsAdminFeedback && (
              <QuietNotice title={t("duAdminComments")}>
                {verification.documentsAdminFeedback}
              </QuietNotice>
            )}

            <QuietNotice title={t("duWhatsNext")}>
              <ul className="list-disc pl-4 space-y-1 mt-1">
                <li>{t("duNextProfileVerified")}</li>
                <li>{t("duNextAcceptOrders")}</li>
                <li>{t("duNextStatusDisplayed")}</li>
                <li>{t("duNextKeepCurrent")}</li>
              </ul>
            </QuietNotice>

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

            <QuietNotice title={t("duUpdateDocsTitle")}>
              {t("duUpdateDocsBody")}
            </QuietNotice>
          </CardContent>

          <DocumentManagementModal open={modalOpen} onOpenChange={setModalOpen} />
        </Card>
      </motion.div>
    );
  }

  // If not fully verified, show the new streamlined form
  return (
    <div className="space-y-6">
      {/* Special alert for documents under review - Only show when documents are ACTUALLY uploaded and pending */}
      {verification && (() => {
        // Check if documents are actually uploaded AND pending review
        const hasFoodSafetyPending = verification.foodSafetyLicenseUrl && verification.foodSafetyLicenseStatus === "pending";
        const hasEstablishmentPending = verification.foodEstablishmentCertUrl && verification.foodEstablishmentCertStatus === "pending";
        const hasDocumentsPending = hasFoodSafetyPending || hasEstablishmentPending;

        if (hasDocumentsPending) {
          return (
            <Alert>
              <Clock className="h-4 w-4" />
              <AlertDescription>
                <strong>{t("duUnderReviewPrefix")}</strong>{t("duUnderReviewBody")}
                <br /><br />
                {t("duUnderReviewFooter")}
              </AlertDescription>
            </Alert>
          );
        }
        return null;
      })()}

      {verification && (verification.foodSafetyLicenseUrl || verification.foodEstablishmentCertUrl) && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>{t("duUpdateYourDocs")}</strong>{t("duUpdateYourDocsBody")}
          </AlertDescription>
        </Alert>
      )}

      {/* Document Management Section */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900">{t("duRequiredDocuments")}</h3>

        {/* Food Safety License */}
        <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg border bg-muted flex items-center justify-center">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <h4 className="font-medium text-gray-900">{t("duFoodSafetyTitle")} *</h4>
              <div className="flex items-center gap-2 mt-1">
                {verification?.foodSafetyLicenseUrl ? (
                  <>
                    <span className="text-sm text-gray-600">{t("duDocumentUploaded")}</span>
                    {verification.foodSafetyLicenseStatus && getStatusBadge(verification.foodSafetyLicenseStatus)}
                  </>
                ) : (
                  <span className="text-sm text-gray-500">{t("duNotUploaded")}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {verification?.foodSafetyLicenseUrl && (
              <Button variant="ghost" size="sm" asChild>
                <a href={verification.foodSafetyLicenseUrl} target="_blank" rel="noopener noreferrer">
                  <FileText className="h-4 w-4" />
                </a>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFoodSafetyModalOpen(true)}
            >
              {verification?.foodSafetyLicenseUrl ? (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  {t("duUpdateBtn")}
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  {t("duUploadBtn")}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Food Establishment Certificate */}
        <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg border bg-muted flex items-center justify-center">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <h4 className="font-medium text-gray-900">{t("duEstablishmentTitle")}</h4>
              <div className="flex items-center gap-2 mt-1">
                {verification?.foodEstablishmentCertUrl ? (
                  <>
                    <span className="text-sm text-gray-600">{t("duDocumentUploaded")}</span>
                    {verification.foodEstablishmentCertStatus && getStatusBadge(verification.foodEstablishmentCertStatus)}
                  </>
                ) : (
                  <span className="text-sm text-gray-500">{t("duNotUploaded")}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {verification?.foodEstablishmentCertUrl && (
              <Button variant="ghost" size="sm" asChild>
                <AuthenticatedDocumentLink 
                  url={verification.foodEstablishmentCertUrl}
                >
                  <FileText className="h-4 w-4" />
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
                  <Upload className="h-4 w-4 mr-2" />
                  {t("duUpdateBtn")}
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  {t("duUploadBtn")}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Admin Feedback */}
      {verification?.documentsAdminFeedback && (
        <Alert>
          <Award className="h-4 w-4" />
          <AlertDescription>
            <strong>{t("duAdminFeedback")}</strong> {verification.documentsAdminFeedback}
          </AlertDescription>
        </Alert>
      )}

      {/* Upload Error Display */}
      {uploadError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>{t("duUploadError")}</strong> {uploadError}
          </AlertDescription>
        </Alert>
      )}

      {/* Document Upload Modals */}
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