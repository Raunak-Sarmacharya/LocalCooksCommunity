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

  // Fetch applicant's applications
  const { data: applications, isLoading } = useQuery<Application[]>({
    queryKey: ["/api/applications/my-applications"],
    enabled: !!user,
  });

  // Mutation to cancel an application
  const cancelMutation = useMutation({
    mutationFn: async (applicationId: number) => {
      const res = await apiRequest("PATCH", `/api/applications/${applicationId}/cancel`);
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
      <main className="flex-grow container max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8 p-6 bg-gradient-to-r from-primary/10 to-transparent rounded-xl">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-800 flex items-center">
                <span className="font-logo text-primary mr-2">My</span> Applications
              </h1>
              <p className="text-gray-600 mt-2 max-w-lg">
                Track, manage and update your Local Cooks applications. We're excited to have you join our community of talented chefs!
              </p>
            </div>
            <div className="flex gap-3">
              <Button 
                asChild 
                variant="default" 
                size="sm"
                className="bg-primary/90 hover:bg-primary rounded-full shadow-sm"
              >
                <Link href="/">
                  <ChefHat className="mr-2 h-4 w-4" />
                  Explore Opportunities
                </Link>
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleLogout}
                className="rounded-full border-gray-300"
              >
                {logoutMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Logging out...
                  </>
                ) : (
                  <>
                    <LogOut className="mr-2 h-4 w-4" />
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
              const statusIcon = () => {
                switch(application.status) {
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
                  className="bg-white rounded-lg shadow-md border p-6 hover:shadow-lg transition-all duration-300"
                  variants={itemVariants}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h2 className="text-xl font-semibold">{application.fullName}</h2>
                      <p className="text-muted-foreground">{application.email}</p>
                    </div>
                    <Badge className={`${getStatusBadgeColor(application.status)} flex items-center gap-1.5 px-3 py-1.5`}>
                      {statusIcon()}
                      {formatApplicationStatus(application.status)}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                    <div className="bg-gradient-to-br from-gray-50 to-white p-4 rounded-lg border border-gray-100 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="bg-green-100 p-1.5 rounded-full">
                          <BadgeCheck className="h-4 w-4 text-green-600" />
                        </div>
                        <h3 className="text-sm font-medium text-gray-700">
                          Food Safety License
                        </h3>
                      </div>
                      <p className="font-medium text-gray-900 ml-8">{formatCertificationStatus(application.foodSafetyLicense)}</p>
                    </div>
                    
                    <div className="bg-gradient-to-br from-gray-50 to-white p-4 rounded-lg border border-gray-100 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="bg-blue-100 p-1.5 rounded-full">
                          <Award className="h-4 w-4 text-blue-600" />
                        </div>
                        <h3 className="text-sm font-medium text-gray-700">
                          Food Establishment Certificate
                        </h3>
                      </div>
                      <p className="font-medium text-gray-900 ml-8">
                        {formatCertificationStatus(application.foodEstablishmentCert)}
                      </p>
                    </div>
                    
                    <div className="bg-gradient-to-br from-gray-50 to-white p-4 rounded-lg border border-gray-100 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="bg-purple-100 p-1.5 rounded-full">
                          {application.kitchenPreference === 'commercial' ? (
                            <Building className="h-4 w-4 text-purple-600" />
                          ) : application.kitchenPreference === 'home' ? (
                            <HomeIcon className="h-4 w-4 text-purple-600" />
                          ) : (
                            <UtensilsCrossed className="h-4 w-4 text-purple-600" />
                          )}
                        </div>
                        <h3 className="text-sm font-medium text-gray-700">
                          Kitchen Preference
                        </h3>
                      </div>
                      <p className="font-medium text-gray-900 ml-8">{formatKitchenPreference(application.kitchenPreference)}</p>
                    </div>
                  </div>

                  <div className="mt-6 pt-6 border-t flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                    <div className="flex items-center text-sm text-muted-foreground">
                      <CalendarDays className="h-4 w-4 mr-2" />
                      Submitted on {new Date(application.createdAt).toLocaleDateString()}
                    </div>
                    <div className="flex gap-3">
                      {isApplicationActive(application) && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" className="text-red-500 border-red-200 hover:bg-red-50">
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
                                className="bg-red-500 hover:bg-red-600"
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
              className="bg-primary hover:bg-primary/90 rounded-full px-8"
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