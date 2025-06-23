import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

// Custom FileUpload component to fix integration issues
interface FileUploadProps {
  fieldName: string;
  onFileSelect: (file: File | null) => void;
  accept?: string;
  maxSize?: number;
  className?: string;
}

function SimpleFileUpload({ fieldName, onFileSelect, accept = ".pdf,.jpg,.jpeg,.png,.webp", maxSize = 4.5, className = "" }: FileUploadProps) {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const validateFile = (file: File): boolean => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload PDF, JPG, PNG, or WebP files only.",
        variant: "destructive",
      });
      return false;
    }
    
    if (file.size > maxSize * 1024 * 1024) {
      toast({
        title: "File too large",
        description: `Please upload files smaller than ${maxSize}MB.`,
        variant: "destructive",
      });
      return false;
    }
    
    return true;
  };

  const handleFileSelect = (file: File | null) => {
    if (file && !validateFile(file)) {
      return;
    }
    setSelectedFile(file);
    onFileSelect(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  return (
    <div className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
      isDragOver 
        ? 'border-primary bg-primary/5' 
        : 'border-gray-300 hover:border-gray-400'
    } ${className}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {selectedFile ? (
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-gray-500" />
            <div className="text-left">
              <p className="text-sm font-medium text-gray-900 truncate">
                {selectedFile.name}
              </p>
              <p className="text-xs text-gray-500">
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleFileSelect(null)}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <XCircle className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <>
          <input
            id={fieldName}
            type="file"
            accept={accept}
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              handleFileSelect(file);
            }}
            className="hidden"
          />
          <label htmlFor={fieldName} className="cursor-pointer">
            <div className="flex flex-col items-center space-y-2">
              <Upload className="h-8 w-8 text-gray-400" />
              <div className="text-sm text-gray-600">
                <span className="font-medium text-primary">Click to upload</span> or drag and drop
              </div>
              <p className="text-xs text-gray-500">
                PDF, JPG, PNG, WebP (max {maxSize}MB)
              </p>
            </div>
          </label>
        </>
      )}
    </div>
  );
}

export default function DocumentVerification() {
  const { user } = useFirebaseAuth();
  const { verification, loading, createMutation, updateMutation, refetch } = useDocumentVerification();
  const { toast } = useToast();

  // Form states
  const [foodSafetyLicenseUrl, setFoodSafetyLicenseUrl] = useState("");
  const [foodEstablishmentCertUrl, setFoodEstablishmentCertUrl] = useState("");
  const [fileUploads, setFileUploads] = useState<Record<string, File>>({});

  // Initialize file upload hook
  const { uploadFile, isUploading, uploadProgress } = useFileUpload({
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

  // Helper functions for document-specific logic
  const hasDocuments = verification && (verification.foodSafetyLicenseUrl || verification.foodEstablishmentCertUrl);
  const documentsCount = verification ? 
    (verification.foodSafetyLicenseUrl ? 1 : 0) + (verification.foodEstablishmentCertUrl ? 1 : 0) : 0;

  // Document-specific status (not application status)
  const getDocumentStatus = () => {
    if (!hasDocuments) return "Not Started";
    
    const foodSafetyApproved = verification?.foodSafetyLicenseStatus === "approved";
    const establishmentApproved = !verification?.foodEstablishmentCertUrl || verification?.foodEstablishmentCertStatus === "approved";
    
    if (foodSafetyApproved && establishmentApproved) return "Verified";
    
    const anyRejected = verification?.foodSafetyLicenseStatus === "rejected" || 
                      verification?.foodEstablishmentCertStatus === "rejected";
    if (anyRejected) return "Needs Attention";
    
    return "Under Review";
  };

  const getVerificationStatus = () => {
    if (!hasDocuments) return "Pending";
    
    const foodSafetyApproved = verification?.foodSafetyLicenseStatus === "approved";
    const establishmentApproved = !verification?.foodEstablishmentCertUrl || verification?.foodEstablishmentCertStatus === "approved";
    
    if (foodSafetyApproved && establishmentApproved) return "Complete";
    if (foodSafetyApproved && verification?.foodEstablishmentCertUrl) return "Partial";
    
    return "Pending";
  };

  // File upload handlers
  const handleFileUpload = (fieldName: string, file: File | null) => {
    setFileUploads((prev) => {
      const updated = { ...prev };
      if (file) {
        updated[fieldName] = file;
      } else {
        delete updated[fieldName];
      }
      return updated;
    });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    // Check if application allows document uploads
    if (verification && (verification.status === 'cancelled' || verification.status === 'rejected')) {
      toast({
        title: "Upload not allowed",
        description: "Document uploads are not permitted for cancelled or rejected applications.",
        variant: "destructive",
      });
      return;
    }
    
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

  const isFullyVerified = hasDocuments && 
    verification?.foodSafetyLicenseStatus === "approved" &&
    (!verification?.foodEstablishmentCertUrl || verification?.foodEstablishmentCertStatus === "approved");

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

        {/* Document Status Panel - Document-specific only */}
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
                    {documentsCount} {documentsCount === 1 ? 'Uploaded' : 'Uploaded'}
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
                  <p className="font-medium text-gray-900">{getDocumentStatus()}</p>
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
                  <p className="font-medium text-gray-900">{getVerificationStatus()}</p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Priority Card: Requirements & Process with Horizontal Layout */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200/60 backdrop-blur-sm mb-8"
        >
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
              <Info className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Requirements & Process</h2>
              <p className="text-gray-500">What we need and how verification works</p>
            </div>
          </div>
          
          {/* Verification Process - Horizontal Layout */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Verification Process</h3>
            <div className="space-y-6">
              {/* Horizontal Process Flow */}
              <div className="flex items-center justify-between relative">
                <div className="flex flex-col items-center flex-1">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center mb-2">
                    <span className="text-sm font-medium text-blue-600">1</span>
                  </div>
                  <h4 className="font-medium text-gray-900 text-center">Upload</h4>
                  <p className="text-xs text-gray-600 text-center mt-1">Submit documents</p>
                </div>
                
                <div className="flex-1 h-1 bg-gradient-to-r from-blue-200 to-yellow-200 mx-2 rounded-full" />
                
                <div className="flex flex-col items-center flex-1">
                  <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center mb-2">
                    <span className="text-sm font-medium text-yellow-600">2</span>
                  </div>
                  <h4 className="font-medium text-gray-900 text-center">Review</h4>
                  <p className="text-xs text-gray-600 text-center mt-1">Admin verification</p>
                </div>
                
                <div className="flex-1 h-1 bg-gradient-to-r from-yellow-200 to-green-200 mx-2 rounded-full" />
                
                <div className="flex flex-col items-center flex-1">
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mb-2">
                    <span className="text-sm font-medium text-green-600">3</span>
                  </div>
                  <h4 className="font-medium text-gray-900 text-center">Verified</h4>
                  <p className="text-xs text-gray-600 text-center mt-1">Join community</p>
                </div>
              </div>
              
              {/* Process Details */}
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Timeline:</span> Verification typically takes 1-3 business days. 
                  You'll receive email notifications at each step and can track progress here.
                </p>
              </div>
            </div>
          </div>

          {/* Required Documents - Horizontal Cards */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-6">Required Documents</h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-6 rounded-xl border border-gray-200 bg-gradient-to-br from-red-50 to-red-100/50">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-red-600 font-medium">*</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-900 mb-3">Food Safety License</h4>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li className="flex items-center gap-2">
                        <div className="w-1 h-1 bg-gray-400 rounded-full flex-shrink-0"></div>
                        Valid, current certification
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-1 h-1 bg-gray-400 rounded-full flex-shrink-0"></div>
                        Clear, readable quality
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-1 h-1 bg-gray-400 rounded-full flex-shrink-0"></div>
                        PDF, JPG, PNG, WebP format
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-1 h-1 bg-gray-400 rounded-full flex-shrink-0"></div>
                        Maximum 4.5MB file size
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
              
              <div className="p-6 rounded-xl border border-gray-200 bg-gradient-to-br from-blue-50 to-blue-100/50">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-blue-600 font-medium">+</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-900 mb-3">Food Establishment Certificate</h4>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li className="flex items-center gap-2">
                        <div className="w-1 h-1 bg-gray-400 rounded-full flex-shrink-0"></div>
                        Optional but recommended
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-1 h-1 bg-gray-400 rounded-full flex-shrink-0"></div>
                        Enhances credibility
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-1 h-1 bg-gray-400 rounded-full flex-shrink-0"></div>
                        Shows regulatory compliance
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-1 h-1 bg-gray-400 rounded-full flex-shrink-0"></div>
                        Same format requirements
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Main Document Management Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200/60 hover:shadow-lg transition-all duration-300 backdrop-blur-sm"
        >
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center">
              <Upload className="h-6 w-6 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900">
                {hasDocuments ? 'Update Documents' : 'Upload Documents'}
              </h3>
              <p className="text-sm text-gray-500">
                {hasDocuments ? 'Replace or add new documents' : 'Submit your certificates for verification'}
              </p>
            </div>
          </div>

          {/* Current Documents Section - Always show */}
          <div className="mb-8">
            <h4 className="text-lg font-semibold text-gray-900 mb-6">Current Documents</h4>
            
            {hasDocuments ? (
              <div className="space-y-6">
                {/* Documents Grid - Horizontal Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Food Safety License */}
                  <div className="p-6 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h5 className="font-semibold text-gray-900 mb-1">Food Safety License</h5>
                        <p className="text-sm text-gray-600">Required certification</p>
                      </div>
                      {verification?.foodSafetyLicenseStatus && 
                        getStatusBadge(verification.foodSafetyLicenseStatus)}
                    </div>
                    
                    {verification?.foodSafetyLicenseUrl ? (
                      <Button asChild variant="outline" size="sm" className="rounded-lg w-full">
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
                      <div className="text-center py-4 border border-dashed border-gray-300 rounded-lg">
                        <p className="text-sm text-gray-500 italic">Not uploaded</p>
                      </div>
                    )}
                  </div>

                  {/* Food Establishment Certificate */}
                  <div className="p-6 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h5 className="font-semibold text-gray-900 mb-1">Food Establishment Certificate</h5>
                        <p className="text-sm text-gray-600">Optional (recommended)</p>
                      </div>
                      {verification?.foodEstablishmentCertStatus && 
                        getStatusBadge(verification.foodEstablishmentCertStatus)}
                    </div>
                    
                    {verification?.foodEstablishmentCertUrl ? (
                      <Button asChild variant="outline" size="sm" className="rounded-lg w-full">
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
                      <div className="text-center py-4 border border-dashed border-gray-300 rounded-lg">
                        <p className="text-sm text-gray-500 italic">Not uploaded</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Admin Feedback */}
                {verification?.documentsAdminFeedback && (
                  <Alert className="border-blue-200 bg-blue-50">
                    <Info className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-blue-800">
                      <span className="font-medium">Admin Feedback:</span> {verification.documentsAdminFeedback}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl bg-gradient-to-br from-gray-50 to-gray-100/20">
                <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-6">
                  <FileText className="h-10 w-10 text-gray-400" />
                </div>
                <h5 className="font-semibold text-gray-900 mb-3">No Documents Uploaded</h5>
                <p className="text-sm text-gray-600 max-w-md mx-auto">Upload your first document to get started with verification.</p>
              </div>
            )}
          </div>

          {/* Warning for existing users */}
          {hasDocuments && (
            <Alert className="mb-6 border-yellow-200 bg-yellow-50">
              <Info className="h-4 w-4 text-yellow-600" />
              <AlertDescription className="text-yellow-800">
                <span className="font-medium">Note:</span> Updating documents will reset your verification status to pending review.
              </AlertDescription>
            </Alert>
          )}

          {/* Document Upload Form */}
          <form onSubmit={handleSubmit} className="space-y-8">
            <Tabs defaultValue="upload" className="w-full">
              <TabsList className="grid w-full grid-cols-2 rounded-xl h-12">
                <TabsTrigger value="upload" className="rounded-lg font-medium">File Upload</TabsTrigger>
                <TabsTrigger value="url" className="rounded-lg font-medium">URL Links</TabsTrigger>
              </TabsList>
              
              <TabsContent value="upload" className="space-y-8 mt-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Food Safety License Upload */}
                  <div className="space-y-4">
                    <Label className="text-sm font-semibold text-gray-900">
                      Food Safety License <span className="text-red-500">*</span>
                    </Label>
                    <SimpleFileUpload
                      fieldName="foodSafetyLicense"
                      onFileSelect={(file) => handleFileUpload('foodSafetyLicense', file)}
                    />
                  </div>

                  {/* Food Establishment Certificate Upload */}
                  <div className="space-y-4">
                    <Label className="text-sm font-semibold text-gray-900">
                      Food Establishment Certificate <span className="text-gray-400">(Optional)</span>
                    </Label>
                    <SimpleFileUpload
                      fieldName="foodEstablishmentCert"
                      onFileSelect={(file) => handleFileUpload('foodEstablishmentCert', file)}
                    />
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="url" className="space-y-8 mt-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Food Safety License URL */}
                  <div className="space-y-4">
                    <Label htmlFor="foodSafetyUrl" className="text-sm font-semibold text-gray-900">
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
                        className="pl-10 rounded-xl h-12"
                      />
                    </div>
                  </div>

                  {/* Food Establishment Certificate URL */}
                  <div className="space-y-4">
                    <Label htmlFor="establishmentUrl" className="text-sm font-semibold text-gray-900">
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
                        className="pl-10 rounded-xl h-12"
                      />
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            {/* Submit Button */}
            <div className="pt-6 border-t border-gray-200">
              <Button 
                type="submit" 
                disabled={isUploading || createMutation.isPending || updateMutation.isPending}
                className="w-full rounded-xl bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold py-4 h-14 text-base"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-3 animate-spin" />
                    Uploading... {Math.round(uploadProgress)}%
                  </>
                ) : createMutation.isPending || updateMutation.isPending ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-3 animate-spin" />
                    {hasDocuments ? 'Updating...' : 'Submitting...'}
                  </>
                ) : (
                  <>
                    <Upload className="h-5 w-5 mr-3" />
                    {hasDocuments ? 'Update Documents' : 'Upload Documents'}
                  </>
                )}
              </Button>
            </div>
          </form>
        </motion.div>
      </main>
      <Footer />
    </div>
  );
} 