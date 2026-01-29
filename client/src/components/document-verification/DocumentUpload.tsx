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
      setErrors({ general: "Please select a file or provide a URL" });
      return;
    }

    if (url.trim() && !validateUrl(url.trim())) {
      setErrors({ url: "Please enter a valid URL" });
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
        title: "Document updated successfully",
        description: `Your ${documentType === 'foodSafety' ? 'Food Safety License' : 'Food Establishment Certificate'} has been updated.`,
      });
    } catch (error) {
      setErrors({ general: "Failed to update document. Please try again." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const documentTitle = documentType === 'foodSafety'
    ? 'Food Safety License'
    : 'Food Establishment Certificate';

  const documentDescription = documentType === 'foodSafety'
    ? 'Upload a clear photo or scan of your Food Safety License certificate.'
    : 'Upload your Food Establishment Certificate (optional but recommended).';

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
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm font-medium text-blue-800 mb-2">Current document:</p>
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600" />
                <a
                  href={currentDocumentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 underline font-medium text-sm"
                >
                  View Document
                </a>
              </div>
            </div>
          )}

          {/* Upload Options */}
          <Tabs defaultValue="file" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="file">Upload File</TabsTrigger>
              <TabsTrigger value="url">Provide URL</TabsTrigger>
            </TabsList>

            <TabsContent value="file" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={`file-${documentType}`}>Select Document</Label>
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
                        {selectedFile ? selectedFile.name : "Choose file..."}
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
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  Supports PDF, JPG, PNG, WebP (max 4.5MB)
                </p>
              </div>
            </TabsContent>

            <TabsContent value="url" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={`url-${documentType}`}>Document URL</Label>
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
                  Link from Google Drive, Dropbox, OneDrive, etc. (ensure public access)
                </p>
              </div>
            </TabsContent>
          </Tabs>

          {/* Error Display */}
          {errors.general && (
            <Alert className="border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800">
                {errors.general}
              </AlertDescription>
            </Alert>
          )}

          {/* Submit Button */}
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex-1"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Update
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-full max-h-screen overflow-y-auto p-0 sm:p-6 rounded-lg sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle>Manage Your Documents</DialogTitle>
          <DialogClose />
        </DialogHeader>
        <div className="p-4 sm:p-0">
          <div className="mb-4 bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded flex items-center gap-2">
            <Info className="h-5 w-5 text-yellow-600" />
            <span className="text-yellow-800 text-sm font-medium">Updating your documents will reset your verification status to <b>pending review</b>.</span>
          </div>
          <DocumentUpload forceShowForm />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function DocumentUpload({ openInModal = false, forceShowForm = false }: DocumentUploadProps) {
  const { verification, loading, createMutation, updateMutation, refetch, forceRefresh } = useDocumentVerification();
  const { toast } = useToast();

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

  // Check if application is in a state that allows document uploads
  const isApplicationActive = () => {
    if (!verification) return false;
    return verification.status !== 'cancelled' && verification.status !== 'rejected';
  };

  // Handle individual document submission
  const handleDocumentSubmit = async (documentType: 'foodSafety' | 'establishment', data: { url?: string; file?: File }) => {
    if (!isApplicationActive()) {
      toast({
        title: "Upload not allowed",
        description: "Document uploads are not permitted for cancelled or rejected applications.",
        variant: "destructive",
      });
      return;
    }

    try {
      const finalData: Record<string, string> = {};

      if (data.file) {
        console.log(`Uploading file for ${documentType}:`, {
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

      console.log('Submitting document data to API:', {
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
      console.error('Document submission error:', error);
      throw error;
    }
  };

  const getStatusBadge = (status: string): React.ReactNode => {
    const statusConfig = {
      pending: { color: "bg-yellow-100 text-yellow-800", icon: Clock, text: "Pending Review" },
      approved: { color: "bg-green-100 text-green-800", icon: CheckCircle, text: "Approved" },
      rejected: { color: "bg-red-100 text-red-800", icon: XCircle, text: "Rejected" }
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    const Icon = config.icon;

    return (
      <Badge className={`${config.color} border-transparent`}>
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
      title: "Documents updated successfully!",
      description: "Your verification status has been reset to pending review.",
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
          {verification.status === 'cancelled' ? 'Application Cancelled' : 'Application Not Active'}
        </h3>
        <p className="text-gray-600 mb-6 max-w-md mx-auto">
          {verification.status === 'cancelled'
            ? 'This application has been cancelled. Document uploads are no longer available for this application.'
            : 'Document uploads are only available for active applications.'}
        </p>
        <div className="space-y-3">
          <Button asChild className="rounded-xl">
            <Link href="/dashboard?view=applications&action=new">
              <ChefHat className="mr-2 h-4 w-4" />
              Submit New Application
            </Link>
          </Button>
          <div>
            <Button variant="outline" asChild className="rounded-xl">
              <Link href="/dashboard">
                <FileText className="mr-2 h-4 w-4" />
                Back to Dashboard
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
        <Card className="w-full max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-800">
              <CheckCircle className="h-6 w-6 text-green-600" />
              Document Verification Complete
            </CardTitle>
            <CardDescription className="text-green-700">
              All your documents have been verified and approved! 🎉
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Document Status Cards */}
            <div className="grid gap-4">
              <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="font-medium text-green-800">Food Safety License</p>
                    <p className="text-sm text-green-600">
                      {getFileDisplayName(verification.foodSafetyLicenseUrl)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(verification.foodSafetyLicenseStatus)}
                  <AuthenticatedDocumentLink 
                    url={verification.foodSafetyLicenseUrl}
                    className="text-green-600 hover:text-green-800"
                  >
                    <FileText className="h-4 w-4" />
                  </AuthenticatedDocumentLink>
                </div>
              </div>

              {verification.foodEstablishmentCertUrl && (
                <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-green-600" />
                    <div>
                      <p className="font-medium text-green-800">Food Establishment Certificate</p>
                      <p className="text-sm text-green-600">
                        {getFileDisplayName(verification.foodEstablishmentCertUrl)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {verification.foodEstablishmentCertStatus && getStatusBadge(verification.foodEstablishmentCertStatus)}
                    <AuthenticatedDocumentLink 
                      url={verification.foodEstablishmentCertUrl}
                      className="text-green-600 hover:text-green-800"
                    >
                      <FileText className="h-4 w-4" />
                    </AuthenticatedDocumentLink>
                  </div>
                </div>
              )}
            </div>

            {/* Admin Feedback */}
            {verification.documentsAdminFeedback && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="text-sm font-medium text-blue-800 mb-2">💬 Admin Comments</h4>
                <p className="text-sm text-blue-700">{verification.documentsAdminFeedback}</p>
              </div>
            )}

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-800 mb-3">🎉 What's Next?</h4>
              <div className="space-y-2 text-sm text-gray-600">
                <p>• Your profile is now marked as verified</p>
                <p>• You can start accepting orders from customers</p>
                <p>• Your verified status will be displayed to potential customers</p>
                <p>• Keep your documents current and renew them as needed</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-4">
              <Button asChild className="flex-1">
                <Link href="/dashboard">
                  <Award className="h-4 w-4 mr-2" />
                  Go to Dashboard
                </Link>
              </Button>
              <Button variant="outline" onClick={() => setModalOpen(true)} className="flex-1">
                <Upload className="h-4 w-4 mr-2" />
                Manage Documents
              </Button>
            </div>

            {/* Note about document updates */}
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Update Documents:</strong> You can update your verified documents anytime. New uploads will reset your verification status to "pending review" for security.
              </p>
            </div>
          </CardContent>

          <DocumentManagementModal open={modalOpen} onOpenChange={setModalOpen} />
        </Card>
      </motion.div>
    );
  }

  // If not fully verified, show the new streamlined form
  return (
    <div className="space-y-6">
      {/* Special alert for documents under review */}
      {verification && (() => {
        const hasDocumentsPending = (verification.foodSafetyLicenseStatus === "pending") ||
          (verification.foodEstablishmentCertUrl && verification.foodEstablishmentCertStatus === "pending");

        if (hasDocumentsPending) {
          return (
            <Alert className="bg-amber-50 border-amber-200">
              <Clock className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                <strong className="text-amber-900">Documents Under Review!</strong>
                <br />We're currently reviewing your submitted documents. You'll receive an email notification once the review is complete. Until then, you have full access to your dashboard.
                <br /><br />
                <span className="text-amber-700">You can still update or replace your documents below if needed.</span>
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
            <strong>Update your documents:</strong> You can upload new files or provide new URLs to replace your current documents.
            The status will reset to "Pending Review" when you submit new documents.
          </AlertDescription>
        </Alert>
      )}

      {/* Document Management Section */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900">Required Documents</h3>

        {/* Food Safety License */}
        <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <FileText className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <h4 className="font-medium text-gray-900">Food Safety License *</h4>
              <div className="flex items-center gap-2 mt-1">
                {verification?.foodSafetyLicenseUrl ? (
                  <>
                    <span className="text-sm text-gray-600">Document uploaded</span>
                    {verification.foodSafetyLicenseStatus && getStatusBadge(verification.foodSafetyLicenseStatus)}
                  </>
                ) : (
                  <span className="text-sm text-gray-500">Not uploaded</span>
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
                  Update
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Upload
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Food Establishment Certificate */}
        <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
              <FileText className="h-5 w-5 text-green-600" />
            </div>
            <div className="flex-1">
              <h4 className="font-medium text-gray-900">Food Establishment Certificate</h4>
              <div className="flex items-center gap-2 mt-1">
                {verification?.foodEstablishmentCertUrl ? (
                  <>
                    <span className="text-sm text-gray-600">Document uploaded</span>
                    {verification.foodEstablishmentCertStatus && getStatusBadge(verification.foodEstablishmentCertStatus)}
                  </>
                ) : (
                  <span className="text-sm text-gray-500">Optional</span>
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
                  Update
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Upload
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
            <strong>Admin Feedback:</strong> {verification.documentsAdminFeedback}
          </AlertDescription>
        </Alert>
      )}

      {/* Upload Error Display */}
      {uploadError && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">
            <strong>Upload Error:</strong> {uploadError}
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