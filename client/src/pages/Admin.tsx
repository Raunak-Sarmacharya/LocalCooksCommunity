import AdminProtectedRoute from "@/components/admin/AdminProtectedRoute";
import { useFirebaseAuth } from "@/hooks/use-auth";
import {
    formatApplicationStatus,
    formatCertificationStatus,
    formatKitchenPreference,
    getStatusBadgeColor
} from "@/lib/applicationSchema";
import { apiRequest } from "@/lib/queryClient";
import { Application } from "@shared/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useState } from "react";
import { useLocation } from "wouter";

import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, AlertTriangle, CalendarDays, CheckCircle, ChevronDown, ChevronRight, Clock, ExternalLink, Search, Shield, User as UserIcon, XCircle } from "lucide-react";

function AdminDashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());

  const { user, logout } = useFirebaseAuth();

  // Debug authentication state
  console.log('Admin Dashboard - Authentication state:', {
    isLoggedIn: !!user,
    userId: user?.uid,
    userRole: user?.role,
    localStorageUserId: localStorage.getItem('userId')
  });

  // Fetch all applications with user ID in header
  const { data: applications = [], isLoading, error } = useQuery<Application[]>({
    queryKey: ["/api/applications"],
    queryFn: async ({ queryKey }) => {
      console.log('Admin: Fetching applications data...');
      
      const headers: Record<string, string> = {
        // Add cache busting headers to ensure fresh data
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      };

      // Include user ID in header for authentication
      if (user?.uid) {
        headers['X-User-ID'] = user.uid.toString();
      }

      const response = await fetch(queryKey[0] as string, {
        credentials: 'include',
        headers
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || response.statusText);
      }

      const rawData = await response.json();
      console.log('Admin: Fresh data fetched', rawData);

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
        applicantUsername: app.applicant_username || app.applicantUsername,
        // Document verification fields
        foodSafetyLicenseUrl: app.food_safety_license_url || app.foodSafetyLicenseUrl,
        foodEstablishmentCertUrl: app.food_establishment_cert_url || app.foodEstablishmentCertUrl,
        foodSafetyLicenseStatus: app.food_safety_license_status || app.foodSafetyLicenseStatus,
        foodEstablishmentCertStatus: app.food_establishment_cert_status || app.foodEstablishmentCertStatus,
        documentsAdminFeedback: app.documents_admin_feedback || app.documentsAdminFeedback,
        documentsReviewedBy: app.documents_reviewed_by || app.documentsReviewedBy,
        documentsReviewedAt: app.documents_reviewed_at || app.documentsReviewedAt,
      }));

      console.log('Admin: Normalized application data', normalizedData);
      return normalizedData;
    },
    enabled: !!user, // Only run query when user is authenticated
    // Intelligent auto-refresh for admin dashboard
    refetchInterval: (data) => {
      if (!data || !Array.isArray(data)) return 20000; // 20 seconds if no data or invalid data

      // Check for any pending document reviews across all applications
      const hasPendingDocumentReviews = data.some(app => 
        app.status === "approved" && (
          app.foodSafetyLicenseStatus === "pending" ||
          app.foodEstablishmentCertStatus === "pending"
        )
      );

      // Check for new applications awaiting review
      const hasNewApplications = data.some(app => 
        app.status === "inReview"
      );

      if (hasPendingDocumentReviews) {
        // Very frequent updates when documents need admin review
        return 5000; // 5 seconds - match other components
      } else if (hasNewApplications) {
        // Moderate frequency for general application reviews
        return 15000; // 15 seconds
      } else {
        // Default case - still refresh frequently
        return 30000; // 30 seconds
      }
    },
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnMount: true, // Always refetch when component mounts
    refetchOnReconnect: true, // Refetch when network reconnects
    // Enhanced cache invalidation strategy
    staleTime: 0, // Consider data stale immediately - always check for updates
    gcTime: 10000, // Keep in cache for only 10 seconds (updated property name)
  });

  // Mutation to update application status
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number, status: string }) => {
      // Create custom headers with user ID for authentication
      const customHeaders: Record<string, string> = {};

      // Include user ID in header for authentication
      if (user?.uid) {
        customHeaders['X-User-ID'] = user.uid.toString();
        console.log('Adding X-User-ID header for status update:', user.uid);
      }

      try {
        console.log(`Updating application ${id} status to ${status}`);
        const response = await apiRequest("PATCH", `/api/applications/${id}/status`, { status }, customHeaders);
        console.log('Status update response:', response.status);
        return response.json();
      } catch (error) {
        console.error('Error updating application status:', error);
        throw error;
      }
    },
    onSuccess: async (data) => {
      // Force comprehensive refresh after status update
      await forceAdminRefresh();
      
      // Additional immediate refresh for other components that might be listening
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/applications"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/applications/my-applications"] })
      ]);
      
      toast({
        title: "Status updated",
        description: `Application status changed to ${data.status}. Email notification sent.`,
      });

      console.log('Status update successful with email notification:', data);
    },
    onError: (error) => {
      console.error('Status update error details:', error);

      // Check if it's an authentication error
      const isAuthError = error.message?.includes('Authentication') ||
        error.message?.includes('401') ||
        error.message?.includes('403');

      if (isAuthError) {
        toast({
          title: "Authentication Error",
          description: "Your session may have expired. Please refresh the page or log in again.",
          variant: "destructive",
        });

        // Refresh the auth state
        queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      } else {
        toast({
          title: "Error updating status",
          description: error.message || "Please try again.",
          variant: "destructive",
        });
      }
    },
  });

  // Mutation to update document verification status
  const updateDocumentStatusMutation = useMutation({
    mutationFn: async ({ id, field, status }: { id: number, field: string, status: string }) => {
      const customHeaders: Record<string, string> = {};
      
      if (user?.uid) {
        customHeaders['X-User-ID'] = user.uid.toString();
      }

      const updateData = { [field]: status };
      const response = await apiRequest("PATCH", `/api/applications/${id}/document-verification`, updateData, customHeaders);
      return response.json();
    },
    onSuccess: async (data, variables) => {
      // Force comprehensive refresh after document status update
      await forceAdminRefresh();
      
      // Additional immediate refresh for other components that might be listening
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/applications"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/applications/my-applications"] })
      ]);
      
      // Additional delayed refresh to catch any async database updates
      setTimeout(async () => {
        await forceAdminRefresh();
      }, 1000);
      
      toast({
        title: "Document status updated",
        description: `${variables.field === 'foodSafetyLicenseStatus' ? 'Food Safety License' : 'Food Establishment Certificate'} status changed to ${variables.status}. User will be notified automatically.`,
      });
      
      console.log('Admin: Document status updated', {
        applicationId: variables.id,
        field: variables.field,
        newStatus: variables.status,
        timestamp: new Date().toISOString()
      });
    },
    onError: (error) => {
      toast({
        title: "Error updating document status",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Helper function to get document status badge
  const getDocumentStatusBadge = (status: string | null) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-300">
            <Clock className="h-3 w-3 mr-1" />
            Pending
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
        return (
          <Badge variant="secondary" className="bg-gray-100 text-gray-800 border-gray-300">
            Not Set
          </Badge>
        );
    }
  };

  // Filter applications based on status and search term
  const filteredApplications = applications ? applications.filter((app) => {
    const matchesStatus = filterStatus === "all" || app.status === filterStatus;
    
    // Enhanced search to include name, email, application ID, and submission date
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = searchTerm === "" ||
      app.fullName.toLowerCase().includes(searchLower) ||
      app.email.toLowerCase().includes(searchLower) ||
      app.id.toString().includes(searchLower) ||
      new Date(app.createdAt).toLocaleDateString().includes(searchLower) ||
      new Date(app.createdAt).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      }).toLowerCase().includes(searchLower);

    return matchesStatus && matchesSearch;
  }) : [];

  // Handle status change
  const handleStatusChange = (id: number, newStatus: string) => {
    updateStatusMutation.mutate({ id, status: newStatus });
  };

  // Handle document status change
  const handleDocumentStatusUpdate = (id: number, field: string, status: string) => {
    updateDocumentStatusMutation.mutate({ id, field, status });
  };

  // Handle logout
  const handleLogout = () => {
    logout();
  };

  // Helper function to toggle card expansion
  const toggleCardExpansion = (appId: number) => {
    setExpandedCards(prev => {
      const newSet = new Set(prev);
      if (newSet.has(appId)) {
        newSet.delete(appId);
      } else {
        newSet.add(appId);
      }
      return newSet;
    });
  };

  // Helper function to get the correct CTA button for each application
  const getCtaButton = (app: Application) => {
    // Cancelled applications cannot be modified
    if (app.status === "cancelled") {
      return (
        <Button
          size="sm"
          variant="outline"
          disabled
          className="text-gray-400 border-gray-200 text-xs px-3 py-1.5 h-auto cursor-not-allowed"
        >
          <XCircle className="h-3 w-3 mr-1" />
          Cancelled
        </Button>
      );
    }

    // Quick Approve: User said yes to both and uploaded documents
    if (app.status !== "approved" && 
        app.foodSafetyLicense === "yes" && 
        app.foodEstablishmentCert === "yes" && 
        app.foodSafetyLicenseUrl && 
        app.foodEstablishmentCertUrl) {
      return (
        <Button
          size="sm"
          onClick={() => handleStatusChange(app.id, "approved")}
          className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1.5 h-auto"
        >
          <CheckCircle className="h-3 w-3 mr-1" />
          Quick Approve
        </Button>
      );
    }

    // Regular Approve: For other cases where user said yes to at least one cert
    if (app.status !== "approved" && app.status !== "rejected") {
      return (
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleStatusChange(app.id, "approved")}
          className="text-blue-600 border-blue-200 hover:bg-blue-50 text-xs px-3 py-1.5 h-auto"
        >
          <CheckCircle className="h-3 w-3 mr-1" />
          Approve
        </Button>
      );
    }

    return null;
  };

  // Helper function to get certification status icons
  const getCertificationIcon = (status: string) => {
    switch (status) {
      case "yes":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "no":
        return <XCircle className="h-4 w-4 text-red-600" />;
      case "notSure":
        return <AlertTriangle className="h-4 w-4 text-amber-600" />;
      default:
        return <XCircle className="h-4 w-4 text-gray-400" />;
    }
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
      transition: {
        type: "spring",
        damping: 15,
        stiffness: 100
      }
    }
  };

  // Helper function for status icons
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "inReview": return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case "approved": return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "rejected": return <XCircle className="h-4 w-4 text-red-500" />;
      case "cancelled": return <XCircle className="h-4 w-4 text-gray-500" />;
      default: return null;
    }
  };

  // Get status counts for dashboard metrics
  const statusCounts = {
    inReview: applications.filter(app => app.status === "inReview").length,
    approved: applications.filter(app => app.status === "approved").length,
    rejected: applications.filter(app => app.status === "rejected").length,
    cancelled: applications.filter(app => app.status === "cancelled").length,
    total: applications.length
  };

  // Enhanced force refresh function for admin
  const forceAdminRefresh = async () => {
    console.log('Admin: Forcing comprehensive refresh...');
    
    try {
      // 1. Clear all application-related caches more aggressively
      const cacheKeys = [
        ["/api/applications"],
        ["/api/applications/my-applications"],
        ["/api/user"]
      ];
      
      // Remove all related queries from cache
      await Promise.all(cacheKeys.map(key => 
        queryClient.removeQueries({ queryKey: key })
      ));
      
      // 2. Invalidate all related queries
      await Promise.all(cacheKeys.map(key => 
        queryClient.invalidateQueries({ queryKey: key })
      ));
      
      // 3. Force immediate refetch with fresh network requests
      await Promise.all([
        queryClient.refetchQueries({ 
          queryKey: ["/api/applications"],
          type: 'all'
        }),
        queryClient.refetchQueries({ 
          queryKey: ["/api/applications/my-applications"],
          type: 'all'
        })
      ]);
      
      console.log('Admin: Comprehensive refresh completed');
    } catch (error) {
      console.error('Admin: Force refresh failed', error);
      // Fallback: try to refresh just the admin query
      try {
        await queryClient.refetchQueries({ queryKey: ["/api/applications"] });
        console.log('Admin: Fallback refresh completed');
      } catch (fallbackError) {
        console.error('Admin: Fallback refresh also failed', fallbackError);
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-light-gray">
      <Header />
      <main className="flex-grow pt-28 pb-16">
        <div className="container mx-auto px-4">
          <motion.div
            className="max-w-6xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Card className="bg-white shadow-lg mb-8">
              <CardHeader className="pb-2">
                <div className="flex flex-col md:flex-row justify-between items-center">
                  <div>
                    <CardTitle className="text-2xl md:text-3xl font-bold">Admin Dashboard</CardTitle>
                    <CardDescription className="text-lg mt-1">
                      Review and manage cook applications
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleLogout}
                    className="mt-4 md:mt-0 border-red-500 text-red-500 hover:bg-red-500 hover:text-white"
                  >
                    Logout
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="pt-6">
                {/* Application Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                  <Card className="bg-white shadow-sm border-2 border-green-100">
                    <CardContent className="p-4 text-center">
                      <div className="text-4xl font-bold text-green-500">{statusCounts.approved}</div>
                      <div className="text-sm mt-1 text-gray-600">Approved</div>
                    </CardContent>
                  </Card>

                  <Card className="bg-white shadow-sm border-2 border-yellow-100">
                    <CardContent className="p-4 text-center">
                      <div className="text-4xl font-bold text-yellow-500">{statusCounts.inReview}</div>
                      <div className="text-sm mt-1 text-gray-600">In Review</div>
                    </CardContent>
                  </Card>

                  <Card className="bg-white shadow-sm border-2 border-blue-100">
                    <CardContent className="p-4 text-center">
                      <div className="text-4xl font-bold text-blue-500">{statusCounts.approved}</div>
                      <div className="text-sm mt-1 text-gray-600">Approved</div>
                    </CardContent>
                  </Card>

                  <Card className="bg-white shadow-sm border-2 border-red-100">
                    <CardContent className="p-4 text-center">
                      <div className="text-4xl font-bold text-red-500">{statusCounts.rejected}</div>
                      <div className="text-sm mt-1 text-gray-600">Rejected</div>
                    </CardContent>
                  </Card>

                  <Card className="bg-white shadow-sm border-2 border-gray-200">
                    <CardContent className="p-4 text-center">
                      <div className="text-4xl font-bold text-gray-700">{statusCounts.total}</div>
                      <div className="text-sm mt-1 text-gray-600">Total</div>
                    </CardContent>
                  </Card>
                </div>

                <Tabs defaultValue="all" className="w-full mb-6">
                  <div className="flex flex-col md:flex-row justify-between items-center mb-4">
                    <TabsList>
                      <TabsTrigger value="all" className="flex items-center gap-1">
                        All
                      </TabsTrigger>
                      <TabsTrigger value="inReview" className="flex items-center gap-1">
                        <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />
                        In Review
                      </TabsTrigger>
                      <TabsTrigger value="approved" className="flex items-center gap-1">
                        <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                        Approved
                      </TabsTrigger>
                      <TabsTrigger value="rejected" className="flex items-center gap-1">
                        <XCircle className="h-3.5 w-3.5 text-red-500" />
                        Rejected
                      </TabsTrigger>
                    </TabsList>

                    <div className="mt-4 md:mt-0 w-full md:w-auto flex items-center">
                      <div className="relative w-full md:w-64">
                        <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                          type="text"
                          placeholder="Search by name, email, ID, or date..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-8 pr-4 py-2"
                        />
                      </div>
                    </div>
                  </div>

                  <TabsContent value="all" className="mt-0">
                    {renderApplicationList(filteredApplications)}
                  </TabsContent>
                  <TabsContent value="inReview" className="mt-0">
                    {renderApplicationList(applications.filter(app => app.status === "inReview"))}
                  </TabsContent>
                  <TabsContent value="approved" className="mt-0">
                    {renderApplicationList(applications.filter(app => app.status === "approved"))}
                  </TabsContent>
                  <TabsContent value="rejected" className="mt-0">
                    {renderApplicationList(applications.filter(app => app.status === "rejected"))}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <div className="text-center">
              <Button
                onClick={() => navigate("/")}
                className="bg-primary hover:bg-opacity-90 text-white font-bold py-3 px-8 rounded-full shadow-lg transform transition hover:-translate-y-1"
              >
                Return to Website
              </Button>
            </div>
          </motion.div>
        </div>
      </main>
      <Footer />
    </div>
  );

  // Helper function to render application list
  function renderApplicationList(apps: Application[]) {
    if (isLoading) {
      return (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4">Loading applications...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="text-center py-8 text-red-500">
          <AlertCircle className="h-12 w-12 mx-auto mb-2" />
          Error loading applications. Please try refreshing the page.
        </div>
      );
    }

    if (apps.length === 0) {
      return (
        <div className="text-center py-12 border rounded-lg bg-muted/20">
          <h2 className="text-xl font-semibold mb-2">No applications found</h2>
          <p className="text-muted-foreground">
            {searchTerm ? 'Try adjusting your search criteria' : 'No applications in this category'}
          </p>
        </div>
      );
    }

    return (
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-2"
      >
        {apps.map((app: Application) => {
          const isExpanded = expandedCards.has(app.id);
          
          return (
            <motion.div key={app.id} variants={itemVariants} className="w-full">
              <Card className="overflow-hidden hover:shadow-md transition-all duration-300">
                
                {/* COMPACT VIEW - Always Visible */}
                <CardContent className="p-0">
                  <div className={`p-4 border-l-4 ${getStatusBadgeColor(app.status)}`}>
                    <div className="flex items-center justify-between">
                      
                      {/* Left side: Name and Certifications */}
                      <div className="flex items-center space-x-4 flex-1">
                        <div className="flex items-center space-x-2">
                          <UserIcon className="h-4 w-4 text-gray-500" />
                          <div>
                            <h3 className="font-semibold text-lg">{app.fullName}</h3>
                            <div className="flex items-center space-x-3 text-xs text-gray-500">
                              <span>ID: #{app.id}</span>
                              <span>•</span>
                              <span>Submitted: {new Date(app.createdAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                        
                        {/* Certification Status Indicators */}
                        <div className="flex items-center space-x-3">
                          <div className="flex items-center space-x-1" title="Food Safety License">
                            {getCertificationIcon(app.foodSafetyLicense)}
                            <span className="text-xs text-gray-600">FSL</span>
                            {app.foodSafetyLicenseUrl && (
                              <a 
                                href={app.foodSafetyLicenseUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:text-blue-700 transition-colors"
                                title="View Food Safety License Document"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          
                          <div className="flex items-center space-x-1" title="Food Establishment Certificate">
                            {getCertificationIcon(app.foodEstablishmentCert)}
                            <span className="text-xs text-gray-600">FEC</span>
                            {app.foodEstablishmentCertUrl && (
                              <a 
                                href={app.foodEstablishmentCertUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:text-blue-700 transition-colors"
                                title="View Food Establishment Certificate Document"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Center: Status Badge */}
                      <div className="flex items-center space-x-3">
                        <Badge className={`${getStatusBadgeColor(app.status)} flex items-center gap-1.5 px-2 py-1`}>
                          {getStatusIcon(app.status)}
                          {formatApplicationStatus(app.status)}
                        </Badge>
                      </div>

                      {/* Right side: CTA Button and Expand Arrow */}
                      <div className="flex items-center space-x-2">
                        {getCtaButton(app)}
                        
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleCardExpansion(app.id)}
                          className="h-8 w-8 p-0"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* EXPANDED VIEW - Only visible when expanded */}
                  {isExpanded && (
                    <div className="p-6 bg-gray-50 border-t">
                      {/* Cancelled Application Notice */}
                      {app.status === "cancelled" && (
                        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                          <div className="flex items-center gap-2">
                            <XCircle className="h-5 w-5 text-red-600" />
                            <div>
                              <h4 className="text-sm font-semibold text-red-800">Application Cancelled</h4>
                              <p className="text-xs text-red-700 mt-1">
                                This application has been cancelled and cannot be modified. All controls are disabled.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Contact Information */}
                      <div className="mb-4">
                        <h4 className="text-sm font-semibold mb-2">Contact Information</h4>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-gray-600">Email:</span> {app.email}
                          </div>
                          <div>
                            <span className="text-gray-600">Phone:</span> {app.phone}
                          </div>
                        </div>
                      </div>

                      {/* Detailed Certification Status */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div className="bg-white p-3 rounded-md border">
                          <h4 className="text-xs font-medium text-gray-600 mb-1">
                            Food Safety License
                          </h4>
                          <div className="flex items-center space-x-2">
                            {getCertificationIcon(app.foodSafetyLicense)}
                            <span className="font-medium text-sm">{formatCertificationStatus(app.foodSafetyLicense)}</span>
                          </div>
                        </div>
                        <div className="bg-white p-3 rounded-md border">
                          <h4 className="text-xs font-medium text-gray-600 mb-1">
                            Food Establishment Certificate
                          </h4>
                          <div className="flex items-center space-x-2">
                            {getCertificationIcon(app.foodEstablishmentCert)}
                            <span className="font-medium text-sm">{formatCertificationStatus(app.foodEstablishmentCert)}</span>
                          </div>
                        </div>
                        <div className="bg-white p-3 rounded-md border">
                          <h4 className="text-xs font-medium text-gray-600 mb-1">
                            Kitchen Preference
                          </h4>
                          <p className="font-medium text-sm">{formatKitchenPreference(app.kitchenPreference)}</p>
                        </div>
                      </div>

                      {/* Application-specific notices */}
                      {app.status !== "approved" && 
                       app.foodSafetyLicense === "yes" && 
                       app.foodEstablishmentCert === "yes" && 
                       app.foodSafetyLicenseUrl && 
                       app.foodEstablishmentCertUrl && (
                        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="text-sm font-semibold text-green-800 flex items-center gap-2">
                                <CheckCircle className="h-4 w-4" />
                                Ready for Quick Approval
                              </h4>
                              <p className="text-xs text-green-700 mt-1">
                                Applicant has both certifications and documents uploaded
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Notice for applications that will need documents later */}
                      {(app.foodSafetyLicense === "no" || app.foodSafetyLicense === "notSure" || 
                        app.foodEstablishmentCert === "no" || app.foodEstablishmentCert === "notSure") && 
                       app.status !== "approved" && (
                        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                          <h4 className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4" />
                            Document Upload Required After Approval
                          </h4>
                          <p className="text-xs text-amber-700 mt-1">
                            {app.foodSafetyLicense === "no" || app.foodSafetyLicense === "notSure" ? 
                              "• Food Safety License: " + formatCertificationStatus(app.foodSafetyLicense) : ""}
                            {(app.foodSafetyLicense === "no" || app.foodSafetyLicense === "notSure") && 
                             (app.foodEstablishmentCert === "no" || app.foodEstablishmentCert === "notSure") ? 
                              "\n" : ""}
                            {app.foodEstablishmentCert === "no" || app.foodEstablishmentCert === "notSure" ? 
                              "• Food Establishment Cert: " + formatCertificationStatus(app.foodEstablishmentCert) : ""}
                          </p>
                          <p className="text-xs text-amber-600 mt-2 font-medium">
                            This applicant will need to upload documents after approval and wait for document verification.
                          </p>
                        </div>
                      )}

                      {/* Document Verification Section */}
                      {app.status === "approved" && (
                        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                          <h4 className="text-sm font-semibold mb-3 text-blue-800 flex items-center gap-2">
                            <Shield className="h-4 w-4" />
                            Document Verification
                          </h4>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            {/* Food Safety License Document */}
                            <div className="space-y-2">
                              <h5 className="text-xs font-medium text-gray-600">Food Safety License</h5>
                              {app.foodSafetyLicenseUrl ? (
                                <div className="space-y-2">
                                  <a 
                                    href={app.foodSafetyLicenseUrl} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline text-sm flex items-center gap-1"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    {app.foodSafetyLicenseUrl.startsWith('/api/files/') ? 'View Document' : 'External Link'}
                                  </a>
                                  <div>
                                    {getDocumentStatusBadge(app.foodSafetyLicenseStatus)}
                                  </div>
                                  {/* FSL Approval Controls */}
                                  <div className="flex gap-1 pt-1">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleDocumentStatusUpdate(app.id, 'foodSafetyLicenseStatus', 'approved')}
                                      className="text-xs px-2 py-1 h-auto text-green-600 border-green-200 hover:bg-green-50"
                                    >
                                      Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleDocumentStatusUpdate(app.id, 'foodSafetyLicenseStatus', 'rejected')}
                                      className="text-xs px-2 py-1 h-auto text-red-600 border-red-200 hover:bg-red-50"
                                    >
                                      Reject
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-gray-500 text-sm">No document uploaded</span>
                              )}
                            </div>

                            {/* Food Establishment Certificate Document */}
                            <div className="space-y-2">
                              <h5 className="text-xs font-medium text-gray-600">Food Establishment Certificate</h5>
                              {app.foodEstablishmentCertUrl ? (
                                <div className="space-y-2">
                                  <a 
                                    href={app.foodEstablishmentCertUrl} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline text-sm flex items-center gap-1"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    {app.foodEstablishmentCertUrl.startsWith('/api/files/') ? 'View Document' : 'External Link'}
                                  </a>
                                  <div>
                                    {getDocumentStatusBadge(app.foodEstablishmentCertStatus)}
                                  </div>
                                  {/* FEC Approval Controls */}
                                  <div className="flex gap-1 pt-1">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleDocumentStatusUpdate(app.id, 'foodEstablishmentCertStatus', 'approved')}
                                      className="text-xs px-2 py-1 h-auto text-green-600 border-green-200 hover:bg-green-50"
                                    >
                                      Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleDocumentStatusUpdate(app.id, 'foodEstablishmentCertStatus', 'rejected')}
                                      className="text-xs px-2 py-1 h-auto text-red-600 border-red-200 hover:bg-red-50"
                                    >
                                      Reject
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-gray-500 text-sm">No document uploaded</span>
                              )}
                            </div>
                          </div>

                          {/* Admin Feedback */}
                          {app.documentsAdminFeedback && (
                            <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm">
                              <strong>Admin Feedback:</strong> {app.documentsAdminFeedback}
                            </div>
                          )}

                          {app.documentsReviewedAt && (
                            <p className="text-xs text-gray-500 mt-2">
                              Last reviewed: {new Date(app.documentsReviewedAt).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Full Application Details */}
                      <div className="pt-4 border-t">
                        <h4 className="text-sm font-semibold mb-3">Complete Application Details</h4>
                        <div className="bg-white p-4 rounded-lg border">
                          <div className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                              <h5 className="text-xs font-medium text-gray-600 mb-1">Application ID</h5>
                              <p className="font-medium text-sm">#{app.id}</p>
                            </div>
                            <div>
                              <h5 className="text-xs font-medium text-gray-600 mb-1">Submitted</h5>
                              <p className="font-medium text-sm">{new Date(app.createdAt).toLocaleDateString()}</p>
                            </div>
                          </div>
                          
                          {app.feedback && (
                            <div>
                              <h5 className="text-xs font-medium text-gray-600 mb-1">Feedback/Questions</h5>
                              <p className="font-medium text-sm bg-gray-50 p-3 rounded-md border">
                                {app.feedback}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Status Change Dropdown */}
                        <div className="mt-4 pt-4 border-t flex justify-between items-center">
                          <div className="flex items-center text-xs text-gray-600">
                            <CalendarDays className="h-3 w-3 mr-1" />
                            Submitted on {new Date(app.createdAt).toLocaleDateString()}
                          </div>
                          <div>
                            {app.status === "cancelled" ? (
                              <div className="flex items-center space-x-2 text-xs text-gray-500">
                                <XCircle className="h-3 w-3" />
                                <span>Application Cancelled - No modifications allowed</span>
                              </div>
                            ) : (
                              <Select
                                defaultValue={app.status}
                                onValueChange={(value) => handleStatusChange(app.id, value)}
                              >
                                <SelectTrigger className="h-8 w-[140px]">
                                  <SelectValue placeholder="Update Status" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="inReview">In Review</SelectItem>
                                  <SelectItem value="approved">Approve</SelectItem>
                                  <SelectItem value="rejected">Reject</SelectItem>
                                  <SelectItem value="cancelled">Cancel</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>
    );
  }
}

export default function Admin() {
  return (
    <AdminProtectedRoute>
      <AdminDashboard />
    </AdminProtectedRoute>
  );
}
