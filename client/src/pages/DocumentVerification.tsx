import DocumentUpload from "@/components/document-verification/DocumentUpload";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useDocumentVerification } from "@/hooks/use-document-verification";
import { auth } from "@/lib/firebase";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  CheckCircle,
  ChefHat,
  Clock,
  FileText,
  Shield,
  Truck,
  XCircle
} from "lucide-react";
import { Link } from "wouter";

export default function DocumentVerification() {
  const { user } = useFirebaseAuth();
  const { verification, loading } = useDocumentVerification();
  
  // Fetch delivery partner applications for delivery partners
  const { data: deliveryApplications = [], isLoading: isLoadingDelivery } = useQuery({
    queryKey: ["/api/firebase/delivery-partner-applications/my"],
    queryFn: async () => {
      if (!user?.uid) {
        throw new Error("User not authenticated");
      }
      
      // Only fetch delivery partner applications if user is a delivery partner
      if (!(user as any)?.isDeliveryPartner) {
        return [];
      }

      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        throw new Error("Firebase user not available");
      }

      const token = await firebaseUser.getIdToken();
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      };

      const response = await fetch("/api/firebase/delivery-partner-applications/my", {
        credentials: 'include',
        headers
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Account sync required. Please click 'Sync Account' below to connect your Firebase account to our database.");
        }
        
        try {
          const errorData = await response.json();
          throw new Error(errorData.error || response.statusText);
        } catch (parseError) {
          throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }
      }

      const rawData = await response.json();
      
      // Normalize delivery partner application data
      const normalizedData = rawData.map((app: any) => ({
        id: app.id,
        userId: app.user_id || app.userId,
        fullName: app.full_name || app.fullName,
        email: app.email,
        phone: app.phone,
        address: app.address,
        city: app.city,
        province: app.province,
        postalCode: app.postal_code || app.postalCode,
        vehicleType: app.vehicle_type || app.vehicleType,
        vehicleMake: app.vehicle_make || app.vehicleMake,
        vehicleModel: app.vehicle_model || app.vehicleModel,
        vehicleYear: app.vehicle_year || app.vehicleYear,
        licensePlate: app.license_plate || app.licensePlate,
        driversLicenseUrl: app.drivers_license_url || app.driversLicenseUrl,
        vehicleRegistrationUrl: app.vehicle_registration_url || app.vehicleRegistrationUrl,
        insuranceUrl: app.insurance_url || app.insuranceUrl,
        backgroundCheckUrl: app.background_check_url || app.backgroundCheckUrl,
        driversLicenseStatus: app.drivers_license_status || app.driversLicenseStatus,
        vehicleRegistrationStatus: app.vehicle_registration_status || app.vehicleRegistrationStatus,
        insuranceStatus: app.insurance_status || app.insuranceStatus,
        backgroundCheckStatus: app.background_check_status || app.backgroundCheckStatus,
        documentsAdminFeedback: app.documents_admin_feedback || app.documentsAdminFeedback,
        documentsReviewedBy: app.documents_reviewed_by || app.documentsReviewedBy,
        documentsReviewedAt: app.documents_reviewed_at || app.documentsReviewedAt,
        feedback: app.feedback,
        status: app.status,
        createdAt: app.created_at || app.createdAt,
      }));

      return normalizedData;
    },
    enabled: !!user && !!(user as any)?.isDeliveryPartner,
    refetchInterval: 20000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchOnReconnect: true,
    staleTime: 0,
    gcTime: 10000,
  });

  // Get the most recent delivery partner application
  const latestDeliveryApp = deliveryApplications.length > 0 ? deliveryApplications[0] : null;
  
  // Determine if user is a chef or delivery partner
  const isChef = (user as any)?.isChef;
  const isDeliveryPartner = (user as any)?.isDeliveryPartner;
  
  // Use appropriate data based on user type
  const isChefUser = isChef && !isDeliveryPartner;
  const isDeliveryPartnerUser = isDeliveryPartner && !isChef;
  const isDualRole = isChef && isDeliveryPartner;
  
  // For dual role users, prioritize chef documents if they exist, otherwise show delivery partner
  const shouldShowChefDocuments = isChefUser || (isDualRole && verification);
  const shouldShowDeliveryDocuments = isDeliveryPartnerUser || (isDualRole && !verification && latestDeliveryApp);

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
  if (loading || (isDeliveryPartner && isLoadingDelivery)) {
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
  const hasChefDocuments = verification && (verification.foodSafetyLicenseUrl || verification.foodEstablishmentCertUrl);
  const hasDeliveryDocuments = latestDeliveryApp && (latestDeliveryApp.driversLicenseUrl || latestDeliveryApp.vehicleRegistrationUrl || latestDeliveryApp.insuranceUrl || latestDeliveryApp.backgroundCheckUrl);
  
  const hasDocuments = shouldShowChefDocuments ? hasChefDocuments : hasDeliveryDocuments;

  // Check if user is fully verified
  const isChefFullyVerified = verification && verification.foodSafetyLicenseStatus === "approved" && 
    (!verification.foodEstablishmentCertUrl || verification.foodEstablishmentCertStatus === "approved");
  
  const isDeliveryFullyVerified = latestDeliveryApp && 
    latestDeliveryApp.driversLicenseStatus === "approved" && 
    latestDeliveryApp.vehicleRegistrationStatus === "approved" && 
    latestDeliveryApp.insuranceStatus === "approved" && 
    latestDeliveryApp.backgroundCheckStatus === "approved";
  
  const isFullyVerified = shouldShowChefDocuments ? isChefFullyVerified : isDeliveryFullyVerified;

  // Document-specific status (not application status)
  const getDocumentStatus = () => {
    if (shouldShowChefDocuments) {
      if (!hasChefDocuments) return "Not Started";
      
      const foodSafetyApproved = verification?.foodSafetyLicenseStatus === "approved";
      const establishmentApproved = !verification?.foodEstablishmentCertUrl || verification?.foodEstablishmentCertStatus === "approved";
      
      if (foodSafetyApproved && establishmentApproved) return "Verified";
      
      const anyRejected = verification?.foodSafetyLicenseStatus === "rejected" || 
                        verification?.foodEstablishmentCertStatus === "rejected";
      if (anyRejected) return "Needs Attention";
      
      return "Under Review";
    } else {
      if (!hasDeliveryDocuments) return "Not Started";
      
      const allApproved = latestDeliveryApp?.driversLicenseStatus === "approved" && 
                         latestDeliveryApp?.vehicleRegistrationStatus === "approved" && 
                         latestDeliveryApp?.insuranceStatus === "approved" && 
                         latestDeliveryApp?.backgroundCheckStatus === "approved";
      
      if (allApproved) return "Verified";
      
      const anyRejected = latestDeliveryApp?.driversLicenseStatus === "rejected" || 
                         latestDeliveryApp?.vehicleRegistrationStatus === "rejected" || 
                         latestDeliveryApp?.insuranceStatus === "rejected" || 
                         latestDeliveryApp?.backgroundCheckStatus === "rejected";
      if (anyRejected) return "Needs Attention";
      
      return "Under Review";
    }
  };

  const getVerificationStatus = () => {
    if (shouldShowChefDocuments) {
      if (!hasChefDocuments) return "Pending";
      
      const foodSafetyApproved = verification?.foodSafetyLicenseStatus === "approved";
      const establishmentApproved = !verification?.foodEstablishmentCertUrl || verification?.foodEstablishmentCertStatus === "approved";
      
      if (foodSafetyApproved && establishmentApproved) return "Complete";
      if (foodSafetyApproved && verification?.foodEstablishmentCertUrl) return "Partial";
      
      return "Pending";
    } else {
      if (!hasDeliveryDocuments) return "Pending";
      
      const allApproved = latestDeliveryApp?.driversLicenseStatus === "approved" && 
                         latestDeliveryApp?.vehicleRegistrationStatus === "approved" && 
                         latestDeliveryApp?.insuranceStatus === "approved" && 
                         latestDeliveryApp?.backgroundCheckStatus === "approved";
      
      if (allApproved) return "Complete";
      
      const anyApproved = latestDeliveryApp?.driversLicenseStatus === "approved" || 
                         latestDeliveryApp?.vehicleRegistrationStatus === "approved" || 
                         latestDeliveryApp?.insuranceStatus === "approved" || 
                         latestDeliveryApp?.backgroundCheckStatus === "approved";
      if (anyApproved) return "Partial";
      
      return "Pending";
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
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
              shouldShowChefDocuments 
                ? 'bg-gradient-to-br from-orange-500 to-red-600' 
                : 'bg-gradient-to-br from-blue-500 to-indigo-600'
            }`}>
              {shouldShowChefDocuments ? (
                <ChefHat className="h-6 w-6 text-white" />
              ) : (
                <Truck className="h-6 w-6 text-white" />
              )}
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-semibold text-gray-900">
                {shouldShowChefDocuments ? 'Chef Document Verification' : 'Delivery Partner Documents'}
              </h1>
              <p className="text-gray-500">
                {shouldShowChefDocuments 
                  ? 'Upload and manage your chef certificates' 
                  : 'Upload and manage your delivery documents'
                }
              </p>
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
                    {shouldShowChefDocuments ? 
                      (verification ? 
                        (verification.foodSafetyLicenseUrl ? 1 : 0) + (verification.foodEstablishmentCertUrl ? 1 : 0) : 0
                      ) : 
                      (latestDeliveryApp ? 
                        (latestDeliveryApp.driversLicenseUrl ? 1 : 0) + 
                        (latestDeliveryApp.vehicleRegistrationUrl ? 1 : 0) + 
                        (latestDeliveryApp.insuranceUrl ? 1 : 0) + 
                        (latestDeliveryApp.backgroundCheckUrl ? 1 : 0) : 0
                      )
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
            {shouldShowChefDocuments ? (
              <DocumentUpload forceShowForm={true} />
            ) : (
              <div className="space-y-6">
                <div className="text-center">
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">Delivery Partner Documents</h3>
                  <p className="text-gray-600">Upload your required delivery partner documents</p>
                </div>
                
                {latestDeliveryApp ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Driver's License */}
                    <div className="p-4 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-gray-900">Driver's License</h4>
                        {latestDeliveryApp.driversLicenseStatus && (
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                            latestDeliveryApp.driversLicenseStatus === 'approved' ? 'bg-green-100 text-green-800' :
                            latestDeliveryApp.driversLicenseStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {latestDeliveryApp.driversLicenseStatus.charAt(0).toUpperCase() + latestDeliveryApp.driversLicenseStatus.slice(1)}
                          </span>
                        )}
                      </div>
                      <div className="space-y-2">
                        {latestDeliveryApp.driversLicenseUrl ? (
                          <a href={latestDeliveryApp.driversLicenseUrl} target="_blank" rel="noopener noreferrer" 
                             className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium">
                            <FileText className="h-4 w-4" />
                            View Document
                          </a>
                        ) : (
                          <div className="flex items-center gap-2 text-gray-500 text-sm">
                            <FileText className="h-4 w-4" />
                            Not uploaded
                          </div>
                        )}
                        <p className="text-xs text-gray-600">Required for delivery operations</p>
                      </div>
                    </div>
                    
                    {/* Vehicle Registration */}
                    <div className="p-4 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-gray-900">Vehicle Registration</h4>
                        {latestDeliveryApp.vehicleRegistrationStatus && (
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                            latestDeliveryApp.vehicleRegistrationStatus === 'approved' ? 'bg-green-100 text-green-800' :
                            latestDeliveryApp.vehicleRegistrationStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {latestDeliveryApp.vehicleRegistrationStatus.charAt(0).toUpperCase() + latestDeliveryApp.vehicleRegistrationStatus.slice(1)}
                          </span>
                        )}
                      </div>
                      <div className="space-y-2">
                        {latestDeliveryApp.vehicleRegistrationUrl ? (
                          <a href={latestDeliveryApp.vehicleRegistrationUrl} target="_blank" rel="noopener noreferrer" 
                             className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium">
                            <FileText className="h-4 w-4" />
                            View Document
                          </a>
                        ) : (
                          <div className="flex items-center gap-2 text-gray-500 text-sm">
                            <FileText className="h-4 w-4" />
                            Not uploaded
                          </div>
                        )}
                        <p className="text-xs text-gray-600">Required for delivery operations</p>
                      </div>
                    </div>
                    
                    {/* Vehicle Insurance */}
                    <div className="p-4 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-gray-900">Vehicle Insurance</h4>
                        {latestDeliveryApp.insuranceStatus && (
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                            latestDeliveryApp.insuranceStatus === 'approved' ? 'bg-green-100 text-green-800' :
                            latestDeliveryApp.insuranceStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {latestDeliveryApp.insuranceStatus.charAt(0).toUpperCase() + latestDeliveryApp.insuranceStatus.slice(1)}
                          </span>
                        )}
                      </div>
                      <div className="space-y-2">
                        {latestDeliveryApp.insuranceUrl ? (
                          <a href={latestDeliveryApp.insuranceUrl} target="_blank" rel="noopener noreferrer" 
                             className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium">
                            <FileText className="h-4 w-4" />
                            View Document
                          </a>
                        ) : (
                          <div className="flex items-center gap-2 text-gray-500 text-sm">
                            <FileText className="h-4 w-4" />
                            Not uploaded
                          </div>
                        )}
                        <p className="text-xs text-gray-600">Required for delivery operations</p>
                      </div>
                    </div>
                    
                    {/* Background Check */}
                    <div className="p-4 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-gray-900">Background Check</h4>
                        {latestDeliveryApp.backgroundCheckStatus && (
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                            latestDeliveryApp.backgroundCheckStatus === 'approved' ? 'bg-green-100 text-green-800' :
                            latestDeliveryApp.backgroundCheckStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {latestDeliveryApp.backgroundCheckStatus.charAt(0).toUpperCase() + latestDeliveryApp.backgroundCheckStatus.slice(1)}
                          </span>
                        )}
                      </div>
                      <div className="space-y-2">
                        {latestDeliveryApp.backgroundCheckUrl ? (
                          <a href={latestDeliveryApp.backgroundCheckUrl} target="_blank" rel="noopener noreferrer" 
                             className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium">
                            <FileText className="h-4 w-4" />
                            View Document
                          </a>
                        ) : (
                          <div className="flex items-center gap-2 text-gray-500 text-sm">
                            <FileText className="h-4 w-4" />
                            Not uploaded
                          </div>
                        )}
                        <p className="text-xs text-gray-600">Required for delivery operations</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center mx-auto mb-4">
                      <Truck className="h-8 w-8 text-blue-600" />
                    </div>
                    <h4 className="text-lg font-medium text-gray-900 mb-2">No Delivery Partner Application Found</h4>
                    <p className="text-gray-600 mb-6">You need to submit a delivery partner application first to upload documents.</p>
                    <Button asChild className="rounded-xl">
                      <Link href="/delivery-partner-apply">
                        <Truck className="mr-2 h-4 w-4" />
                        Submit Delivery Partner Application
                      </Link>
                    </Button>
                  </div>
                )}
                
                {/* Admin Feedback */}
                {latestDeliveryApp?.documentsAdminFeedback && (
                  <div className="p-4 bg-gradient-to-br from-yellow-50 to-yellow-100/50 rounded-xl border border-yellow-200">
                    <p className="text-sm text-yellow-800 font-medium">Admin Feedback:</p>
                    <p className="text-sm text-yellow-700 mt-1">{latestDeliveryApp.documentsAdminFeedback}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </main>
      <Footer />
    </div>
  );
} 