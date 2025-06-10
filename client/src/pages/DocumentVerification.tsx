import DocumentUpload from "@/components/document-verification/DocumentUpload";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { motion } from "framer-motion";
import {
    ArrowLeft,
    CheckCircle,
    Clock,
    FileText,
    Info,
    Shield,
    XCircle
} from "lucide-react";
import { Link } from "wouter";
import { DocumentManagementModal } from "@/components/document-verification/DocumentUpload";
import { useState } from "react";
import { useDocumentVerification } from "@/hooks/use-document-verification";

export default function DocumentVerification() {
  const { user } = useAuth();
  const { verification, isLoading } = useDocumentVerification();
  const [modalOpen, setModalOpen] = useState(false);

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-grow container max-w-4xl mx-auto px-4 pt-28 pb-8">
          <div className="text-center py-12">
            <Shield className="h-16 w-16 mx-auto text-primary/50 mb-4" />
            <h1 className="text-2xl font-bold mb-4">Authentication Required</h1>
            <p className="text-gray-600 mb-6">
              You need to be logged in to access document verification.
            </p>
            <Button asChild>
              <Link href="/login">Login</Link>
            </Button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Admins should not access document verification as applicants
  if (user.role === "admin") {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-grow container max-w-4xl mx-auto px-4 pt-28 pb-8">
          <motion.div
            className="text-center py-12"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Shield className="h-16 w-16 mx-auto text-primary/50 mb-4" />
            <h1 className="text-2xl font-bold mb-4">Admin Access</h1>
            <p className="text-gray-600 mb-6">
              Administrators cannot upload documents as applicants. Use the admin dashboard to manage document verification for users.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild>
                <Link href="/admin">Go to Admin Dashboard</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/">Return to Home</Link>
              </Button>
            </div>
          </motion.div>
        </main>
        <Footer />
      </div>
    );
  }

  // If loading, show loader
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-grow container max-w-4xl mx-auto px-4 pt-28 pb-8">
          <div className="flex justify-center py-12">
            <span className="text-lg text-primary">Loading...</span>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // If user has a verification record, always show document summary and manage button
  if (verification) {
    const isFullyVerified = verification.foodSafetyLicenseStatus === "approved" &&
      (!verification.foodEstablishmentCertUrl || verification.foodEstablishmentCertStatus === "approved");
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-grow container max-w-4xl mx-auto px-4 pt-28 pb-8">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mb-10">
            <div className="flex flex-col items-center">
              <div className="flex items-center w-full max-w-2xl mx-auto justify-between relative mb-6">
                <div className="flex flex-col items-center flex-1">
                  <div className="bg-blue-100 text-blue-600 rounded-full w-12 h-12 flex items-center justify-center mb-2 shadow">
                    <FileText className="h-7 w-7" />
                  </div>
                  <span className="font-semibold text-blue-700">1. Upload</span>
                </div>
                <div className="flex-1 h-1 bg-gradient-to-r from-blue-200 via-yellow-200 to-green-200 mx-2 rounded-full" />
                <div className="flex flex-col items-center flex-1">
                  <div className="bg-yellow-100 text-yellow-600 rounded-full w-12 h-12 flex items-center justify-center mb-2 shadow">
                    <Shield className="h-7 w-7" />
                  </div>
                  <span className="font-semibold text-yellow-700">2. Review</span>
                </div>
                <div className="flex-1 h-1 bg-gradient-to-r from-yellow-200 to-green-200 mx-2 rounded-full" />
                <div className="flex flex-col items-center flex-1">
                  <div className="bg-green-100 text-green-600 rounded-full w-12 h-12 flex items-center justify-center mb-2 shadow">
                    <CheckCircle className="h-7 w-7" />
                  </div>
                  <span className="font-semibold text-green-700">3. Verified</span>
                </div>
              </div>
              <div className="w-full max-w-2xl mx-auto">
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded flex items-center gap-2">
                  <Info className="h-5 w-5 text-yellow-600" />
                  <span className="text-yellow-800 text-sm font-medium">Updating your documents will reset your verification status to <b>pending review</b>.</span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Document Summary Card */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
            <div className="w-full max-w-2xl mx-auto mb-8">
              <div className="bg-white border rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  Your Documents
                </h2>
                <div className="mb-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Food Safety License:</span>
                    {verification.foodSafetyLicenseUrl ? (
                      <a href={verification.foodSafetyLicenseUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-100 text-blue-700 rounded shadow hover:bg-blue-200 transition font-medium">
                        <FileText className="h-4 w-4" /> View Document
                      </a>
                    ) : (
                      <span className="text-gray-400">Not uploaded</span>
                    )}
                    {verification.foodSafetyLicenseStatus && (
                      <span className={`ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${verification.foodSafetyLicenseStatus === "approved" ? "bg-green-100 text-green-800" : verification.foodSafetyLicenseStatus === "pending" ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"}`}>
                        {verification.foodSafetyLicenseStatus === "approved" && <CheckCircle className="h-3 w-3" />}
                        {verification.foodSafetyLicenseStatus === "pending" && <Clock className="h-3 w-3" />}
                        {verification.foodSafetyLicenseStatus === "rejected" && <XCircle className="h-3 w-3" />}
                        {verification.foodSafetyLicenseStatus.charAt(0).toUpperCase() + verification.foodSafetyLicenseStatus.slice(1)}
                      </span>
                    )}
                  </div>
                  {verification.foodEstablishmentCertUrl && (
                    <div className="flex items-center gap-2 mt-2">
                      <span className="font-medium">Food Establishment Certificate:</span>
                      <a href={verification.foodEstablishmentCertUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                        View
                      </a>
                      {verification.foodEstablishmentCertStatus && (
                        <span className="ml-2">{verification.foodEstablishmentCertStatus === "approved" ? "✅ Approved" : verification.foodEstablishmentCertStatus === "pending" ? "🕒 Pending" : "❌ Rejected"}</span>
                      )}
                    </div>
                  )}
                </div>
                {verification.documentsAdminFeedback && (
                  <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4 flex items-center gap-2">
                    <Info className="h-5 w-5 text-blue-700" />
                    <span className="font-medium text-blue-800">Admin Feedback:</span> <span className="text-blue-700">{verification.documentsAdminFeedback}</span>
                  </div>
                )}
                <button className="mt-2 px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 transition" onClick={() => setModalOpen(true)}>
                  Manage Documents
                </button>
                <div className="mt-4 text-blue-800 text-sm">
                  <strong>Update Documents:</strong> You can update your verified documents anytime. New uploads will reset your verification status to "pending review" for security.
                </div>
              </div>
            </div>
          </motion.div>

          {/* Modal for managing documents */}
          <DocumentManagementModal open={modalOpen} onOpenChange={setModalOpen} />

          {/* Additional Information */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.5 }} className="mt-8 max-w-2xl mx-auto">
            <div className="bg-gray-50 rounded-lg p-6 border">
              <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <Info className="h-5 w-5 text-primary" />
                Document Requirements
              </h3>
              <div className="space-y-3 text-sm text-gray-600">
                <div>
                  <strong>Food Safety License (Required):</strong>
                  <ul className="list-disc list-inside mt-1 ml-4 space-y-1">
                    <li>Must be a valid, current food safety certification</li>
                    <li>Provide a direct URL link to the document (PDF, image, etc.)</li>
                    <li>Document should be clearly readable and authentic</li>
                  </ul>
                </div>
              </div>
            </div>
          </motion.div>
        </main>
        <Footer />
      </div>
    );
  }

  // If no verification/application, show onboarding/instructions
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-grow container max-w-4xl mx-auto px-4 pt-28 pb-8">
        {/* Header Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <div className="flex items-center gap-4 mb-6">
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Link>
            </Button>
          </div>

          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-4 bg-primary/10 rounded-full flex items-center justify-center">
              <FileText className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">
              Document Verification
            </h1>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Upload or update your required documents for verification. You can replace your documents anytime - 
              whether you're submitting for the first time or updating after admin feedback.
            </p>
          </div>

          {/* Information Alert */}
          <Alert className="mb-8 max-w-3xl mx-auto">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <strong>Important:</strong> Only approved applicants can upload documents for verification. 
              If your application is still under review, please wait for approval before proceeding.
            </AlertDescription>
          </Alert>

          {/* Process Steps */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto mb-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-center"
            >
              <div className="w-12 h-12 mx-auto mb-3 bg-blue-100 rounded-full flex items-center justify-center">
                <FileText className="h-6 w-6 text-blue-600" />
              </div>
              <h3 className="font-semibold text-gray-800 mb-2">1. Upload Documents</h3>
              <p className="text-sm text-gray-600">
                Provide URLs to your Food Safety License and optional Food Establishment Certificate
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-center"
            >
              <div className="w-12 h-12 mx-auto mb-3 bg-yellow-100 rounded-full flex items-center justify-center">
                <Shield className="h-6 w-6 text-yellow-600" />
              </div>
              <h3 className="font-semibold text-gray-800 mb-2">2. Admin Review</h3>
              <p className="text-sm text-gray-600">
                Our admin team will review your documents for authenticity and compliance
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="text-center"
            >
              <div className="w-12 h-12 mx-auto mb-3 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
              <h3 className="font-semibold text-gray-800 mb-2">3. Get Verified</h3>
              <p className="text-sm text-gray-600">
                Receive your verified badge and join the trusted Local Cooks community
              </p>
            </motion.div>
          </div>
        </motion.div>

        {/* Document Upload Modal Trigger */}
        <DocumentManagementModal />

        {/* Additional Information */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-8 max-w-2xl mx-auto"
        >
          <div className="bg-gray-50 rounded-lg p-6 border">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              Document Requirements
            </h3>
            <div className="space-y-3 text-sm text-gray-600">
              <div>
                <strong>Food Safety License (Required):</strong>
                <ul className="list-disc list-inside mt-1 ml-4 space-y-1">
                  <li>Must be a valid, current food safety certification</li>
                  <li>Provide a direct URL link to the document (PDF, image, etc.)</li>
                  <li>Document should be clearly readable and authentic</li>
                </ul>
              </div>
              <div>
                <strong>Food Establishment Certificate (Optional):</strong>
                <ul className="list-disc list-inside mt-1 ml-4 space-y-1">
                  <li>Enhances your credibility as a professional cook</li>
                  <li>Shows compliance with local health regulations</li>
                  <li>Recommended but not mandatory for verification</li>
                </ul>
              </div>
            </div>
          </div>
        </motion.div>
      </main>
      <Footer />
    </div>
  );
} 