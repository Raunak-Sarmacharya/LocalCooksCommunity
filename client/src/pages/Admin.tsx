import AdminProtectedRoute from "@/components/admin/AdminProtectedRoute";
import {
    formatApplicationStatus,
    formatCertificationStatus,
    formatKitchenPreference,
    getStatusBadgeColor
} from "@/lib/applicationSchema";
import { Application } from "@shared/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useState } from "react";
import { useLocation } from "wouter";

import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
    AlertCircle,
    AlertTriangle,
    CalendarDays,
    CheckCircle,
    ChevronDown,
    ChevronRight,
    Clock,
    ExternalLink,
    FileText,
    Hash,
    Mail,
    Phone,
    RefreshCw,
    Search,
    Shield,
    User as UserIcon,
    XCircle
} from "lucide-react";

function AdminDashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());
  const [quickFilters, setQuickFilters] = useState({
    needsDocumentReview: false,
    recentApplications: false,
    hasDocuments: false
  });

  // Admin uses ONLY session-based auth (NeonDB) - no Firebase needed
  const { data: sessionUser, isLoading: sessionLoading } = useQuery({
    queryKey: ["/api/user-session"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/user-session", {
          credentials: "include",
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            return null; // Not authenticated via session
          }
          throw new Error(`Session auth failed: ${response.status}`);
        }
        
        const userData = await response.json();
        console.log('Admin Dashboard - Session user data:', userData);
        return {
          ...userData,
          authMethod: 'session'
        };
      } catch (error) {
        console.error('Admin Dashboard - Session auth error:', error);
        return null;
      }
    },
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Admin uses ONLY session authentication
  const user = sessionUser;
  const loading = sessionLoading;
  const isAdmin = user?.role === 'admin';

  // Debug authentication state
  console.log('Admin Dashboard - Authentication state:', {
    loading,
    isLoggedIn: !!user,
    userRole: user?.role,
    isAdmin
  });

  // Fetch all applications - session-based auth only
  const { data: applications = [], isLoading, error } = useQuery<Application[]>({
    queryKey: ["/api/applications"],
    queryFn: async ({ queryKey }) => {
      if (!user) {
        throw new Error("Admin not authenticated");
      }
      
      console.log('Admin: Fetching applications data via session auth...', {
        endpoint: queryKey[0],
        hasSessionUser: !!sessionUser
      });
      
      const headers: Record<string, string> = {
        // Add cache busting headers to ensure fresh data
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      };

      const response = await fetch(queryKey[0] as string, {
        credentials: 'include',
        headers
      });

      if (!response.ok) {
        // Handle specific error cases
        if (response.status === 401) {
          throw new Error("Admin authentication required. Please ensure you're logged in as an admin.");
        }
        if (response.status === 403) {
          throw new Error("Admin access denied. Please contact support if you believe this is an error.");
        }
        
        try {
          const errorData = await response.json();
          throw new Error(errorData.error || response.statusText);
        } catch (parseError) {
          throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }
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
    enabled: !!user && isAdmin, // Only fetch if user is admin
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
      try {
        console.log(`Updating application ${id} status to ${status}`);
        
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        
        const response = await fetch(`/api/applications/${id}/status`, {
          method: 'PATCH',
          headers,
          credentials: 'include',
          body: JSON.stringify({ status })
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || response.statusText);
        }
        
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
      toast({
        title: "Error updating status",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Mutation to update document verification status
  const updateDocumentStatusMutation = useMutation({
    mutationFn: async ({ id, field, status }: { id: number, field: string, status: string }) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      const updateData = { [field]: status };
      const response = await fetch(`/api/applications/${id}/document-verification`, {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify(updateData)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || response.statusText);
      }
      
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

  // Enhanced filter applications based on status, search term, and quick filters
  const filteredApplications = applications ? applications.filter((app) => {
    const matchesStatus = filterStatus === "all" || app.status === filterStatus;
    
    // Enhanced search to include name, email, phone, application ID, and submission date
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = searchTerm === "" ||
      app.fullName.toLowerCase().includes(searchLower) ||
      app.email.toLowerCase().includes(searchLower) ||
      (app.phone && app.phone.toLowerCase().includes(searchLower)) ||
      app.id.toString().includes(searchLower) ||
      new Date(app.createdAt).toLocaleDateString().includes(searchLower) ||
      new Date(app.createdAt).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      }).toLowerCase().includes(searchLower);

    // Quick filters
    let matchesQuickFilters = true;
    
    if (quickFilters.needsDocumentReview) {
      matchesQuickFilters = matchesQuickFilters && app.status === "approved" && (
        app.foodSafetyLicenseStatus === "pending" ||
        app.foodEstablishmentCertStatus === "pending"
      );
    }
    
    if (quickFilters.recentApplications) {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      matchesQuickFilters = matchesQuickFilters && new Date(app.createdAt) > threeDaysAgo;
    }
    
    if (quickFilters.hasDocuments) {
      matchesQuickFilters = matchesQuickFilters && (
        app.foodSafetyLicenseUrl || app.foodEstablishmentCertUrl
      );
    }

    return matchesStatus && matchesSearch && matchesQuickFilters;
  }) : [];

  // Handle status change
  const handleStatusChange = (id: number, newStatus: string) => {
    updateStatusMutation.mutate({ id, status: newStatus });
  };

  // Handle document status change
  const handleDocumentStatusUpdate = (id: number, field: string, status: string) => {
    updateDocumentStatusMutation.mutate({ id, field, status });
  };

  // Handle logout - session-based logout
  const handleLogout = async () => {
    try {
      // Call session logout API
      await fetch('/api/logout', {
        method: 'POST',
        credentials: 'include',
      });
      
      // Clear query cache
      queryClient.clear();
      
      // Redirect to login
      navigate('/admin/login');
    } catch (error) {
      console.error('Logout error:', error);
      // Force redirect even if logout fails
      navigate('/admin/login');
    }
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
        ["/api/user-session"]
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
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/20">
      {/* Subtle background pattern */}
      <div className="fixed inset-0 opacity-[0.02] pointer-events-none">
        <div 
          className="w-full h-full" 
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            backgroundSize: '60px 60px'
          }}
        />
      </div>
      
      <Header />
      <main className="flex-grow pt-20 pb-16 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Welcome Header Section */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 mt-4"
          >
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-lg shadow-lg">
                  <Settings className="h-6 w-6" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
                  <p className="text-gray-500">Manage applications and review documents</p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={handleLogout}
                className="border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 rounded-xl"
              >
                Logout
              </Button>
            </div>
          </motion.div>

          {/* Enhanced Stats Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200/60 hover:shadow-lg hover:border-gray-300/60 transition-all duration-300"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Approved</p>
                  <p className="text-2xl font-bold text-gray-900">{statusCounts.approved}</p>
                </div>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200/60 hover:shadow-lg hover:border-gray-300/60 transition-all duration-300"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-yellow-100 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-yellow-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">In Review</p>
                  <p className="text-2xl font-bold text-gray-900">{statusCounts.inReview}</p>
                </div>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200/60 hover:shadow-lg hover:border-gray-300/60 transition-all duration-300"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                  <XCircle className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Rejected</p>
                  <p className="text-2xl font-bold text-gray-900">{statusCounts.rejected}</p>
                </div>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200/60 hover:shadow-lg hover:border-gray-300/60 transition-all duration-300"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
                  <Shield className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Needs Review</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {applications.filter(app => 
                      app.status === "approved" && (
                        app.foodSafetyLicenseStatus === "pending" ||
                        app.foodEstablishmentCertStatus === "pending"
                      )
                    ).length}
                  </p>
                </div>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200/60 hover:shadow-lg hover:border-gray-300/60 transition-all duration-300"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total</p>
                  <p className="text-2xl font-bold text-gray-900">{statusCounts.total}</p>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Enhanced Search and Filter Section */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200/60 hover:shadow-lg hover:border-gray-300/60 transition-all duration-300 mb-6 backdrop-blur-sm"
          >
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center">
                <Search className="h-6 w-6 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Search & Filter Applications</h3>
                <p className="text-sm text-gray-500">Find and manage applications efficiently</p>
              </div>
            </div>

            {/* Search Bar */}
            <div className="mb-6">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search by name, email, phone, or ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-3 rounded-xl border-gray-200 focus:border-indigo-300 focus:ring-indigo-200"
                />
              </div>
            </div>

            {/* Quick Filter Buttons */}
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Quick Filters</h4>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={quickFilters.needsDocumentReview ? "default" : "outline"}
                  size="sm"
                  onClick={() => setQuickFilters(prev => ({ ...prev, needsDocumentReview: !prev.needsDocumentReview }))}
                  className="rounded-xl"
                >
                  <Shield className="h-4 w-4 mr-2" />
                  Needs Doc Review
                  {applications.filter(app => 
                    app.status === "approved" && (
                      app.foodSafetyLicenseStatus === "pending" ||
                      app.foodEstablishmentCertStatus === "pending"
                    )
                  ).length > 0 && (
                    <span className="ml-2 bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full">
                      {applications.filter(app => 
                        app.status === "approved" && (
                          app.foodSafetyLicenseStatus === "pending" ||
                          app.foodEstablishmentCertStatus === "pending"
                        )
                      ).length}
                    </span>
                  )}
                </Button>
                
                <Button
                  variant={quickFilters.recentApplications ? "default" : "outline"}
                  size="sm"
                  onClick={() => setQuickFilters(prev => ({ ...prev, recentApplications: !prev.recentApplications }))}
                  className="rounded-xl"
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  Recent (3 days)
                </Button>
                
                <Button
                  variant={quickFilters.hasDocuments ? "default" : "outline"}
                  size="sm"
                  onClick={() => setQuickFilters(prev => ({ ...prev, hasDocuments: !prev.hasDocuments }))}
                  className="rounded-xl"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Has Documents
                </Button>
                
                {(quickFilters.needsDocumentReview || quickFilters.recentApplications || quickFilters.hasDocuments) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setQuickFilters({ needsDocumentReview: false, recentApplications: false, hasDocuments: false })}
                    className="rounded-xl text-gray-500 hover:text-gray-700"
                  >
                    Clear All
                  </Button>
                )}
              </div>
            </div>

            {/* Status Tabs */}
            <Tabs defaultValue="all" className="w-full">
              <TabsList className="rounded-xl bg-gray-100 p-1">
                <TabsTrigger value="all" className="flex items-center gap-2 rounded-lg">
                  <Hash className="h-3.5 w-3.5" />
                  All ({statusCounts.total})
                </TabsTrigger>
                <TabsTrigger value="inReview" className="flex items-center gap-2 rounded-lg">
                  <Clock className="h-3.5 w-3.5 text-yellow-500" />
                  In Review ({statusCounts.inReview})
                </TabsTrigger>
                <TabsTrigger value="approved" className="flex items-center gap-2 rounded-lg">
                  <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                  Approved ({statusCounts.approved})
                </TabsTrigger>
                <TabsTrigger value="rejected" className="flex items-center gap-2 rounded-lg">
                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                  Rejected ({statusCounts.rejected})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="all" className="mt-6">
                {renderApplicationList(filteredApplications)}
              </TabsContent>
              <TabsContent value="inReview" className="mt-6">
                {renderApplicationList(applications.filter(app => app.status === "inReview"))}
              </TabsContent>
              <TabsContent value="approved" className="mt-6">
                {renderApplicationList(applications.filter(app => app.status === "approved"))}
              </TabsContent>
              <TabsContent value="rejected" className="mt-6">
                {renderApplicationList(applications.filter(app => app.status === "rejected"))}
              </TabsContent>
            </Tabs>
          </motion.div>

          <div className="text-center">
            <Button
              onClick={() => navigate("/")}
              className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-bold py-3 px-8 rounded-2xl shadow-lg transform transition hover:-translate-y-1"
            >
              Return to Website
            </Button>
          </div>
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
        <div className="text-center py-12">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md mx-auto">
            <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-red-800 mb-2">Unable to Load Admin Dashboard</h3>
            <p className="text-red-600 mb-4 text-sm">
              {error.message || "There was an issue loading the applications data."}
            </p>
            <Button
              onClick={forceAdminRefresh}
              disabled={isLoading}
              variant="outline"
              size="sm"
              className="border-red-300 text-red-700 hover:bg-red-50"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-red-500 mr-2"></div>
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Try Again
                </>
              )}
            </Button>
          </div>
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
        className="space-y-4"
      >
        {apps.map((app: Application) => {
          const isExpanded = expandedCards.has(app.id);
          
          return (
            <motion.div key={app.id} variants={itemVariants} className="w-full">
              <Card className="overflow-hidden hover:shadow-lg transition-all duration-300 rounded-2xl border border-gray-200/60 hover:border-gray-300/60 bg-white backdrop-blur-sm">
                
                {/* COMPACT VIEW - Always Visible */}
                <CardContent className="p-0">
                  <div className={`p-6 border-l-4 ${getStatusBadgeColor(app.status)}`}>
                    <div className="flex items-start justify-between gap-4">
                      
                      {/* Left side: Main Info */}
                      <div className="flex-1 space-y-4">
                        {/* Header with name and status */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                              <UserIcon className="h-5 w-5 text-gray-600" />
                            </div>
                            <div>
                              <h3 className="font-semibold text-lg text-gray-900">{app.fullName}</h3>
                              <div className="flex items-center gap-2 text-sm text-gray-500">
                                <Hash className="h-3 w-3" />
                                <span>#{app.id}</span>
                                <span>•</span>
                                <Calendar className="h-3 w-3" />
                                <span>{new Date(app.createdAt).toLocaleDateString()}</span>
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            {getStatusIcon(app.status)}
                            <Badge className={`px-3 py-1 ${getStatusBadgeColor(app.status).replace('border-l-4', '').replace('border-', 'bg-').replace('-500', '-100 text-').replace('-600', '-800')}`}>
                              {formatApplicationStatus(app.status)}
                            </Badge>
                          </div>
                        </div>

                        {/* Contact Information Row */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <Mail className="h-4 w-4 text-gray-400" />
                            <span className="truncate">{app.email}</span>
                          </div>
                          {app.phone && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <Phone className="h-4 w-4 text-gray-400" />
                              <span>{app.phone}</span>
                            </div>
                          )}
                        </div>
                        
                        {/* Certification Status Indicators */}
                        <div className="flex flex-wrap gap-3">
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 border">
                            {getCertificationIcon(app.foodSafetyLicense)}
                            <span className="text-sm font-medium">Food Safety: {formatCertificationStatus(app.foodSafetyLicense)}</span>
                          </div>
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 border">
                            {getCertificationIcon(app.foodEstablishmentCert)}
                            <span className="text-sm font-medium">Establishment: {formatCertificationStatus(app.foodEstablishmentCert)}</span>
                          </div>
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 border">
                            <span className="text-sm font-medium">Kitchen: {formatKitchenPreference(app.kitchenPreference)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Right side: Action buttons */}
                      <div className="flex flex-col items-end gap-3">
                        <div className="flex items-center gap-2">
                          {getCtaButton(app)}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleCardExpansion(app.id)}
                            className="h-9 w-9 rounded-xl hover:bg-gray-100"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                        
                        {/* Document Status Indicators (for approved applications) */}
                        {app.status === "approved" && (
                          <div className="flex flex-col gap-1 text-right">
                            {app.foodSafetyLicenseUrl && (
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-gray-500">FSL:</span>
                                {getDocumentStatusBadge(app.foodSafetyLicenseStatus)}
                              </div>
                            )}
                            {app.foodEstablishmentCertUrl && (
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-gray-500">FEC:</span>
                                {getDocumentStatusBadge(app.foodEstablishmentCertStatus)}
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* Quick Document Links */}
                        {(app.foodSafetyLicenseUrl || app.foodEstablishmentCertUrl) && (
                          <div className="flex gap-1">
                            {app.foodSafetyLicenseUrl && (
                              <a 
                                href={app.foodSafetyLicenseUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                                title="View Food Safety License Document"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="h-3 w-3" />
                                FSL
                              </a>
                            )}
                            {app.foodEstablishmentCertUrl && (
                              <a 
                                href={app.foodEstablishmentCertUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 px-2 py-1 text-xs bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
                                title="View Food Establishment Certificate Document"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="h-3 w-3" />
                                FEC
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* EXPANDED VIEW - Only visible when expanded */}
                  {isExpanded && (
                    <div className="p-6 bg-gradient-to-br from-gray-50 to-gray-100/50 border-t">
                      {/* Status Notices */}
                      {app.status === "cancelled" && (
                        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                              <XCircle className="h-4 w-4 text-red-600" />
                            </div>
                            <div>
                              <h4 className="text-sm font-semibold text-red-800">Application Cancelled</h4>
                              <p className="text-xs text-red-700 mt-1">
                                This application has been cancelled and cannot be modified. All controls are disabled.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Contact Information Card */}
                      <div className="mb-6 p-5 bg-white rounded-xl border border-gray-200 shadow-sm">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                            <Mail className="h-4 w-4 text-blue-600" />
                          </div>
                          <h4 className="text-sm font-semibold text-gray-900">Contact Information</h4>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                            <Mail className="h-4 w-4 text-gray-400" />
                            <div>
                              <span className="text-xs text-gray-500 block">Email Address</span>
                              <span className="text-sm font-medium text-gray-900">{app.email}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                            <Phone className="h-4 w-4 text-gray-400" />
                            <div>
                              <span className="text-xs text-gray-500 block">Phone Number</span>
                              <span className="text-sm font-medium text-gray-900">{app.phone || 'Not provided'}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Detailed Certification Status Card */}
                      <div className="mb-6 p-5 bg-white rounded-xl border border-gray-200 shadow-sm">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                            <Shield className="h-4 w-4 text-green-600" />
                          </div>
                          <h4 className="text-sm font-semibold text-gray-900">Certifications & Preferences</h4>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="p-4 bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-xl border border-blue-200">
                            <div className="flex items-center gap-2 mb-2">
                              {getCertificationIcon(app.foodSafetyLicense)}
                              <h5 className="text-xs font-medium text-blue-800">Food Safety License</h5>
                            </div>
                            <p className="font-semibold text-sm text-blue-900">{formatCertificationStatus(app.foodSafetyLicense)}</p>
                          </div>
                          <div className="p-4 bg-gradient-to-br from-green-50 to-green-100/50 rounded-xl border border-green-200">
                            <div className="flex items-center gap-2 mb-2">
                              {getCertificationIcon(app.foodEstablishmentCert)}
                              <h5 className="text-xs font-medium text-green-800">Food Establishment Cert</h5>
                            </div>
                            <p className="font-semibold text-sm text-green-900">{formatCertificationStatus(app.foodEstablishmentCert)}</p>
                          </div>
                          <div className="p-4 bg-gradient-to-br from-purple-50 to-purple-100/50 rounded-xl border border-purple-200">
                            <div className="flex items-center gap-2 mb-2">
                              <UserIcon className="h-4 w-4 text-purple-600" />
                              <h5 className="text-xs font-medium text-purple-800">Kitchen Preference</h5>
                            </div>
                            <p className="font-semibold text-sm text-purple-900">{formatKitchenPreference(app.kitchenPreference)}</p>
                          </div>
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
