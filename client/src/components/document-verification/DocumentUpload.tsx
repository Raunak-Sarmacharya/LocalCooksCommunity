import { useState } from "react";
import { useDocumentVerification } from "@/hooks/use-document-verification";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Upload, 
  FileText, 
  CheckCircle, 
  Clock, 
  XCircle, 
  AlertTriangle,
  Loader2,
  Info,
  Award,
  Link as LinkIcon,
  ImageIcon
} from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "wouter";

export default function DocumentUpload() {
  const { verification, isLoading, createMutation, updateMutation, refetch } = useDocumentVerification();
  
  // File states
  const [foodSafetyFile, setFoodSafetyFile] = useState<File | null>(null);
  const [foodEstablishmentFile, setFoodEstablishmentFile] = useState<File | null>(null);
  
  // URL states (alternative to file upload)
  const [foodSafetyLicenseUrl, setFoodSafetyLicenseUrl] = useState("");
  const [foodEstablishmentCertUrl, setFoodEstablishmentCertUrl] = useState("");
  
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  // Detect if we're in production environment (deployed app)
  const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
  
  // Default to URL mode in production, file mode in development
  const [uploadMethod, setUploadMethod] = useState<'file' | 'url'>(isProduction ? 'url' : 'file');

  const validateUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const validateFileSize = (file: File): boolean => {
    const maxSize = 10 * 1024 * 1024; // 10MB
    return file.size <= maxSize;
  };

  const validateFileType = (file: File): boolean => {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp'
    ];
    return allowedTypes.includes(file.type);
  };

  const handleFileChange = (type: 'foodSafety' | 'foodEstablishment', file: File | null) => {
    if (!file) {
      if (type === 'foodSafety') {
        setFoodSafetyFile(null);
      } else {
        setFoodEstablishmentFile(null);
      }
      return;
    }

    // Validate file
    const newErrors: Record<string, string> = { ...errors };
    
    if (!validateFileType(file)) {
      newErrors[type] = "Invalid file type. Only PDF, JPG, JPEG, PNG, and WebP files are allowed.";
      setErrors(newErrors);
      return;
    }

    if (!validateFileSize(file)) {
      newErrors[type] = "File size must be less than 10MB.";
      setErrors(newErrors);
      return;
    }

    // Clear errors and set file
    delete newErrors[type];
    setErrors(newErrors);
    
    if (type === 'foodSafety') {
      setFoodSafetyFile(file);
    } else {
      setFoodEstablishmentFile(file);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const newErrors: Record<string, string> = {};
    
    // Prevent file uploads in production
    if (isProduction && uploadMethod === 'file') {
      newErrors.production = "File uploads are not supported in production. Please use the URL tab to provide document links.";
      setErrors(newErrors);
      return;
    }
    
    if (uploadMethod === 'file') {
      // Validate files
      if (!foodSafetyFile && !verification?.foodSafetyLicenseUrl) {
        newErrors.foodSafety = "Food Safety License file is required";
      }
    } else {
      // Validate URLs
      if (!foodSafetyLicenseUrl.trim() && !verification?.foodSafetyLicenseUrl) {
        newErrors.foodSafetyUrl = "Food Safety License URL is required";
      } else if (foodSafetyLicenseUrl.trim() && !validateUrl(foodSafetyLicenseUrl)) {
        newErrors.foodSafetyUrl = "Please enter a valid URL";
      }

      if (foodEstablishmentCertUrl.trim() && !validateUrl(foodEstablishmentCertUrl)) {
        newErrors.foodEstablishmentUrl = "Please enter a valid URL";
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});

    if (uploadMethod === 'file' && !isProduction) {
      // Prepare form data for file uploads (development only)
      const formData = new FormData();
      if (foodSafetyFile) {
        formData.append('foodSafetyLicense', foodSafetyFile);
      }
      if (foodEstablishmentFile) {
        formData.append('foodEstablishmentCert', foodEstablishmentFile);
      }

      if (verification) {
        // Update existing verification
        updateMutation.mutate(formData as any);
      } else {
        // Create new verification
        createMutation.mutate(formData as any);
      }
    } else {
      // Prepare JSON data for URL submissions
      const urlData = {
        ...(foodSafetyLicenseUrl.trim() && { foodSafetyLicenseUrl: foodSafetyLicenseUrl.trim() }),
        ...(foodEstablishmentCertUrl.trim() && { foodEstablishmentCertUrl: foodEstablishmentCertUrl.trim() })
      };

      if (verification) {
        // Update existing verification with URLs
        updateMutation.mutate(urlData as any);
      } else {
        // Create new verification with URLs
        createMutation.mutate(urlData as any);
      }
    }
  };

  const getStatusBadge = (status: string) => {
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

  const getFileDisplayName = (url: string | null) => {
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

  // Show fully verified view
  if (isFullyVerified) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
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
              
              <Button 
                variant="outline" 
                onClick={() => refetch()}
                disabled={isLoading}
                className="flex-1"
              >
                <Clock className="h-4 w-4 mr-2" />
                Refresh Status
              </Button>
            </div>

            {/* Optional: Allow updating documents even when verified */}
            <details className="mt-6">
              <summary className="text-sm text-gray-600 cursor-pointer hover:text-gray-800">
                Need to update your documents? Click here
              </summary>
              <div className="mt-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800 mb-3">
                  <strong>Note:</strong> Uploading new documents will reset your verification status to "pending review".
                </p>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => window.location.reload()}
                  className="text-yellow-700 border-yellow-300 hover:bg-yellow-100"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Update My Documents
                </Button>
              </div>
            </details>
          </CardContent>
        </Card>
      </motion.div>
    );
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
            Upload your required documents for verification. You can either upload files directly 
            or provide URLs to your documents stored elsewhere.
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {verification && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <strong>Update your documents:</strong> You can upload new files to replace your current documents. 
                The status will reset to "Pending Review" when you upload new files.
              </AlertDescription>
            </Alert>
          )}

          <Tabs value={uploadMethod} onValueChange={(value) => setUploadMethod(value as 'file' | 'url')} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="file" className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                {verification ? "Replace Files" : "Upload Files"}
              </TabsTrigger>
              <TabsTrigger value="url" className="flex items-center gap-2">
                <LinkIcon className="h-4 w-4" />
                {verification ? "Update URLs" : "Provide URLs"}
              </TabsTrigger>
            </TabsList>

            {/* Production warning for file uploads */}
            {isProduction && uploadMethod === 'file' && (
              <Alert className="mt-4 border-amber-200 bg-amber-50">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800">
                  <strong>File uploads are not available in production.</strong> Please use the "Provide URLs" tab to submit links to your documents stored on cloud services (Google Drive, Dropbox, etc.). Make sure your document links are publicly accessible.
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-6 mt-6">
              <TabsContent value="file" className="space-y-6 mt-0">
                {/* Food Safety License File Upload */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="foodSafetyFile" className="text-sm font-medium">
                      Food Safety License * {verification && "(Replace current document)"}
                    </Label>
                    {verification?.foodSafetyLicenseStatus && getStatusBadge(verification.foodSafetyLicenseStatus)}
                  </div>
                  
                  {/* Show current document if exists */}
                  {verification?.foodSafetyLicenseUrl && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                      <p className="text-sm font-medium text-blue-800 mb-1">Current Document:</p>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-blue-600" />
                        <a 
                          href={verification.foodSafetyLicenseUrl} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="text-blue-600 hover:underline text-sm"
                        >
                          {getFileDisplayName(verification.foodSafetyLicenseUrl)}
                        </a>
                      </div>
                      <p className="text-xs text-blue-600 mt-1">
                        Upload a new file below to replace this document
                      </p>
                    </div>
                  )}
                  
                  <Input
                    id="foodSafetyFile"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    onChange={(e) => handleFileChange('foodSafety', e.target.files?.[0] || null)}
                    className={errors.foodSafety ? "border-red-500" : ""}
                  />
                  {errors.foodSafety && (
                    <p className="text-sm text-red-500 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {errors.foodSafety}
                    </p>
                  )}
                  {foodSafetyFile && (
                    <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-2 flex items-center gap-2">
                      <ImageIcon className="h-4 w-4" />
                      New file selected: {foodSafetyFile.name} ({(foodSafetyFile.size / 1024 / 1024).toFixed(2)} MB)
                    </div>
                  )}
                  <p className="text-xs text-gray-500">
                    Upload PDF, JPG, PNG, or WebP file (max 10MB). This document is required for verification.
                  </p>
                </div>

                {/* Food Establishment Certificate File Upload */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="foodEstablishmentFile" className="text-sm font-medium">
                      Food Establishment Certificate (Optional) {verification && verification.foodEstablishmentCertUrl && "(Replace current document)"}
                    </Label>
                    {verification?.foodEstablishmentCertStatus && getStatusBadge(verification.foodEstablishmentCertStatus)}
                  </div>
                  
                  {/* Show current document if exists */}
                  {verification?.foodEstablishmentCertUrl && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                      <p className="text-sm font-medium text-blue-800 mb-1">Current Document:</p>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-blue-600" />
                        <a 
                          href={verification.foodEstablishmentCertUrl} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="text-blue-600 hover:underline text-sm"
                        >
                          {getFileDisplayName(verification.foodEstablishmentCertUrl)}
                        </a>
                      </div>
                      <p className="text-xs text-blue-600 mt-1">
                        Upload a new file below to replace this document
                      </p>
                    </div>
                  )}
                  
                  <Input
                    id="foodEstablishmentFile"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    onChange={(e) => handleFileChange('foodEstablishment', e.target.files?.[0] || null)}
                    className={errors.foodEstablishment ? "border-red-500" : ""}
                  />
                  {errors.foodEstablishment && (
                    <p className="text-sm text-red-500 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {errors.foodEstablishment}
                    </p>
                  )}
                  {foodEstablishmentFile && (
                    <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-2 flex items-center gap-2">
                      <ImageIcon className="h-4 w-4" />
                      New file selected: {foodEstablishmentFile.name} ({(foodEstablishmentFile.size / 1024 / 1024).toFixed(2)} MB)
                    </div>
                  )}
                  <p className="text-xs text-gray-500">
                    Upload PDF, JPG, PNG, or WebP file (max 10MB). This document is optional but recommended.
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
                        className="text-blue-600 hover:underline text-sm break-all"
                      >
                        {verification.foodSafetyLicenseUrl}
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
                        className="text-blue-600 hover:underline text-sm break-all"
                      >
                        {verification.foodEstablishmentCertUrl}
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

              {/* Production error */}
              {errors.production && (
                <Alert className="border-red-200 bg-red-50">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-800">
                    {errors.production}
                  </AlertDescription>
                </Alert>
              )}

              {/* Submit Button */}
              <Button 
                type="submit" 
                className="w-full"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {verification ? "Updating..." : "Uploading..."}
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    {verification ? "Update Documents" : "Upload Documents"}
                  </>
                )}
              </Button>
            </form>
          </Tabs>

          {/* Status Summary */}
          {verification && (
            <div className="pt-4 border-t">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium">Verification Status</h4>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => refetch()}
                  disabled={isLoading}
                  className="text-xs"
                >
                  <Clock className="h-3 w-3 mr-1" />
                  Refresh Status
                </Button>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Food Safety License:</span>
                  {getStatusBadge(verification.foodSafetyLicenseStatus || "pending")}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Food Establishment Certificate:</span>
                  {verification.foodEstablishmentCertUrl 
                    ? getStatusBadge(verification.foodEstablishmentCertStatus || "pending")
                    : <span className="text-xs text-gray-500">Not provided</span>
                  }
                </div>
                {verification.documentsReviewedAt && (
                  <p className="text-xs text-gray-500 mt-2">
                    Last reviewed: {new Date(verification.documentsReviewedAt).toLocaleDateString()}
                  </p>
                )}
                
                {/* Show update instructions based on status */}
                {(verification.foodSafetyLicenseStatus === "rejected" || verification.foodEstablishmentCertStatus === "rejected") && (
                  <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <p className="text-sm font-medium text-amber-800">Action Required</p>
                    </div>
                    <p className="text-xs text-amber-700 mt-1">
                      Some documents were rejected. Please upload corrected documents above to resubmit for review.
                    </p>
                  </div>
                )}
                
                {(verification.foodSafetyLicenseStatus === "pending" || verification.foodEstablishmentCertStatus === "pending") && (
                  <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-blue-600" />
                      <p className="text-sm font-medium text-blue-800">Under Review</p>
                    </div>
                    <p className="text-xs text-blue-700 mt-1">
                      Your documents are being reviewed. You can still upload new documents if needed - they will replace the current ones.
                    </p>
                  </div>
                )}
                
                {verification.foodSafetyLicenseStatus === "approved" && 
                 (!verification.foodEstablishmentCertUrl || verification.foodEstablishmentCertStatus === "approved") && (
                  <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <p className="text-sm font-medium text-green-800">Verification Complete</p>
                    </div>
                    <p className="text-xs text-green-700 mt-1">
                      Your documents have been approved! You can still update them if needed.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
} 