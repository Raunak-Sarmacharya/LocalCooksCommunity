import AdminProtectedRoute from "@/components/admin/AdminProtectedRoute";
import PromoCodeSender from "@/components/admin/PromoCodeSender";
import ChefKitchenAccessManager from "@/components/admin/ChefKitchenAccessManager";
import DamageClaimReview from "@/components/admin/DamageClaimReview";
import DamageClaimSettings from "@/components/admin/DamageClaimSettings";
import OverstayPenaltySettings from "@/components/admin/OverstayPenaltySettings";
import EscalatedPenalties from "@/components/admin/EscalatedPenalties";
import { AdminLayout } from "@/components/admin/layout/AdminLayout";
import type { AdminSection } from "@/components/admin/layout/AdminSidebar";
import { KitchenLicenseApprovalSection } from "@/components/admin/sections/KitchenLicenseApprovalSection";
import { PlatformSettingsSection } from "@/components/admin/sections/PlatformSettingsSection";
import { ManagerRevenuesSection } from "@/components/admin/sections/ManagerRevenuesSection";
import { PlatformOverviewSection } from "@/components/admin/sections/PlatformOverviewSection";
import { AdminTransactionHistory } from "@/components/admin/sections/AdminTransactionHistory";
import AdminOverstayPenalties from "@/components/admin/sections/AdminOverstayPenalties";
import AdminDamageClaimsHistory from "@/components/admin/sections/AdminDamageClaimsHistory";
import {
  formatApplicationStatus,
  formatCertificationStatus,
  formatKitchenPreference
} from "@/lib/applicationSchema";
import { Application } from "@shared/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import React, { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";

// Safe Icon Component to prevent crashes
function SafeIcon({ IconComponent, fallback = UserIcon, className, ...props }: any) {
  try {
    if (IconComponent) {
      return <IconComponent className={className} {...props} />;
    }
    const FallbackComponent = fallback;
    return <FallbackComponent className={className} {...props} />;
  } catch (error) {
    console.warn('Icon render error:', error);
    return <UserIcon className={className} {...props} />;
  }
}

// Error Boundary Component
class ErrorBoundary extends React.Component<{ children: React.ReactNode, fallback?: React.ReactNode }, { hasError: boolean }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('Component error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-600 text-sm">Something went wrong. Please refresh the page.</p>
        </div>
      );
    }

    return this.props.children;
  }
}

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ChangePassword from "@/components/auth/ChangePassword";
import { useToast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import ResponsiveTable from "@/components/ui/responsive-table";
import { AdminOverviewSection } from "@/components/admin/sections/AdminOverviewSection";
import { SecuritySettingsSection } from "@/components/admin/sections/SecuritySettingsSection";
import {
  AlertCircle,
  AlertTriangle,
  CalendarDays,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  RefreshCw,
  Search,
  Shield,
  User as UserIcon,
  XCircle,
  Save,
  DollarSign,
  FileText,
  Check,
  X,
  Users,
  Building2,
  Loader2
} from "lucide-react";

function AdminDashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());
  // Read section from URL query params (same pattern as manager dashboard ?view=)
  const validSections: AdminSection[] = [
    "applications", "kitchen-licenses", "damage-claims", "escalated-penalties",
    "chef-kitchen-access", "kitchen-management", "promos", "manager-revenues",
    "platform-overview", "platform-settings", "overstay-settings",
    "damage-claim-settings", "account-settings", "overview", "transactions",
    "security-settings",
  ];
  const [activeSection, setActiveSection] = useState<AdminSection>(() => {
    const params = new URLSearchParams(window.location.search);
    const section = params.get('section');
    if (section && validSections.includes(section as AdminSection)) {
      return section as AdminSection;
    }
    return "overview";
  });

  // Sync URL when section changes
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const currentSection = params.get('section');
    if (currentSection !== activeSection) {
      window.history.replaceState({}, '', `/admin?section=${activeSection}`);
    }
  }, [activeSection]);

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const section = params.get('section');
      if (section && validSections.includes(section as AdminSection)) {
        setActiveSection(section as AdminSection);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const [quickFilters, setQuickFilters] = useState({
    needsDocumentReview: false,
    recentApplications: false,
    hasDocuments: false
  });
  const [presignedUrls, setPresignedUrls] = useState<Record<string, string>>({});
  const [loadingUrls, setLoadingUrls] = useState<Set<string>>(new Set());

  // Function to get presigned URL for R2 files
  const getPresignedUrl = async (fileUrl: string): Promise<string> => {
    // Check if we already have a presigned URL cached
    if (presignedUrls[fileUrl]) {
      return presignedUrls[fileUrl];
    }

    // Check if URL is already being loaded
    if (loadingUrls.has(fileUrl)) {
      await new Promise(resolve => setTimeout(resolve, 100));
      return getPresignedUrl(fileUrl);
    }

    // Check if it's a public R2 URL - these don't need presigning
    if (fileUrl.includes('.r2.dev/')) {
      return fileUrl;
    }

    // Check if it's a private R2 URL or custom domain (needs presigning)
    const isR2Url = fileUrl.includes('r2.cloudflarestorage.com') ||
      fileUrl.includes('files.localcooks.ca');

    if (!isR2Url) {
      return fileUrl;
    }

    try {
      setLoadingUrls(prev => new Set(prev).add(fileUrl));

      const token = await getFirebaseToken();
      const response = await fetch(`/api/files/r2-presigned?url=${encodeURIComponent(fileUrl)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed to get presigned URL: ${response.statusText}`);
      }

      const data = await response.json();
      const presignedUrl = data.url || fileUrl;

      setPresignedUrls(prev => ({ ...prev, [fileUrl]: presignedUrl }));
      return presignedUrl;
    } catch (error) {
      console.error('Error getting presigned URL:', error);
      return fileUrl;
    } finally {
      setLoadingUrls(prev => {
        const next = new Set(prev);
        next.delete(fileUrl);
        return next;
      });
    }
  };

  // Admin uses Firebase auth (session auth removed)
  const { user: firebaseUser, logout } = useFirebaseAuth();

  // Helper function to get Firebase token for API calls
  const getFirebaseToken = async (): Promise<string> => {
    const currentFirebaseUser = auth.currentUser;
    if (!currentFirebaseUser) {
      throw new Error("Firebase user not available");
    }
    return await currentFirebaseUser.getIdToken();
  };

  const { data: sessionUser, isLoading: sessionLoading } = useQuery({
    queryKey: ["/api/user/profile", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return null;
      try {
        const token = await getFirebaseToken();
        const response = await fetch("/api/user/profile", {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          if (response.status === 401) {
            return null; // Not authenticated
          }
          throw new Error(`Firebase auth failed: ${response.status}`);
        }

        const userData = await response.json();
        console.log('Admin Dashboard - Firebase user data:', userData);
        return userData;
      } catch (error) {
        console.error('Admin Dashboard - Firebase auth error:', error);
        return null;
      }
    },
    enabled: !!firebaseUser,
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

  // Fetch pending kitchen licenses count
  const { data: pendingLicensesCount = 0 } = useQuery({
    queryKey: ['/api/admin/locations/pending-licenses-count'],
    queryFn: async () => {
      const token = await getFirebaseToken();
      const response = await fetch('/api/admin/locations/pending-licenses', {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) return 0;
      const data = await response.json();
      return Array.isArray(data) ? data.length : 0;
    },
    enabled: !!firebaseUser && isAdmin,
    refetchInterval: 30000,
  });

  // Fetch all applications - Firebase auth
  const { data: applications = [], isLoading, error } = useQuery<Application[]>({
    queryKey: ["/api/applications"],
    queryFn: async ({ queryKey }) => {
      if (!firebaseUser) {
        throw new Error("Admin not authenticated");
      }

      console.log('Admin: Fetching applications data via Firebase auth...', {
        endpoint: queryKey[0],
        hasFirebaseUser: !!firebaseUser
      });

      // Get Firebase token for authentication
      const token = await getFirebaseToken();

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
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
    enabled: !!firebaseUser && isAdmin, // Only fetch if user is admin
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

        const token = await getFirebaseToken();
        const headers: Record<string, string> = {
          'Authorization': `Bearer ${token}`,
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
        queryClient.invalidateQueries({ queryKey: ["/api/applications/my-applications"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/firebase/applications/my"] })
      ]);

      toast.success("Status updated", {
        description: `Application status changed to ${data.status}. Email notification sent.`
      });

      console.log('Status update successful with email notification:', data);
    },
    onError: (error) => {
      toast.error("Error updating status", {
        description: error.message || "Please try again."
      });
    },
  });

  // Mutation to update document verification status
  const updateDocumentStatusMutation = useMutation({
    mutationFn: async ({ id, field, status }: { id: number, field: string, status: string }) => {
      const token = await getFirebaseToken();
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
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
        queryClient.invalidateQueries({ queryKey: ["/api/applications/my-applications"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/firebase/applications/my"] })
      ]);

      // Additional delayed refresh to catch any async database updates
      setTimeout(async () => {
        await forceAdminRefresh();
      }, 1000);

      toast.success("Document status updated", {
        description: `${variables.field === 'foodSafetyLicenseStatus' ? 'Food Safety License' : 'Food Establishment Certificate'} status changed to ${variables.status}. Email notification sent to user.`
      });

      console.log('Admin: Document status updated', {
        applicationId: variables.id,
        field: variables.field,
        newStatus: variables.status,
        timestamp: new Date().toISOString()
      });
    },
    onError: (error) => {
      toast.error("Error updating document status", {
        description: error.message || "Please try again."
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

  // Helper function to get status badge color
  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "inReview":
        return "border-l-amber-500";
      case "approved":
        return "border-l-green-500";
      case "rejected":
        return "border-l-red-500";
      case "cancelled":
        return "border-l-gray-500";
      default:
        return "border-l-gray-400";
    }
  };

  // Helper function to get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "inReview":
        return (
          <Badge className="px-2 sm:px-3 py-1 text-xs sm:text-sm bg-amber-100 text-amber-800 border-amber-300">
            <Clock className="h-3 w-3 mr-1" />
            In Review
          </Badge>
        );
      case "approved":
        return (
          <Badge className="px-2 sm:px-3 py-1 text-xs sm:text-sm bg-green-100 text-green-800 border-green-300">
            <CheckCircle className="h-3 w-3 mr-1" />
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge className="px-2 sm:px-3 py-1 text-xs sm:text-sm bg-red-100 text-red-800 border-red-300">
            <XCircle className="h-3 w-3 mr-1" />
            Rejected
          </Badge>
        );
      case "cancelled":
        return (
          <Badge className="px-2 sm:px-3 py-1 text-xs sm:text-sm bg-gray-100 text-gray-800 border-gray-300">
            <XCircle className="h-3 w-3 mr-1" />
            Cancelled
          </Badge>
        );
      default:
        return (
          <Badge className="px-2 sm:px-3 py-1 text-xs sm:text-sm bg-gray-100 text-gray-800 border-gray-300">
            Unknown
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
      matchesQuickFilters = matchesQuickFilters && Boolean(
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
        ["/api/firebase/admin/applications"],
        ["/api/applications/my-applications"],
        ["/api/firebase/applications/my"]
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
          queryKey: ["/api/firebase/admin/applications"],
          type: 'all'
        }),
        queryClient.refetchQueries({
          queryKey: ["/api/applications/my-applications"],
          type: 'all'
        }),
        queryClient.refetchQueries({
          queryKey: ["/api/firebase/applications/my"],
          type: 'all'
        })
      ]);

      console.log('Admin: Comprehensive refresh completed');
    } catch (error) {
      console.error('Admin: Force refresh failed', error);
      // Fallback: try to refresh just the admin query
      try {
        await queryClient.refetchQueries({ queryKey: ["/api/firebase/admin/applications"] });
        console.log('Admin: Fallback refresh completed');
      } catch (fallbackError) {
        console.error('Admin: Fallback refresh also failed', fallbackError);
      }
    }
  };

  // Handle logout - Firebase-based
  const handleLogoutAction = async () => {
    try {
      await logout();
      queryClient.clear();
      navigate('/admin');
    } catch (error) {
      console.error('Logout error:', error);
      navigate('/admin');
    }
  };

  // Render the active section content
  const renderSectionContent = () => {
    switch (activeSection) {
      case "overview":
        return (
          <AdminOverviewSection
            onNavigate={setActiveSection}
            pendingReviewCount={statusCounts.inReview}
            pendingLicensesCount={0}
          />
        );

      case "applications":
        return (
          <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-100">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Approved</p>
                      <p className="text-xl font-bold">{statusCounts.approved}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-yellow-100">
                      <Clock className="h-4 w-4 text-yellow-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">In Review</p>
                      <p className="text-xl font-bold">{statusCounts.inReview}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-100">
                      <XCircle className="h-4 w-4 text-red-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Rejected</p>
                      <p className="text-xl font-bold">{statusCounts.rejected}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100">
                      <Shield className="h-4 w-4 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Doc Review</p>
                      <p className="text-xl font-bold">
                        {applications.filter(app =>
                          app.status === "approved" && (
                            app.foodSafetyLicenseStatus === "pending" ||
                            app.foodEstablishmentCertStatus === "pending"
                          )
                        ).length}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100">
                      <UserIcon className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total</p>
                      <p className="text-xl font-bold">{statusCounts.total}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Search Bar */}
            <div className="relative w-full sm:max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by name, email, phone, or ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Quick Filter Buttons */}
            <div>
              <h4 className="text-sm font-medium mb-2">Quick Filters</h4>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={quickFilters.needsDocumentReview ? "default" : "outline"}
                  size="sm"
                  onClick={() => setQuickFilters(prev => ({ ...prev, needsDocumentReview: !prev.needsDocumentReview }))}
                >
                  <Shield className="h-3.5 w-3.5 mr-1.5" />
                  Doc Review
                  {applications.filter(app =>
                    app.status === "approved" && (
                      app.foodSafetyLicenseStatus === "pending" ||
                      app.foodEstablishmentCertStatus === "pending"
                    )
                  ).length > 0 && (
                    <Badge variant="destructive" className="ml-1.5 h-5 min-w-5 rounded-full px-1 text-[10px]">
                      {applications.filter(app =>
                        app.status === "approved" && (
                          app.foodSafetyLicenseStatus === "pending" ||
                          app.foodEstablishmentCertStatus === "pending"
                        )
                      ).length}
                    </Badge>
                  )}
                </Button>
                <Button
                  variant={quickFilters.recentApplications ? "default" : "outline"}
                  size="sm"
                  onClick={() => setQuickFilters(prev => ({ ...prev, recentApplications: !prev.recentApplications }))}
                >
                  <CalendarDays className="h-3.5 w-3.5 mr-1.5" />
                  Recent (3 days)
                </Button>
                <Button
                  variant={quickFilters.hasDocuments ? "default" : "outline"}
                  size="sm"
                  onClick={() => setQuickFilters(prev => ({ ...prev, hasDocuments: !prev.hasDocuments }))}
                >
                  <UserIcon className="h-3.5 w-3.5 mr-1.5" />
                  Has Documents
                </Button>
                {(quickFilters.needsDocumentReview || quickFilters.recentApplications || quickFilters.hasDocuments) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setQuickFilters({ needsDocumentReview: false, recentApplications: false, hasDocuments: false })}
                  >
                    Clear All
                  </Button>
                )}
              </div>
            </div>

            {/* Status Tabs */}
            <Tabs defaultValue="all" className="w-full">
              <TabsList>
                <TabsTrigger value="all">All ({statusCounts.total})</TabsTrigger>
                <TabsTrigger value="inReview">Review ({statusCounts.inReview})</TabsTrigger>
                <TabsTrigger value="approved">Approved ({statusCounts.approved})</TabsTrigger>
                <TabsTrigger value="rejected">Rejected ({statusCounts.rejected})</TabsTrigger>
              </TabsList>
              <TabsContent value="all" className="mt-4">
                {renderApplicationList(filteredApplications)}
              </TabsContent>
              <TabsContent value="inReview" className="mt-4">
                {renderApplicationList(applications.filter(app => app.status === "inReview"))}
              </TabsContent>
              <TabsContent value="approved" className="mt-4">
                {renderApplicationList(applications.filter(app => app.status === "approved"))}
              </TabsContent>
              <TabsContent value="rejected" className="mt-4">
                {renderApplicationList(applications.filter(app => app.status === "rejected"))}
              </TabsContent>
            </Tabs>
          </div>
        );

      case "kitchen-licenses":
        return <KitchenLicenseApprovalSection />;

      case "damage-claims":
        return (
          <ErrorBoundary>
            <DamageClaimReview />
          </ErrorBoundary>
        );

      case "escalated-penalties":
        return (
          <ErrorBoundary>
            <EscalatedPenalties />
          </ErrorBoundary>
        );

      case "chef-kitchen-access":
        return <ChefKitchenAccessManager />;

      case "kitchen-management":
        return (
          <Card>
            <CardContent className="p-12 text-center">
              <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">Kitchen Management</h3>
              <p className="text-muted-foreground mb-6">Create and manage commercial kitchen locations and facilities</p>
              <Button onClick={() => navigate("/admin/manage-locations")}>
                Open Kitchen Management
              </Button>
            </CardContent>
          </Card>
        );

      case "promos":
        return <PromoCodeSender />;

      case "transactions":
        return (
          <ErrorBoundary>
            <AdminTransactionHistory getFirebaseToken={getFirebaseToken} />
          </ErrorBoundary>
        );

      case "overstay-penalties-history":
        return (
          <ErrorBoundary>
            <AdminOverstayPenalties getFirebaseToken={getFirebaseToken} />
          </ErrorBoundary>
        );

      case "damage-claims-history":
        return (
          <ErrorBoundary>
            <AdminDamageClaimsHistory getFirebaseToken={getFirebaseToken} />
          </ErrorBoundary>
        );

      case "manager-revenues":
        return <ManagerRevenuesSection getFirebaseToken={getFirebaseToken} />;

      case "platform-overview":
        return <PlatformOverviewSection getFirebaseToken={getFirebaseToken} />;

      case "platform-settings":
        return <PlatformSettingsSection />;

      case "overstay-settings":
        return (
          <ErrorBoundary>
            <OverstayPenaltySettings />
          </ErrorBoundary>
        );

      case "damage-claim-settings":
        return <DamageClaimSettings />;

      case "security-settings":
        return (
          <ErrorBoundary>
            <SecuritySettingsSection />
          </ErrorBoundary>
        );

      case "account-settings":
        return (
          <div className="max-w-2xl">
            <div className="mb-6">
              <h3 className="text-xl font-semibold mb-2">Account Settings</h3>
              <p className="text-muted-foreground">Manage your admin account password</p>
            </div>
            <ChangePassword role="admin" />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <ErrorBoundary fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center p-8">
          <h2 className="text-xl font-semibold mb-2">Admin Dashboard Error</h2>
          <p className="text-muted-foreground mb-4">Something went wrong. Please refresh the page.</p>
          <Button onClick={() => window.location.reload()}>Refresh Page</Button>
        </div>
      </div>
    }>
      <AdminLayout
        activeSection={activeSection}
        onSectionChange={(section) => {
          if (section === 'kitchen-management') {
            navigate('/admin/manage-locations');
            return;
          }
          setActiveSection(section);
        }}
        onLogout={handleLogoutAction}
        onRefresh={forceAdminRefresh}
        isRefreshing={isLoading}
        pendingReviewCount={statusCounts.inReview}
        pendingLicensesCount={pendingLicensesCount}
      >
        {renderSectionContent()}
      </AdminLayout>
    </ErrorBoundary>
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
              <Card className="overflow-hidden hover:shadow-lg transition-all duration-300 rounded-xl sm:rounded-2xl border border-gray-200/60 hover:border-gray-300/60 bg-white backdrop-blur-sm card-hover">

                {/* COMPACT VIEW - Always Visible */}
                <CardContent className="p-0">
                  <div className={`p-3 sm:p-4 lg:p-6 border-l-4 ${getStatusBadgeColor(app.status)}`}>
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">

                      {/* Left side: Main Info */}
                      <div className="flex-1 space-y-3 sm:space-y-4 min-w-0">
                        {/* Header with name and status */}
                        <div className="flex flex-col xs:flex-row xs:items-center xs:justify-between gap-2 xs:gap-3">
                          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center flex-shrink-0">
                              <UserIcon className="h-4 w-4 sm:h-5 sm:w-5 text-gray-600" />
                            </div>
                            <div className="min-w-0">
                              <h3 className="font-semibold text-base sm:text-lg text-gray-900 truncate">{app.fullName}</h3>
                              <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-500">
                                <UserIcon className="h-3 w-3 flex-shrink-0" />
                                <span>#{app.id}</span>
                                <span className="hidden xs:inline">•</span>
                                <CalendarDays className="h-3 w-3 flex-shrink-0 hidden xs:block" />
                                <span className="hidden xs:inline truncate">{new Date(app.createdAt).toLocaleDateString()}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                            {getStatusIcon(app.status)}
                            <Badge className={`px-2 sm:px-3 py-1 text-xs sm:text-sm ${getStatusBadgeColor(app.status).replace('border-l-4', '').replace('border-', 'bg-').replace('-500', '-100 text-').replace('-600', '-800')}`}>
                              {formatApplicationStatus(app.status)}
                            </Badge>
                          </div>
                        </div>

                        {/* Contact Information Row */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
                          <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-600 min-w-0">
                            <UserIcon className="h-3 w-3 sm:h-4 sm:w-4 text-gray-400 flex-shrink-0" />
                            <span className="truncate">{app.email}</span>
                          </div>
                          {app.phone && (
                            <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-600 min-w-0">
                              <UserIcon className="h-3 w-3 sm:h-4 sm:w-4 text-gray-400 flex-shrink-0" />
                              <span className="truncate">{app.phone}</span>
                            </div>
                          )}
                        </div>

                        {/* Certification Status Indicators */}
                        <div className="flex flex-wrap gap-1.5 sm:gap-3">
                          <div className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg bg-gray-50 border">
                            {getCertificationIcon(app.foodSafetyLicense)}
                            <span className="text-xs sm:text-sm font-medium">
                              <span className="hidden sm:inline">Food Safety: </span>
                              <span className="sm:hidden">FSL: </span>
                              {formatCertificationStatus(app.foodSafetyLicense)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg bg-gray-50 border">
                            {getCertificationIcon(app.foodEstablishmentCert)}
                            <span className="text-xs sm:text-sm font-medium">
                              <span className="hidden lg:inline">Establishment: </span>
                              <span className="lg:hidden">Est: </span>
                              {formatCertificationStatus(app.foodEstablishmentCert)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg bg-gray-50 border">
                            <span className="text-xs sm:text-sm font-medium">
                              <span className="hidden sm:inline">Kitchen: </span>
                              <span className="sm:hidden">Kit: </span>
                              {formatKitchenPreference(app.kitchenPreference)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right side: Action buttons */}
                      <div className="flex sm:flex-col items-center sm:items-end gap-2 sm:gap-3 w-full sm:w-auto">
                        <div className="flex items-center gap-1.5 sm:gap-2 flex-1 sm:flex-none">
                          {getCtaButton(app)}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleCardExpansion(app.id)}
                            className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg sm:rounded-xl hover:bg-gray-100 flex-shrink-0"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
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
                                href={presignedUrls[app.foodSafetyLicenseUrl] || app.foodSafetyLicenseUrl || '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                                title="View Food Safety License Document"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const url = app.foodSafetyLicenseUrl;
                                  if (url && !presignedUrls[url]) {
                                    e.preventDefault();
                                    const presignedUrl = await getPresignedUrl(url);
                                    window.open(presignedUrl, '_blank');
                                  }
                                }}
                              >
                                {loadingUrls.has(app.foodSafetyLicenseUrl) ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <ExternalLink className="h-3 w-3" />
                                )}
                                FSL
                              </a>
                            )}
                            {app.foodEstablishmentCertUrl && (
                              <a
                                href={presignedUrls[app.foodEstablishmentCertUrl] || app.foodEstablishmentCertUrl || '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 px-2 py-1 text-xs bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
                                title="View Food Establishment Certificate Document"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const url = app.foodEstablishmentCertUrl;
                                  if (url && !presignedUrls[url]) {
                                    e.preventDefault();
                                    const presignedUrl = await getPresignedUrl(url);
                                    window.open(presignedUrl, '_blank');
                                  }
                                }}
                              >
                                {loadingUrls.has(app.foodEstablishmentCertUrl) ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <ExternalLink className="h-3 w-3" />
                                )}
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
                    <div className="p-3 sm:p-4 lg:p-6 bg-gradient-to-br from-gray-50 to-gray-100/50 border-t">
                      {/* Status Notices */}
                      {app.status === "cancelled" && (
                        <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-red-50 border border-red-200 rounded-lg sm:rounded-xl">
                          <div className="flex items-center gap-2 sm:gap-3">
                            <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-md sm:rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
                              <XCircle className="h-3 w-3 sm:h-4 sm:w-4 text-red-600" />
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-xs sm:text-sm font-semibold text-red-800">Application Cancelled</h4>
                              <p className="text-xs text-red-700 mt-1">
                                This application has been cancelled and cannot be modified.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Contact Information Card */}
                      <div className="mb-4 sm:mb-6 p-3 sm:p-5 bg-white rounded-lg sm:rounded-xl border border-gray-200 shadow-sm">
                        <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
                          <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-md sm:rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                            <UserIcon className="h-3 w-3 sm:h-4 sm:w-4 text-blue-600" />
                          </div>
                          <h4 className="text-xs sm:text-sm font-semibold text-gray-900">Contact Information</h4>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                          <div className="flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 bg-gray-50 rounded-md sm:rounded-lg">
                            <UserIcon className="h-3 w-3 sm:h-4 sm:w-4 text-gray-400 flex-shrink-0" />
                            <div className="min-w-0">
                              <span className="text-xs text-gray-500 block">Email</span>
                              <span className="text-xs sm:text-sm font-medium text-gray-900 truncate block">{app.email}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 bg-gray-50 rounded-md sm:rounded-lg">
                            <UserIcon className="h-3 w-3 sm:h-4 sm:w-4 text-gray-400 flex-shrink-0" />
                            <div className="min-w-0">
                              <span className="text-xs text-gray-500 block">Phone</span>
                              <span className="text-xs sm:text-sm font-medium text-gray-900 truncate block">{app.phone || 'Not provided'}</span>
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
                        <div className="mb-4 p-6 bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200 rounded-xl shadow-sm">
                          <h4 className="text-sm font-semibold mb-4 text-indigo-800 flex items-center gap-2">
                            <Shield className="h-5 w-5" />
                            Document Verification
                          </h4>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                            {/* Food Safety License Document */}
                            <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
                              <h5 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                                <Shield className="h-4 w-4 text-indigo-600" />
                                Food Safety License
                              </h5>
                              {app.foodSafetyLicenseUrl ? (
                                <div className="space-y-3">
                                  <a
                                    href={presignedUrls[app.foodSafetyLicenseUrl] || getR2ProxyUrl(app.foodSafetyLicenseUrl)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium hover:underline transition-colors"
                                    onClick={async (e) => {
                                      const url = app.foodSafetyLicenseUrl;
                                      if (url && !presignedUrls[url] && url.includes('r2.cloudflarestorage.com')) {
                                        e.preventDefault();
                                        const presignedUrl = await getPresignedUrl(url);
                                        window.open(presignedUrl, '_blank');
                                      }
                                    }}
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                    {app.foodSafetyLicenseUrl.startsWith('/api/files/') ? 'View Document' : 'External Link'}
                                  </a>
                                  <div className="flex items-center justify-between">
                                    {getDocumentStatusBadge(app.foodSafetyLicenseStatus)}
                                    {app.foodSafetyLicenseStatus === "approved" && (
                                      <span className="text-xs text-green-600 font-medium">✓ Verified</span>
                                    )}
                                    {app.foodSafetyLicenseStatus === "rejected" && (
                                      <span className="text-xs text-red-600 font-medium">✗ Rejected</span>
                                    )}
                                  </div>

                                  {/* FSL Approval Controls - Only show if status is pending */}
                                  {app.foodSafetyLicenseStatus === "pending" && (
                                    <div className="flex gap-2 pt-2">
                                      <Button
                                        size="sm"
                                        onClick={() => handleDocumentStatusUpdate(app.id, 'foodSafetyLicenseStatus', 'approved')}
                                        className="text-xs px-3 py-2 h-auto bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
                                      >
                                        <CheckCircle className="h-3 w-3 mr-1" />
                                        Approve
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleDocumentStatusUpdate(app.id, 'foodSafetyLicenseStatus', 'rejected')}
                                        className="text-xs px-3 py-2 h-auto text-red-600 border-red-200 hover:bg-red-50 rounded-lg font-medium transition-colors"
                                      >
                                        <XCircle className="h-3 w-3 mr-1" />
                                        Reject
                                      </Button>
                                    </div>
                                  )}

                                  {/* Admin Override - Subtle option to change status for already processed documents */}
                                  {(app.foodSafetyLicenseStatus === "approved" || app.foodSafetyLicenseStatus === "rejected") && (
                                    <details className="mt-2">
                                      <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 transition-colors">
                                        🔧 Admin Override
                                      </summary>
                                      <div className="flex gap-1 pt-2">
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => handleDocumentStatusUpdate(app.id, 'foodSafetyLicenseStatus', 'approved')}
                                          className={`text-xs px-2 py-1 h-auto rounded transition-colors ${app.foodSafetyLicenseStatus === 'approved'
                                            ? 'bg-emerald-100 text-emerald-700 cursor-default'
                                            : 'text-emerald-600 hover:bg-emerald-50'
                                            }`}
                                          disabled={app.foodSafetyLicenseStatus === 'approved'}
                                        >
                                          ✓ Approve
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => handleDocumentStatusUpdate(app.id, 'foodSafetyLicenseStatus', 'rejected')}
                                          className={`text-xs px-2 py-1 h-auto rounded transition-colors ${app.foodSafetyLicenseStatus === 'rejected'
                                            ? 'bg-red-100 text-red-700 cursor-default'
                                            : 'text-red-600 hover:bg-red-50'
                                            }`}
                                          disabled={app.foodSafetyLicenseStatus === 'rejected'}
                                        >
                                          ✗ Reject
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => handleDocumentStatusUpdate(app.id, 'foodSafetyLicenseStatus', 'pending')}
                                          className="text-xs px-2 py-1 h-auto text-yellow-600 hover:bg-yellow-50 rounded transition-colors"
                                        >
                                          ⏳ Reset to Pending
                                        </Button>
                                      </div>
                                    </details>
                                  )}
                                </div>
                              ) : (
                                <div className="text-center py-4 text-gray-500 text-sm bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                                  No document uploaded
                                </div>
                              )}
                            </div>

                            {/* Food Establishment Certificate Document */}
                            <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
                              <h5 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                                <Shield className="h-4 w-4 text-indigo-600" />
                                Food Establishment Certificate
                              </h5>
                              {app.foodEstablishmentCertUrl ? (
                                <div className="space-y-3">
                                  <a
                                    href={presignedUrls[app.foodEstablishmentCertUrl] || getR2ProxyUrl(app.foodEstablishmentCertUrl)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium hover:underline transition-colors"
                                    onClick={async (e) => {
                                      const url = app.foodEstablishmentCertUrl;
                                      if (url && !presignedUrls[url] && url.includes('r2.cloudflarestorage.com')) {
                                        e.preventDefault();
                                        const presignedUrl = await getPresignedUrl(url);
                                        window.open(presignedUrl, '_blank');
                                      }
                                    }}
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                    {app.foodEstablishmentCertUrl.startsWith('/api/files/') ? 'View Document' : 'External Link'}
                                  </a>
                                  <div className="flex items-center justify-between">
                                    {getDocumentStatusBadge(app.foodEstablishmentCertStatus)}
                                    {app.foodEstablishmentCertStatus === "approved" && (
                                      <span className="text-xs text-green-600 font-medium">✓ Verified</span>
                                    )}
                                    {app.foodEstablishmentCertStatus === "rejected" && (
                                      <span className="text-xs text-red-600 font-medium">✗ Rejected</span>
                                    )}
                                  </div>

                                  {/* FEC Approval Controls - Only show if status is pending */}
                                  {app.foodEstablishmentCertStatus === "pending" && (
                                    <div className="flex gap-2 pt-2">
                                      <Button
                                        size="sm"
                                        onClick={() => handleDocumentStatusUpdate(app.id, 'foodEstablishmentCertStatus', 'approved')}
                                        className="text-xs px-3 py-2 h-auto bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
                                      >
                                        <CheckCircle className="h-3 w-3 mr-1" />
                                        Approve
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleDocumentStatusUpdate(app.id, 'foodEstablishmentCertStatus', 'rejected')}
                                        className="text-xs px-3 py-2 h-auto text-red-600 border-red-200 hover:bg-red-50 rounded-lg font-medium transition-colors"
                                      >
                                        <XCircle className="h-3 w-3 mr-1" />
                                        Reject
                                      </Button>
                                    </div>
                                  )}

                                  {/* Admin Override - Subtle option to change status for already processed documents */}
                                  {(app.foodEstablishmentCertStatus === "approved" || app.foodEstablishmentCertStatus === "rejected") && (
                                    <details className="mt-2">
                                      <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 transition-colors">
                                        🔧 Admin Override
                                      </summary>
                                      <div className="flex gap-1 pt-2">
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => handleDocumentStatusUpdate(app.id, 'foodEstablishmentCertStatus', 'approved')}
                                          className={`text-xs px-2 py-1 h-auto rounded transition-colors ${app.foodEstablishmentCertStatus === 'approved'
                                            ? 'bg-emerald-100 text-emerald-700 cursor-default'
                                            : 'text-emerald-600 hover:bg-emerald-50'
                                            }`}
                                          disabled={app.foodEstablishmentCertStatus === 'approved'}
                                        >
                                          ✓ Approve
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => handleDocumentStatusUpdate(app.id, 'foodEstablishmentCertStatus', 'rejected')}
                                          className={`text-xs px-2 py-1 h-auto rounded transition-colors ${app.foodEstablishmentCertStatus === 'rejected'
                                            ? 'bg-red-100 text-red-700 cursor-default'
                                            : 'text-red-600 hover:bg-red-50'
                                            }`}
                                          disabled={app.foodEstablishmentCertStatus === 'rejected'}
                                        >
                                          ✗ Reject
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => handleDocumentStatusUpdate(app.id, 'foodEstablishmentCertStatus', 'pending')}
                                          className="text-xs px-2 py-1 h-auto text-yellow-600 hover:bg-yellow-50 rounded transition-colors"
                                        >
                                          ⏳ Reset to Pending
                                        </Button>
                                      </div>
                                    </details>
                                  )}
                                </div>
                              ) : (
                                <div className="text-center py-4 text-gray-500 text-sm bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                                  No document uploaded
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Admin Feedback */}
                          {app.documentsAdminFeedback && (
                            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                              <div className="flex items-start gap-2">
                                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                                <div>
                                  <h6 className="text-sm font-medium text-amber-800 mb-1">Admin Feedback</h6>
                                  <p className="text-sm text-amber-700">{app.documentsAdminFeedback}</p>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Overall verification status summary */}
                          <div className="mt-4 pt-4 border-t border-indigo-100">
                            {(() => {
                              const fslApproved = app.foodSafetyLicenseStatus === "approved";
                              const fecApproved = !app.foodEstablishmentCertUrl || app.foodEstablishmentCertStatus === "approved";
                              const allApproved = fslApproved && fecApproved;
                              const anyRejected = app.foodSafetyLicenseStatus === "rejected" || app.foodEstablishmentCertStatus === "rejected";

                              if (allApproved) {
                                return (
                                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">
                                    <CheckCircle className="h-4 w-4" />
                                    All documents verified - Applicant ready for platform access
                                  </div>
                                );
                              } else if (anyRejected) {
                                return (
                                  <div className="flex items-center gap-2 text-sm font-medium text-red-700 bg-red-50 px-3 py-2 rounded-lg">
                                    <XCircle className="h-4 w-4" />
                                    Document(s) rejected - Applicant needs to resubmit
                                  </div>
                                );
                              } else {
                                return (
                                  <div className="flex items-center gap-2 text-sm font-medium text-yellow-700 bg-yellow-50 px-3 py-2 rounded-lg">
                                    <Clock className="h-4 w-4" />
                                    Pending review - Action required
                                  </div>
                                );
                              }
                            })()}
                          </div>
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

// Inline components removed — now imported from @/components/admin/sections/
// KitchenLicenseApprovalSection, PlatformSettingsSection, ManagerRevenuesSection, PlatformOverviewSection

export default function Admin() {
  return (
    <AdminProtectedRoute>
      <AdminDashboard />
    </AdminProtectedRoute>
  );
}

