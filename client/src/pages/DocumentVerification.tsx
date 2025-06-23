import DocumentUpload from "@/components/document-verification/DocumentUpload";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useDocumentVerification } from "@/hooks/use-document-verification";
import { motion } from "framer-motion";
import {
    CheckCircle,
    Clock,
    FileText,
    Shield,
    XCircle
} from "lucide-react";
import { Link } from "wouter";

export default function DocumentVerification() {
  const { user } = useFirebaseAuth();
  const { verification, loading } = useDocumentVerification();

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

  // Check if user is fully verified
  const isFullyVerified = verification && verification.foodSafetyLicenseStatus === "approved" && 
    (!verification.foodEstablishmentCertUrl || verification.foodEstablishmentCertStatus === "approved");

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

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-blue-50">
      <Header />
      <main className="flex-grow container max-w-6xl mx-auto px-4 pt-28 pb-8">
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <FileText className="h-4 w-4 text-blue-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-600">Documents</p>
                  <p className="font-medium text-gray-900">
                    {verification ? 
                      (verification.foodSafetyLicenseUrl ? 1 : 0) + (verification.foodEstablishmentCertUrl ? 1 : 0) : 0
                    } Uploaded
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

        {/* Combined Verification Process and Document Upload Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200/60 hover:shadow-lg transition-all duration-300 mb-8 backdrop-blur-sm"
        >
          {/* Verification Process Steps */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Verification Process & Document Upload</h3>
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

          {/* Document Upload Section */}
          <div className="pt-6 border-t border-gray-200">
            <DocumentUpload forceShowForm={true} />
          </div>
        </motion.div>
      </main>
      <Footer />
    </div>
  );
} 