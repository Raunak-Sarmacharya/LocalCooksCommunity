import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileUpload } from "@/components/ui/file-upload";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useDocumentVerification } from "@/hooks/use-document-verification";
import { useToast } from "@/hooks/use-toast";
import { useFileUpload } from "@/hooks/useFileUpload";
import { motion } from "framer-motion";
import {
    ArrowLeft,
    CheckCircle,
    Clock,
    FileText,
    Info,
    Link as LinkIcon,
    Loader2,
    Shield,
    Upload,
    XCircle
} from "lucide-react";
import React, { useState } from "react";
import { Link } from "wouter";

export default function DocumentVerification() {
  const { user } = useFirebaseAuth();
  const { verification, loading, createMutation, updateMutation, refetch } = useDocumentVerification();
  const { toast } = useToast();

  // Form states
  const [foodSafetyLicenseUrl, setFoodSafetyLicenseUrl] = useState("");
  const [foodEstablishmentCertUrl, setFoodEstablishmentCertUrl] = useState("");
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

  // Authentication guard
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-blue-50">
        <Header />
        <main className="flex-grow container max-w-4xl mx-auto px-4 pt-28 pb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-12"
          >
            <div className="w-16 h-16 mx-auto mb-6 bg-primary/10 rounded-full flex items-center justify-center">
              <Shield className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-4 text-gray-900">Authentication Required</h1>
            <p className="text-gray-600 mb-6">
              You need to be logged in to access document verification.
            </p>
            <Button asChild className="rounded-xl">
              <Link href="/auth">Login</Link>
            </Button>
          </motion.div>
        </main>
        <Footer />
      </div>
    );
  }

  // Admin access guard
  if (user.role === "admin") {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-blue-50">
        <Header />
        <main className="flex-grow container max-w-4xl mx-auto px-4 pt-28 pb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-12"
          >
            <div className="w-16 h-16 mx-auto mb-6 bg-primary/10 rounded-full flex items-center justify-center">
              <Shield className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-4 text-gray-900">Admin Access</h1>
            <p className="text-gray-600 mb-6">
              Administrators cannot upload documents as applicants. Use the admin dashboard to manage document verification for users.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild className="rounded-xl">
                <Link href="/admin">Go to Admin Dashboard</Link>
              </Button>
              <Button variant="outline" asChild className="rounded-xl">
                <Link href="/">Return to Home</Link>
              </Button>
            </div>
          </motion.div>
        </main>
        <Footer />
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-blue-50">
        <Header />
        <main className="flex-grow container max-w-6xl mx-auto px-4 pt-28 pb-8">
          <div className="flex justify-center items-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent mx-auto mb-4"></div>
              <p className="text-gray-600 font-medium">Loading your documents...</p>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

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
        for (const [fieldName, file] of Object.entries(fileUploads)) {
          const result = await uploadFile(file);
          
          if (result) {
            if (fieldName === 'foodSafetyLicense') {
              finalData.foodSafetyLicenseUrl = result.url;
            } else if (fieldName === 'foodEstablishmentCert') {
              finalData.foodEstablishmentCertUrl = result.url;
            }
          } else {
            throw new Error(`Failed to upload ${fieldName}`);
          }
        }
      }
      
      if (foodSafetyLicenseUrl.trim()) {
        finalData.foodSafetyLicenseUrl = foodSafetyLicenseUrl.trim();
      }
      if (foodEstablishmentCertUrl.trim()) {
        finalData.foodEstablishmentCertUrl = foodEstablishmentCertUrl.trim();
      }
      
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
    switch (status.toLowerCase()) {
      case 'approved':
        return (
          <Badge className="bg-green-100 text-green-800 border-green-200">
            <CheckCircle className="h-3 w-3 mr-1" />
            Approved
          </Badge>
        );
      case 'pending':
        return (
          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case 'rejected':
        return (
          <Badge className="bg-red-100 text-red-800 border-red-200">
            <XCircle className="h-3 w-3 mr-1" />
            Rejected
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            <Clock className="h-3 w-3 mr-1" />
            Unknown
          </Badge>
        );
    }
  };

  const isFullyVerified = verification && 
    verification.foodSafetyLicenseStatus === "approved" &&
    (!verification.foodEstablishmentCertUrl || verification.foodEstablishmentCertStatus === "approved");

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-blue-50">
      <Header />
      <main className="flex-grow container max-w-6xl mx-auto px-4 pt-28 pb-8">
        {/* Back button */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="mb-6"
        >
          <Button variant="outline" size="sm" asChild className="rounded-xl">
            <Link href="/dashboard">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Link>
          </Button>
        </motion.div>

        {/* Header Section - Similar to dashboard cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200/60 hover:shadow-lg transition-all duration-300 mb-8 backdrop-blur-sm"
        >
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
              <Shield className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-semibold text-gray-900">Document Verification</h1>
              <p className="text-gray-500">Upload and manage your certificates</p>
            </div>
            {isFullyVerified && (
              <div className="flex items-center gap-2 px-4 py-2 bg-green-100 text-green-800 rounded-xl">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">Fully Verified</span>
              </div>
            )}
          </div>

          {/* Status overview */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <FileText className="h-4 w-4 text-blue-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-600">Documents</p>
                  <p className="font-medium text-gray-900">
                    {verification ? 
                      (verification.foodEstablishmentCertUrl ? '2 Uploaded' : '1 Uploaded') 
                      : 'None'}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-yellow-100 flex items-center justify-center">
                  <Clock className="h-4 w-4 text-yellow-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-600">Status</p>
                  <p className="font-medium text-gray-900">
                    {isFullyVerified ? 'Verified' : 
                     verification ? 'Under Review' : 'Not Started'}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                  <Shield className="h-4 w-4 text-green-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-600">Verified</p>
                  <p className="font-medium text-gray-900">
                    {verification && verification.foodSafetyLicenseStatus === 'approved' ? 
                      (verification.foodEstablishmentCertStatus === 'approved' || !verification.foodEstablishmentCertUrl ? 
                        'Complete' : 'Partial') 
                      : 'Pending'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Main Content Grid - Similar to dashboard layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Left Column - Current Documents & Status */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-6"
          >
            {/* Current Documents Card */}
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200/60 hover:shadow-lg transition-all duration-300 backdrop-blur-sm">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Your Documents</h3>
                  <p className="text-sm text-gray-500">Current verification status</p>
                </div>
              </div>

              {verification ? (
                <div className="space-y-4">
                  {/* Food Safety License */}
                  <div className="p-4 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-medium text-gray-900">Food Safety License</h4>
                        <p className="text-sm text-gray-600">Required certification</p>
                      </div>
                      {verification.foodSafetyLicenseStatus && 
                        getStatusBadge(verification.foodSafetyLicenseStatus)}
                    </div>
                    
                    {verification.foodSafetyLicenseUrl ? (
                      <Button asChild variant="outline" size="sm" className="rounded-lg">
                        <a 
                          href={verification.foodSafetyLicenseUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                        >
                          <FileText className="h-4 w-4 mr-2" />
                          View Document
                        </a>
                      </Button>
                    ) : (
                      <p className="text-sm text-gray-500 italic">Not uploaded</p>
                    )}
                  </div>

                  {/* Food Establishment Certificate */}
                  <div className="p-4 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-medium text-gray-900">Food Establishment Certificate</h4>
                        <p className="text-sm text-gray-600">Optional (recommended)</p>
                      </div>
                      {verification.foodEstablishmentCertStatus && 
                        getStatusBadge(verification.foodEstablishmentCertStatus)}
                    </div>
                    
                    {verification.foodEstablishmentCertUrl ? (
                      <Button asChild variant="outline" size="sm" className="rounded-lg">
                        <a 
                          href={verification.foodEstablishmentCertUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                        >
                          <FileText className="h-4 w-4 mr-2" />
                          View Document
                        </a>
                      </Button>
                    ) : (
                      <p className="text-sm text-gray-500 italic">Not uploaded</p>
                    )}
                  </div>

                  {/* Admin Feedback */}
                  {verification.documentsAdminFeedback && (
                    <Alert className="border-blue-200 bg-blue-50">
                      <Info className="h-4 w-4 text-blue-600" />
                      <AlertDescription className="text-blue-800">
                        <span className="font-medium">Admin Feedback:</span> {verification.documentsAdminFeedback}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                    <Upload className="h-8 w-8 text-gray-400" />
                  </div>
                  <h4 className="font-medium text-gray-900 mb-2">No Documents Yet</h4>
                  <p className="text-sm text-gray-600">Upload your first document to get started with verification.</p>
                </div>
              )}
            </div>

            {/* Process Steps */}
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200/60 backdrop-blur-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-6">Verification Process</h3>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-medium text-blue-600">1</span>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">Upload Documents</h4>
                    <p className="text-sm text-gray-600">Provide your certifications and licenses</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-full bg-yellow-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-medium text-yellow-600">2</span>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">Admin Review</h4>
                    <p className="text-sm text-gray-600">Our team verifies authenticity and compliance</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-medium text-green-600">3</span>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">Get Verified</h4>
                    <p className="text-sm text-gray-600">Join the trusted Local Cooks community</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right Column - Document Management */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200/60 hover:shadow-lg transition-all duration-300 backdrop-blur-sm">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center">
                  <Upload className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {verification ? 'Update Documents' : 'Upload Documents'}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {verification ? 'Replace or add new documents' : 'Submit your certificates for verification'}
                  </p>
                </div>
              </div>

              {/* Warning for existing users */}
              {verification && (
                <Alert className="mb-6 border-yellow-200 bg-yellow-50">
                  <Info className="h-4 w-4 text-yellow-600" />
                  <AlertDescription className="text-yellow-800">
                    <span className="font-medium">Note:</span> Updating documents will reset your verification status to pending review.
                  </AlertDescription>
                </Alert>
              )}

              {/* Document Upload Form */}
              <form onSubmit={handleSubmit} className="space-y-6">
                <Tabs defaultValue="upload" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 rounded-xl">
                    <TabsTrigger value="upload" className="rounded-lg">File Upload</TabsTrigger>
                    <TabsTrigger value="url" className="rounded-lg">URL Links</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="upload" className="space-y-6 mt-6">
                    {/* Food Safety License Upload */}
                    <div className="space-y-3">
                      <Label className="text-sm font-medium text-gray-900">
                        Food Safety License <span className="text-red-500">*</span>
                      </Label>
                      <FileUpload
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        onFileSelect={(file) => handleFileUpload('foodSafetyLicense', file)}
                        maxSize={4.5 * 1024 * 1024}
                        className="border-dashed border-2 border-gray-300 rounded-xl p-6 text-center hover:border-primary transition-colors"
                      />
                    </div>

                    {/* Food Establishment Certificate Upload */}
                    <div className="space-y-3">
                      <Label className="text-sm font-medium text-gray-900">
                        Food Establishment Certificate <span className="text-gray-400">(Optional)</span>
                      </Label>
                      <FileUpload
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        onFileSelect={(file) => handleFileUpload('foodEstablishmentCert', file)}
                        maxSize={4.5 * 1024 * 1024}
                        className="border-dashed border-2 border-gray-300 rounded-xl p-6 text-center hover:border-primary transition-colors"
                      />
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="url" className="space-y-6 mt-6">
                    {/* Food Safety License URL */}
                    <div className="space-y-3">
                      <Label htmlFor="foodSafetyUrl" className="text-sm font-medium text-gray-900">
                        Food Safety License URL <span className="text-red-500">*</span>
                      </Label>
                      <div className="relative">
                        <LinkIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                          id="foodSafetyUrl"
                          type="url"
                          placeholder="https://example.com/your-license.pdf"
                          value={foodSafetyLicenseUrl}
                          onChange={(e) => setFoodSafetyLicenseUrl(e.target.value)}
                          className="pl-10 rounded-xl"
                        />
                      </div>
                    </div>

                    {/* Food Establishment Certificate URL */}
                    <div className="space-y-3">
                      <Label htmlFor="establishmentUrl" className="text-sm font-medium text-gray-900">
                        Food Establishment Certificate URL <span className="text-gray-400">(Optional)</span>
                      </Label>
                      <div className="relative">
                        <LinkIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                          id="establishmentUrl"
                          type="url"
                          placeholder="https://example.com/your-certificate.pdf"
                          value={foodEstablishmentCertUrl}
                          onChange={(e) => setFoodEstablishmentCertUrl(e.target.value)}
                          className="pl-10 rounded-xl"
                        />
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>

                {/* Submit Button */}
                <div className="pt-4 border-t border-gray-200">
                  <Button 
                    type="submit" 
                    disabled={isUploading || createMutation.isPending || updateMutation.isPending}
                    className="w-full rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white font-medium py-3"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Uploading... {Math.round(uploadProgress)}%
                      </>
                    ) : createMutation.isPending || updateMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {verification ? 'Updating...' : 'Submitting...'}
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        {verification ? 'Update Documents' : 'Submit Documents'}
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </div>
          </motion.div>
        </div>

        {/* Requirements Section - Full Width */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-8"
        >
          <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200/60 backdrop-blur-sm">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                <Info className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Document Requirements</h3>
                <p className="text-sm text-gray-500">What we need for verification</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="text-red-600 font-medium text-sm">*</span>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">Food Safety License (Required)</h4>
                    <ul className="space-y-1 text-sm text-gray-600">
                      <li>• Valid, current food safety certification</li>
                      <li>• Clear, readable document quality</li>
                      <li>• PDF, JPG, PNG, or WebP format</li>
                      <li>• Maximum file size: 4.5MB</li>
                    </ul>
                  </div>
                </div>
              </div>
              
              <div className="p-6 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="text-blue-600 font-medium text-sm">+</span>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">Food Establishment Certificate (Optional)</h4>
                    <ul className="space-y-1 text-sm text-gray-600">
                      <li>• Enhances your credibility</li>
                      <li>• Shows regulatory compliance</li>
                      <li>• Same format requirements</li>
                      <li>• Recommended but not mandatory</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </main>
      <Footer />
    </div>
  );
} 