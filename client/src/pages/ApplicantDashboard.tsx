import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import { Application } from "@shared/schema";
import {
  formatCertificationStatus,
  formatKitchenPreference,
  getStatusBadgeColor,
  formatApplicationStatus
} from "@/lib/applicationSchema";
import {
  Loader2, AlertCircle, Clock, CheckCircle, XCircle,
  CalendarDays, ChefHat, UtensilsCrossed, Building,
  HomeIcon, Award, FileText, BadgeCheck, Info, LogOut
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { motion } from "framer-motion";

// Helper to check if an application is active (not cancelled, rejected)
const isApplicationActive = (app: Application) => {
  return app.status !== 'cancelled' && app.status !== 'rejected';
};

// Helper to check if user can apply again
const canApplyAgain = (applications: Application[]) => {
  if (!applications || applications.length === 0) return true;
  // Check if any application is active (not cancelled or rejected)
  return !applications.some(isApplicationActive);
};

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: "spring", stiffness: 100 }
  }
};

export default function ApplicantDashboard() {
  const { user, logoutMutation } = useAuth();

  // Debug authentication state
  console.log('ApplicantDashboard - Authentication state:', {
    isLoggedIn: !!user,
    userId: user?.id,
    userRole: user?.role,
    localStorageUserId: localStorage.getItem('userId')
  });

  // Fetch applicant's applications with user ID in header
  const { data: applications, isLoading } = useQuery<Application[]>({
    queryKey: ["/api/applications/my-applications"],
    queryFn: async ({ queryKey }) => {
      if (!user?.id) {
        throw new Error("User not authenticated");
      }

      const headers: Record<string, string> = {
        'X-User-ID': user.id.toString()
      };

      const response = await fetch(queryKey[0] as string, {
        credentials: 'include',
        headers
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || response.statusText);
      }

      const rawData = await response.json();
      console.log('Raw application data:', rawData);

      // Convert snake_case to camelCase for database fields
      const normalizedData = rawData.map((app: any) => ({
        id: app.id,
        userId: app.user_id || app.userId,
        fullName: app.full_name || app.fullName,
        email: app.email,
        phone: app.phone,
        foodSafetyLicense: app.food_safety_license || app.foodSafetyLicense,
        foodEstablishmentCert: app.food_establishment_cert || app.foodEstablishmentCert,
        kitchenPreference: app.kitchen_preference || app.kitchenPreference,
        feedback: app.feedback,
        status: app.status,
        createdAt: app.created_at || app.createdAt,
        // Document verification fields
        foodSafetyLicenseUrl: app.food_safety_license_url || app.foodSafetyLicenseUrl,
        foodEstablishmentCertUrl: app.food_establishment_cert_url || app.foodEstablishmentCertUrl,
        foodSafetyLicenseStatus: app.food_safety_license_status || app.foodSafetyLicenseStatus,
        foodEstablishmentCertStatus: app.food_establishment_cert_status || app.foodEstablishmentCertStatus,
        documentsAdminFeedback: app.documents_admin_feedback || app.documentsAdminFeedback,
        documentsReviewedBy: app.documents_reviewed_by || app.documentsReviewedBy,
        documentsReviewedAt: app.documents_reviewed_at || app.documentsReviewedAt,
      }));

      console.log('Normalized application data:', normalizedData);
      return normalizedData;
    },
    enabled: !!user,
  });

  // Mutation to cancel an application
  const cancelMutation = useMutation({
    mutationFn: async (applicationId: number) => {
      // Include user ID in header
      const headers: Record<string, string> = {};
      if (user?.id) {
        headers['X-User-ID'] = user.id.toString();
      }

      const res = await apiRequest("PATCH", `/api/applications/${applicationId}/cancel`, undefined, headers);
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Application Cancelled",
        description: "Your application has been successfully cancelled.",
        variant: "default",
      });
      // Refresh the applications list
      queryClient.invalidateQueries({ queryKey: ["/api/applications/my-applications"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: `Failed to cancel application: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-grow container max-w-6xl mx-auto px-4 pt-28 pb-8">
        <div className="mb-6 md:mb-8 p-4 md:p-6 bg-gradient-to-r from-primary/10 to-transparent rounded-xl">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 md:gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-800 flex items-center">
                <span className="font-logo text-primary mr-2">My</span> Applications
              </h1>
              <p className="text-sm md:text-base text-gray-600 mt-1 md:mt-2 max-w-lg">
                Track, manage and update your Local Cooks applications. We're excited to have you join our community of talented chefs!
              </p>
            </div>
            <div className="flex flex-wrap gap-2 md:gap-3 mt-3 md:mt-0">
              <Button
                asChild
                variant="default"
                size="sm"
                className="bg-primary/90 hover:bg-primary rounded-full shadow-sm text-xs md:text-sm py-1 h-auto md:h-10"
              >
                <Link href="/">
                  <ChefHat className="mr-1.5 h-3.5 w-3.5 md:h-4 md:w-4" />
                  Explore Opportunities
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                className="rounded-full border-gray-300 text-xs md:text-sm py-1 h-auto md:h-10"
              >
                {logoutMutation.isPending ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 md:h-4 md:w-4 animate-spin" />
                    Logging out...
                  </>
                ) : (
                  <>
                    <LogOut className="mr-1.5 h-3.5 w-3.5 md:h-4 md:w-4" />
                    Log out
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : applications && applications.length > 0 ? (
          <motion.div
            className="space-y-6"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {applications.map((application) => {
              const canApply = !isApplicationActive(application);
              const isApproved = application.status === "approved";
              const statusIcon = () => {
                switch (application.status) {
                  case "new": return <AlertCircle className="h-5 w-5 text-yellow-500" />;
                  case "inReview": return <Clock className="h-5 w-5 text-blue-500" />;
                  case "approved": return <CheckCircle className="h-5 w-5 text-green-500" />;
                  case "rejected": return <XCircle className="h-5 w-5 text-red-500" />;
                  case "cancelled": return <XCircle className="h-5 w-5 text-gray-500" />;
                  default: return null;
                }
              };

              return (
                <motion.div
                  key={application.id}
                  className="bg-white rounded-lg shadow-md border p-4 md:p-6 hover:shadow-lg hover-shadow group"
                  variants={itemVariants}
                >
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 md:gap-0">
                    <div>
                      <h2 className="text-lg md:text-xl font-semibold">{application.fullName || "No Name Provided"}</h2>
                      <p className="text-sm text-muted-foreground">{application.email || "No Email Provided"}</p>
                    </div>
                    <Badge className={`${getStatusBadgeColor(application.status)} self-start sm:self-auto flex items-center gap-1.5 px-2 md:px-3 py-1 md:py-1.5 text-xs md:text-sm mt-1 sm:mt-0`}>
                      {statusIcon()}
                      {formatApplicationStatus(application.status)}
                    </Badge>
                  </div>

                  {/* Document Verification Alert for Approved Applications */}
                  {isApproved && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      transition={{ duration: 0.3 }}
                      className="mt-4"
                    >
                      {/* Check if user is fully verified */}
                      {(() => {
                        const isFullyVerified = application.foodSafetyLicenseStatus === "approved" && 
                          (!application.foodEstablishmentCertUrl || application.foodEstablishmentCertStatus === "approved");
                        
                        if (isFullyVerified) {
                          return (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                              <div className="flex items-start gap-3">
                                <div className="bg-green-100 p-2 rounded-full">
                                  <CheckCircle className="h-5 w-5 text-green-600" />
                                </div>
                                <div className="flex-1">
                                  <h3 className="font-semibold text-green-800 mb-1 flex items-center gap-2">
                                    <Award className="h-4 w-4" />
                                    Fully Verified Cook!
                                  </h3>
                                  <p className="text-sm text-green-700 mb-3">
                                    🎉 Congratulations! Your documents have been approved and you are now a verified Local Cook. You can start accepting orders from customers.
                                  </p>
                                  <div className="flex flex-col sm:flex-row gap-2 items-start">
                                    <div className="flex items-center gap-2">
                                      <Badge className="bg-green-100 text-green-800 border-green-300">
                                        <CheckCircle className="h-3 w-3 mr-1" />
                                        Food Safety License: Approved
                                      </Badge>
                                      {application.foodEstablishmentCertUrl && (
                                        <Badge className="bg-green-100 text-green-800 border-green-300">
                                          <CheckCircle className="h-3 w-3 mr-1" />
                                          Food Establishment Cert: Approved
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                  {application.documentsReviewedAt && (
                                    <p className="text-xs text-green-600 mt-2">
                                      Verified on {new Date(application.documentsReviewedAt).toLocaleDateString('en-US', {
                                        weekday: 'short',
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric'
                                      })}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        } else {
                          // Show document management interface for non-verified users
                          return (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                              <div className="flex items-start gap-3">
                                <div className="bg-green-100 p-2 rounded-full">
                                  <FileText className="h-5 w-5 text-green-600" />
                                </div>
                                <div className="flex-1">
                                  <h3 className="font-semibold text-green-800 mb-1">Document Verification Center</h3>
                                  <p className="text-sm text-green-700 mb-3">
                                    Congratulations! Your application has been approved. Upload your verification documents or update existing ones anytime.
                                  </p>
                                  <div className="flex flex-col sm:flex-row gap-2">
                                    <Button
                                      asChild
                                      size="sm"
                                      className="bg-green-600 hover:bg-green-700 text-white"
                                    >
                                      <Link href="/document-verification">
                                        <BadgeCheck className="mr-2 h-4 w-4" />
                                        Manage Documents
                                      </Link>
                                    </Button>
                                    <span className="text-xs text-green-600 flex items-center">
                                      <Info className="mr-1 h-3 w-3" />
                                      Upload new or replace existing files
                                    </span>
                                  </div>
                                  
                                  {/* Show current document status if documents are uploaded */}
                                  {(application.foodSafetyLicenseUrl || application.foodEstablishmentCertUrl) && (
                                    <div className="mt-3 pt-3 border-t border-green-200">
                                      <h4 className="text-xs font-medium text-green-700 mb-2">Current Status:</h4>
                                      <div className="flex flex-wrap gap-2">
                                        {application.foodSafetyLicenseUrl && (
                                          <Badge variant="secondary" className={
                                            application.foodSafetyLicenseStatus === "approved" 
                                              ? "bg-green-100 text-green-800 border-green-300"
                                              : application.foodSafetyLicenseStatus === "rejected"
                                              ? "bg-red-100 text-red-800 border-red-300"
                                              : "bg-yellow-100 text-yellow-800 border-yellow-300"
                                          }>
                                            {application.foodSafetyLicenseStatus === "approved" && <CheckCircle className="h-3 w-3 mr-1" />}
                                            {application.foodSafetyLicenseStatus === "rejected" && <XCircle className="h-3 w-3 mr-1" />}
                                            {application.foodSafetyLicenseStatus === "pending" && <Clock className="h-3 w-3 mr-1" />}
                                            FSL: {application.foodSafetyLicenseStatus}
                                          </Badge>
                                        )}
                                        {application.foodEstablishmentCertUrl && (
                                          <Badge variant="secondary" className={
                                            application.foodEstablishmentCertStatus === "approved" 
                                              ? "bg-green-100 text-green-800 border-green-300"
                                              : application.foodEstablishmentCertStatus === "rejected"
                                              ? "bg-red-100 text-red-800 border-red-300"
                                              : "bg-yellow-100 text-yellow-800 border-yellow-300"
                                          }>
                                            {application.foodEstablishmentCertStatus === "approved" && <CheckCircle className="h-3 w-3 mr-1" />}
                                            {application.foodEstablishmentCertStatus === "rejected" && <XCircle className="h-3 w-3 mr-1" />}
                                            {application.foodEstablishmentCertStatus === "pending" && <Clock className="h-3 w-3 mr-1" />}
                                            FEC: {application.foodEstablishmentCertStatus}
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        }
                      })()}
                    </motion.div>
                  )}

                  <div className="mt-4 md:mt-6 bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                    <h3 className="text-sm font-medium mb-3 text-gray-700">Application Details</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <h4 className="text-xs font-medium text-gray-500 mb-1">Full Name</h4>
                        <p className="font-medium text-gray-900">{application.fullName || "N/A"}</p>
                      </div>
                      <div>
                        <h4 className="text-xs font-medium text-gray-500 mb-1">Email</h4>
                        <p className="font-medium text-gray-900">{application.email || "N/A"}</p>
                      </div>
                      <div>
                        <h4 className="text-xs font-medium text-gray-500 mb-1">Phone</h4>
                        <p className="font-medium text-gray-900">{application.phone || "N/A"}</p>
                      </div>
                      <div>
                        <h4 className="text-xs font-medium text-gray-500 mb-1">Application ID</h4>
                        <p className="font-medium text-gray-900">#{application.id}</p>
                      </div>
                      <div>
                        <h4 className="text-xs font-medium text-gray-500 mb-1">Food Safety License</h4>
                        <p className="font-medium text-gray-900">{formatCertificationStatus(application.foodSafetyLicense)}</p>
                      </div>
                      <div>
                        <h4 className="text-xs font-medium text-gray-500 mb-1">Food Establishment Cert</h4>
                        <p className="font-medium text-gray-900">{formatCertificationStatus(application.foodEstablishmentCert)}</p>
                      </div>
                      <div>
                        <h4 className="text-xs font-medium text-gray-500 mb-1">Kitchen Preference</h4>
                        <p className="font-medium text-gray-900">{formatKitchenPreference(application.kitchenPreference)}</p>
                      </div>
                      <div className="col-span-2">
                        <h4 className="text-xs font-medium text-gray-500 mb-1">Your Feedback/Questions</h4>
                        <p className="font-medium text-gray-900 bg-gray-50 p-3 rounded-md border border-gray-200">
                          {application.feedback || "No feedback or questions provided"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 md:mt-6 pt-4 md:pt-6 border-t flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 md:gap-4">
                    <div className="flex items-center text-sm text-muted-foreground">
                      <CalendarDays className="h-4 w-4 mr-2" />
                      Submitted on {application.createdAt ? new Date(application.createdAt).toLocaleDateString() : "N/A"}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 md:gap-3">
                      {isApplicationActive(application) && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" className="text-red-500 border-red-200 hover:bg-red-50 hover-standard">
                              Cancel Application
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Cancel Application</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to cancel this application? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>No, keep it</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => cancelMutation.mutate(application.id)}
                                className="bg-red-500 hover:bg-red-600 hover-standard"
                              >
                                {cancelMutation.isPending ? (
                                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cancelling...</>
                                ) : (
                                  "Yes, cancel it"
                                )}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}

                      {canApply && (
                        <Button asChild variant="default" size="sm">
                          <Link href="/apply">Apply Again</Link>
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        ) : (
          <motion.div
            className="text-center py-12 px-6 border rounded-xl bg-gradient-to-b from-white to-gray-50 shadow-sm"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="w-16 h-16 mx-auto mb-4 bg-primary/10 rounded-full flex items-center justify-center">
              <FileText className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-2xl font-semibold mb-2">No applications yet</h2>
            <p className="text-gray-600 mb-8 max-w-md mx-auto">
              You haven't submitted any applications to Local Cooks yet. Start your application now to join our growing community of talented chefs!
            </p>
            <Button
              asChild
              size="lg"
              className="bg-primary hover:bg-primary/90 rounded-full px-6 md:px-8 hover-standard w-full sm:w-auto"
            >
              <Link href="/apply">
                <ChefHat className="mr-2 h-5 w-5" />
                Start Your Application
              </Link>
            </Button>

            <div className="mt-10 pt-6 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 text-left">
              <div className="flex items-start gap-3">
                <div className="bg-green-100 p-2 rounded-full mt-1">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <h3 className="font-medium text-sm text-gray-900">Simple Application</h3>
                  <p className="text-xs text-gray-600">Our application process is quick and straightforward</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="bg-blue-100 p-2 rounded-full mt-1">
                  <Info className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-medium text-sm text-gray-900">Guided Process</h3>
                  <p className="text-xs text-gray-600">We'll help you every step of the way</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="bg-yellow-100 p-2 rounded-full mt-1">
                  <Clock className="h-4 w-4 text-yellow-600" />
                </div>
                <div>
                  <h3 className="font-medium text-sm text-gray-900">Quick Response</h3>
                  <p className="text-xs text-gray-600">Get notified about your application status</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </main>
      <Footer />
    </div>
  );
}