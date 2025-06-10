import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileUpload } from "@/components/ui/file-upload";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentVerification } from "@/hooks/use-document-verification";
import { useToast } from "@/hooks/use-toast";
import { useFileUpload } from "@/hooks/useFileUpload";
import { motion } from "framer-motion";
import {
    AlertTriangle,
    Award,
    CheckCircle,
    Clock,
    FileText,
    Info,
    Link as LinkIcon,
    Loader2,
    Upload,
    XCircle
} from "lucide-react";
import React, { useState } from "react";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";

// Add types for props
interface DocumentManagementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DocumentUploadProps {
  openInModal?: boolean;
  forceShowForm?: boolean;
}

export function DocumentManagementModal({ open, onOpenChange }: DocumentManagementModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-full max-h-screen overflow-y-auto p-0 sm:p-6 rounded-lg sm:rounded-2xl">
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
  const { verification, isLoading, createMutation, updateMutation, refetch, forceRefresh } = useDocumentVerification();
  const { toast } = useToast();
  
  // Check if we're in production (Vercel)
  const isProduction = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production';
  
  // URL states (keep these)
  const [foodSafetyLicenseUrl, setFoodSafetyLicenseUrl] = useState("");
  const [foodEstablishmentCertUrl, setFoodEstablishmentCertUrl] = useState("");
  
  // File upload states
  const [fileUploads, setFileUploads] = useState<Record<string, File>>({});
  
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  const validateUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  // File upload handlers
  const handleFileUpload = (fieldName: string, file: File | null) => {
    setFileUploads((prev: Record<string, File>) => {
      const updated: Record<string, File> = { ...prev };
      if (file) {
        updated[fieldName] = file as File;
      } else {
        delete updated[fieldName];
      }
      return updated;
    });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrors({});
    
    // Check if we have files to upload
    const hasFiles = Object.keys(fileUploads).length > 0;
    const hasUrls = foodSafetyLicenseUrl.trim() || foodEstablishmentCertUrl.trim();
    
    if (!hasFiles && !hasUrls) {
      toast({
        title: "No documents provided",
        description: "Please upload files or provide URLs for your documents.",
        variant: "destructive",
      });
      return;
    }
    
    try {
      let finalData: Record<string, string> = {};
      
      if (hasFiles) {
        // Upload files to storage first
        for (const [fieldName, file] of Object.entries(fileUploads)) {
          console.log(`Uploading file for field ${fieldName}:`, {
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type
          });
          
          const result = await uploadFile(file);
          
          console.log(`Upload result for ${fieldName}:`, result);
          
          if (result) {
            // Map field names to the expected URL field names
            if (fieldName === 'foodSafetyLicense') {
              finalData.foodSafetyLicenseUrl = result.url;
              console.log('Set foodSafetyLicenseUrl:', result.url);
            } else if (fieldName === 'foodEstablishmentCert') {
              finalData.foodEstablishmentCertUrl = result.url;
              console.log('Set foodEstablishmentCertUrl:', result.url);
            }
          } else {
            throw new Error(`Failed to upload ${fieldName}`);
          }
        }
      }
      
      // Add URL fields if provided
      if (foodSafetyLicenseUrl.trim()) {
        finalData.foodSafetyLicenseUrl = foodSafetyLicenseUrl.trim();
      }
      if (foodEstablishmentCertUrl.trim()) {
        finalData.foodEstablishmentCertUrl = foodEstablishmentCertUrl.trim();
      }
      
      // Submit the combined data (files + URLs) to the document verification system
      console.log('Submitting document data to API:', {
        verificationExists: !!verification,
        finalData,
        applicationId: verification?.id
      });
      
      if (verification) {
        updateMutation.mutate(finalData);
      } else {
        createMutation.mutate(finalData);
      }
      
      // Clear form after successful submission
      setFileUploads({});
      setFoodSafetyLicenseUrl("");
      setFoodEstablishmentCertUrl("");
      
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload files",
        variant: "destructive",
      });
    }
  };

  const getStatusBadge = (status: string): React.ReactNode => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-300">
            <Clock className="h-3 w-3 mr-1" />
            Pending Review
          </Badge>
        );
      case "approved":
        return (
          <Badge variant="secondary" className="bg-green-100 text-green-800 border-green-300">
            <CheckCircle className="h-3 w-3 mr-1" />
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="secondary" className="bg-red-100 text-red-800 border-red-300">
            <XCircle className="h-3 w-3 mr-1" />
            Rejected
          </Badge>
        );
      default:
        return null;
    }
  };

  const getFileDisplayName = (url: string | null): string | null => {
    if (!url) return null;
    if (url.startsWith('/api/files/')) {
      // Extract original filename from our file path
      const filename = url.split('/').pop() || '';
      const parts = filename.split('_');
      if (parts.length >= 4) {
        return parts.slice(3).join('_'); // Get original filename part
      }
      return filename;
    }
    return url; // It's a URL
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Check if user has an approved application for document verification
  if (!verification) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="w-full max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              No Approved Application Found
            </CardTitle>
            <CardDescription>
              You need an approved application before you can upload documents for verification.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <strong>Next Steps:</strong> You need to submit an application and have it approved 
                before you can upload documents for verification. Once your application is approved, 
                you'll be able to upload your required documents here.
              </AlertDescription>
            </Alert>
            <div className="text-center pt-4">
              <Button asChild className="bg-primary hover:bg-primary/90">
                <Link href="/apply">
                  <Award className="h-4 w-4 mr-2" />
                  Submit Application
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  // Check if user is fully verified
  const isFullyVerified = verification.foodSafetyLicenseStatus === "approved" && 
    (!verification.foodEstablishmentCertUrl || verification.foodEstablishmentCertStatus === "approved");

  const [modalOpen, setModalOpen] = useState(false);

  // If openInModal and not forceShowForm, show only the verification card and modal trigger
  if (openInModal && !forceShowForm) {
    if (isFullyVerified) {
      return (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <Card className="w-full max-w-2xl mx-auto">
            <CardHeader className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="h-12 w-12 text-green-600" />
              </div>
              <CardTitle className="flex items-center justify-center gap-2 text-green-800">
                <Award className="h-6 w-6" />
                Verification Complete!
              </CardTitle>
              <CardDescription className="text-green-600">
                Congratulations! Your documents have been approved and you are now fully verified.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-green-800 mb-4">✅ Verification Status</h3>
                
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-green-700">Food Safety License:</span>
                    <Badge variant="secondary" className="bg-green-100 text-green-800 border-green-300">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Approved
                    </Badge>
                  </div>
                  
                  {verification.foodEstablishmentCertUrl && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-green-700">Food Establishment Certificate:</span>
                      <Badge variant="secondary" className="bg-green-100 text-green-800 border-green-300">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Approved
                      </Badge>
                    </div>
                  )}
                  
                  {verification.documentsReviewedAt && (
                    <div className="text-xs text-green-600 mt-3 pt-3 border-t border-green-200">
                      <strong>Approved on:</strong> {new Date(verification.documentsReviewedAt).toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </div>
                  )}
                </div>
              </div>

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
          </Card>
          <DocumentManagementModal open={modalOpen} onOpenChange={setModalOpen} />
        </motion.div>
      );
    }
    // If not fully verified, just show the form as usual
    return <DocumentUpload forceShowForm />;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Document Verification
          </CardTitle>
          <CardDescription>
            Upload your required documents for verification. You can upload files directly from your device or provide URLs to documents you've stored in cloud services (Google Drive, Dropbox, OneDrive, etc.).
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {verification && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <strong>Update your documents:</strong> You can upload new files or provide new URLs to replace your current documents. 
                The status will reset to "Pending Review" when you submit new documents.
              </AlertDescription>
            </Alert>
          )}
          
          <Alert className="mb-4">
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>Two Ways to Submit Documents:</strong> 
              <br />• <strong>Upload Files:</strong> Select files directly from your device
              <br />• <strong>Provide URLs:</strong> Share links from Google Drive, Dropbox, OneDrive, etc. (make sure links allow public viewing)
            </AlertDescription>
          </Alert>

          <Tabs defaultValue="upload" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="upload" className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                {verification ? "Upload New Files" : "Upload Files"}
              </TabsTrigger>
              <TabsTrigger value="url" className="flex items-center gap-2">
                <LinkIcon className="h-4 w-4" />
                {verification ? "Update URLs" : "Provide URLs"}
              </TabsTrigger>
            </TabsList>

            <form onSubmit={handleSubmit} className="space-y-6 mt-6">
              {/* File Upload Tab - Always available */}
              <TabsContent value="upload" className="space-y-6 mt-0">
                {/* Food Safety License File Upload */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">
                      Food Safety License * {verification && "(Upload new file)"}
                    </Label>
                    {verification?.foodSafetyLicenseStatus && getStatusBadge(verification.foodSafetyLicenseStatus)}
                  </div>
                  
                  {/* Show current document if exists */}
                  {verification?.foodSafetyLicenseUrl && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                      <p className="text-sm font-medium text-blue-800 mb-1">Current document:</p>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-blue-600" />
                        <span className="text-sm text-blue-700">
                          {getFileDisplayName(verification.foodSafetyLicenseUrl) || 'Document uploaded'}
                        </span>
                      </div>
                      <p className="text-xs text-blue-600 mt-1">
                        Upload a new file below to replace this document
                      </p>
                    </div>
                  )}
                  
                  <FileUpload
                    fieldName="foodSafetyLicense"
                    label=""
                    required={true}
                    currentFile={fileUploads.foodSafetyLicense}
                    onFileChange={(file) => handleFileUpload("foodSafetyLicense", file)}
                    className="mt-0"
                  />
                  
                  <p className="text-xs text-gray-500">
                    Upload a clear photo or scan of your Food Safety License certificate.
                  </p>
                </div>

                {/* Food Establishment Certificate File Upload */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">
                      Food Establishment Certificate (Optional) {verification && verification.foodEstablishmentCertUrl && "(Upload new file)"}
                    </Label>
                    {verification?.foodEstablishmentCertStatus && getStatusBadge(verification.foodEstablishmentCertStatus)}
                  </div>
                  
                  {/* Show current document if exists */}
                  {verification?.foodEstablishmentCertUrl && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                      <p className="text-sm font-medium text-blue-800 mb-1">Current document:</p>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-blue-600" />
                        <span className="text-sm text-blue-700">
                          {getFileDisplayName(verification.foodEstablishmentCertUrl) || 'Document uploaded'}
                        </span>
                      </div>
                      <p className="text-xs text-blue-600 mt-1">
                        Upload a new file below to replace this document
                      </p>
                    </div>
                  )}
                  
                  <FileUpload
                    fieldName="foodEstablishmentCert"
                    label=""
                    required={false}
                    currentFile={fileUploads.foodEstablishmentCert}
                    onFileChange={(file) => handleFileUpload("foodEstablishmentCert", file)}
                    className="mt-0"
                  />
                  
                  <p className="text-xs text-gray-500">
                    Upload your Food Establishment Certificate (optional but recommended).
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="url" className="space-y-6 mt-0">
                {/* Food Safety License URL */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="foodSafetyLicenseUrl" className="text-sm font-medium">
                      Food Safety License URL * {verification && "(Update current URL)"}
                    </Label>
                    {verification?.foodSafetyLicenseStatus && getStatusBadge(verification.foodSafetyLicenseStatus)}
                  </div>
                  
                  {/* Show current URL if exists */}
                  {verification?.foodSafetyLicenseUrl && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                      <p className="text-sm font-medium text-blue-800 mb-1">Current URL:</p>
                      <a 
                        href={verification.foodSafetyLicenseUrl} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-blue-600 underline font-medium"
                      >
                        View Document
                      </a>
                      <p className="text-xs text-blue-600 mt-1">
                        Enter a new URL below to replace this link
                      </p>
                    </div>
                  )}
                  
                  <Input
                    id="foodSafetyLicenseUrl"
                    type="url"
                    placeholder="https://example.com/your-food-safety-license.pdf"
                    value={foodSafetyLicenseUrl}
                    onChange={(e) => setFoodSafetyLicenseUrl(e.target.value)}
                    className={errors.foodSafetyUrl ? "border-red-500" : ""}
                  />
                  {errors.foodSafetyUrl && (
                    <p className="text-sm text-red-500 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {errors.foodSafetyUrl}
                    </p>
                  )}
                  <p className="text-xs text-gray-500">
                    Provide a direct link to your Food Safety License document.
                  </p>
                </div>

                {/* Food Establishment Certificate URL */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="foodEstablishmentCertUrl" className="text-sm font-medium">
                      Food Establishment Certificate URL (Optional) {verification && verification.foodEstablishmentCertUrl && "(Update current URL)"}
                    </Label>
                    {verification?.foodEstablishmentCertStatus && getStatusBadge(verification.foodEstablishmentCertStatus)}
                  </div>
                  
                  {/* Show current URL if exists */}
                  {verification?.foodEstablishmentCertUrl && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                      <p className="text-sm font-medium text-blue-800 mb-1">Current URL:</p>
                      <a 
                        href={verification.foodEstablishmentCertUrl} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-blue-600 underline font-medium"
                      >
                        View Document
                      </a>
                      <p className="text-xs text-blue-600 mt-1">
                        Enter a new URL below to replace this link
                      </p>
                    </div>
                  )}
                  
                  <Input
                    id="foodEstablishmentCertUrl"
                    type="url"
                    placeholder="https://example.com/your-food-establishment-cert.pdf"
                    value={foodEstablishmentCertUrl}
                    onChange={(e) => setFoodEstablishmentCertUrl(e.target.value)}
                    className={errors.foodEstablishmentUrl ? "border-red-500" : ""}
                  />
                  {errors.foodEstablishmentUrl && (
                    <p className="text-sm text-red-500 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {errors.foodEstablishmentUrl}
                    </p>
                  )}
                  <p className="text-xs text-gray-500">
                    Provide a direct link to your Food Establishment Certificate document.
                  </p>
                </div>
              </TabsContent>

              {/* Admin Feedback */}
              {verification?.documentsAdminFeedback && (
                <Alert>
                  <Award className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Admin Feedback:</strong> {verification.documentsAdminFeedback}
                  </AlertDescription>
                </Alert>
              )}

              {/* Submit Button */}
              <Button 
                type="submit" 
                className="w-full"
                disabled={createMutation.isPending || updateMutation.isPending || isUploading}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading files... {uploadProgress > 0 && `${Math.round(uploadProgress)}%`}
                  </>
                ) : (createMutation.isPending || updateMutation.isPending) ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {verification ? "Updating..." : "Submitting..."}
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    {verification ? "Update Documents" : "Upload Documents"}
                  </>
                )}
              </Button>
              
              {/* Upload Error Display */}
              {uploadError && (
                <Alert className="mt-2">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-red-600">
                    <strong>Upload Error:</strong> {uploadError}
                  </AlertDescription>
                </Alert>
              )}
            </form>
          </Tabs>


        </CardContent>
      </Card>
    </motion.div>
  );
} 