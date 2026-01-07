import AdminProtectedRoute from "@/components/admin/AdminProtectedRoute";
import PromoCodeSender from "@/components/admin/PromoCodeSender";
import ChefKitchenAccessManager from "@/components/admin/ChefKitchenAccessManager";
import {
    formatApplicationStatus,
    formatCertificationStatus,
    formatKitchenPreference
} from "@/lib/applicationSchema";
import { Application } from "@shared/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import React, { useState, useEffect } from "react";
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
class ErrorBoundary extends React.Component<{children: React.ReactNode, fallback?: React.ReactNode}, {hasError: boolean}> {
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

import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ChangePassword from "@/components/auth/ChangePassword";
import { useToast } from "@/hooks/use-toast";
import AnimatedBackgroundOrbs from "@/components/ui/AnimatedBackgroundOrbs";
import FadeInSection from "@/components/ui/FadeInSection";
import {
    AlertCircle,
    AlertTriangle,
    CalendarDays,
    CheckCircle,
    ChevronDown,
    ChevronRight,
    Clock,
    ExternalLink,
    Gift,
    Mail,
    Phone,
    RefreshCw,
    Search,
    Settings,
    Shield,
    Truck,
    User as UserIcon,
    XCircle,
    Save,
    DollarSign,
    FileText,
    Check,
    X,
    Users,
    Building2,
    Menu
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
  const [activeCategory, setActiveCategory] = useState<string>("applications");
  const [activeTab, setActiveTab] = useState<string>("applications");

  // Update active tab when category changes
  useEffect(() => {
    if (activeCategory === "applications" && activeTab !== "applications" && activeTab !== "delivery-applications" && activeTab !== "kitchen-licenses") {
      setActiveTab("applications");
    } else if (activeCategory === "management" && activeTab !== "chef-kitchen-access" && activeTab !== "kitchen-management") {
      setActiveTab("chef-kitchen-access");
    } else if (activeCategory === "communications" && activeTab !== "promos") {
      setActiveTab("promos");
    } else if (activeCategory === "settings" && activeTab !== "platform-settings" && activeTab !== "account-settings") {
      setActiveTab("platform-settings");
    }
  }, [activeCategory, activeTab]);

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

  // Fetch pending kitchen licenses count
  const { data: pendingLicensesCount = 0 } = useQuery({
    queryKey: ['/api/admin/locations/pending-licenses-count'],
    queryFn: async () => {
      const response = await fetch('/api/admin/locations/pending-licenses', {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) return 0;
      const data = await response.json();
      return Array.isArray(data) ? data.length : 0;
    },
    refetchInterval: 30000,
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

  // Fetch all delivery partner applications - session-based auth only
  const { data: deliveryApplications = [], isLoading: isLoadingDelivery, error: deliveryError } = useQuery<any[]>({
    queryKey: ["/api/delivery-partner-applications"],
    queryFn: async ({ queryKey }) => {
      if (!user) {
        throw new Error("Admin not authenticated");
      }
      
      console.log('Admin: Fetching delivery partner applications data via session auth...', {
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
      console.log('Admin: Fresh delivery partner data fetched', rawData);

      // Convert snake_case to camelCase for database fields
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
        driversLicenseStatus: app.drivers_license_status || app.driversLicenseStatus,
        vehicleRegistrationStatus: app.vehicle_registration_status || app.vehicleRegistrationStatus,
        insuranceStatus: app.insurance_status || app.insuranceStatus,
        documentsAdminFeedback: app.documents_admin_feedback || app.documentsAdminFeedback,
        documentsReviewedBy: app.documents_reviewed_by || app.documentsReviewedBy,
        documentsReviewedAt: app.documents_reviewed_at || app.documentsReviewedAt,
        feedback: app.feedback,
        status: app.status,
        createdAt: app.created_at || app.createdAt,
        applicantUsername: app.applicant_username || app.applicantUsername,
      }));

      console.log('Admin: Normalized delivery partner application data', normalizedData);
      return normalizedData;
    },
    enabled: !!user && isAdmin, // Only fetch if user is admin
    // Intelligent auto-refresh for admin dashboard
    refetchInterval: (data) => {
      if (!data || !Array.isArray(data)) return 20000; // 20 seconds if no data or invalid data

      // Check for any pending document reviews across all applications
      const hasPendingDocumentReviews = data.some(app => 
        app.status === "approved" && (
          app.driversLicenseStatus === "pending" ||
          app.vehicleRegistrationStatus === "pending" ||
          app.insuranceStatus === "pending"
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
        description: `${variables.field === 'foodSafetyLicenseStatus' ? 'Food Safety License' : 'Food Establishment Certificate'} status changed to ${variables.status}. Email notification sent to user.`,
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

  // Mutation to update delivery partner application status
  const updateDeliveryStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number, status: string }) => {
      try {
        console.log(`Updating delivery partner application ${id} status to ${status}`);
        
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        
        const response = await fetch(`/api/delivery-partner-applications/${id}/status`, {
          method: 'PATCH',
          headers,
          credentials: 'include',
          body: JSON.stringify({ status })
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || response.statusText);
        }
        
        console.log('Delivery partner status update response:', response.status);
        return response.json();
      } catch (error) {
        console.error('Error updating delivery partner application status:', error);
        throw error;
      }
    },
    onSuccess: async (data) => {
      // Force comprehensive refresh after status update
      await forceAdminRefresh();
      
      // Additional immediate refresh for other components that might be listening
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/delivery-partner-applications"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/firebase/delivery-partner-applications/my"] })
      ]);
      
      toast({
        title: "Delivery partner status updated",
        description: `Application status changed to ${data.status}. Email notification sent.`,
      });

      console.log('Delivery partner status update successful with email notification:', data);
    },
    onError: (error) => {
      toast({
        title: "Error updating delivery partner status",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Mutation to update delivery partner document verification status
  const updateDeliveryDocumentStatusMutation = useMutation({
    mutationFn: async ({ id, field, status }: { id: number, field: string, status: string }) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      const updateData = { [field]: status };
      const response = await fetch(`/api/delivery-partner-applications/${id}/document-verification`, {
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
        queryClient.invalidateQueries({ queryKey: ["/api/delivery-partner-applications"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/firebase/delivery-partner-applications/my"] })
      ]);
      
      // Additional delayed refresh to catch any async database updates
      setTimeout(async () => {
        await forceAdminRefresh();
      }, 1000);
      
      const documentName = variables.field === 'driversLicenseStatus' ? 'Driver\'s License' : 
                          variables.field === 'vehicleRegistrationStatus' ? 'Vehicle Registration' : 'Vehicle Insurance';
      
      toast({
        title: "Document status updated",
        description: `${documentName} status changed to ${variables.status}. Email notification sent to user.`,
      });
      
      console.log('Admin: Delivery partner document status updated', {
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

  // Handle delivery partner status change
  const handleDeliveryStatusChange = (id: number, newStatus: string) => {
    updateDeliveryStatusMutation.mutate({ id, status: newStatus });
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
    <ErrorBoundary fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Admin Dashboard Error</h2>
          <p className="text-gray-600 mb-4">Something went wrong. Please refresh the page.</p>
          <Button onClick={() => window.location.reload()}>Refresh Page</Button>
        </div>
      </div>
    }>
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/20 relative">
      <AnimatedBackgroundOrbs variant="both" intensity="subtle" />
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
      <main className="flex-grow pt-16 sm:pt-20 pb-8 sm:pb-16 relative">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 xl:px-8">
          
          {/* Welcome Header Section */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 sm:mb-8 mt-2 sm:mt-4"
          >
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-base sm:text-lg shadow-lg">
                  <Shield className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Admin Dashboard</h1>
                  <p className="text-sm sm:text-base text-gray-500 hidden sm:block">Manage applications and review documents</p>
                  <p className="text-xs text-gray-500 sm:hidden">Manage applications</p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Enhanced Stats Cards */}
          <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-6 sm:mb-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200/60 hover:shadow-lg hover:border-gray-300/60 transition-all duration-300"
            >
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                  <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 text-green-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Approved</p>
                  <p className="text-lg sm:text-2xl font-bold text-gray-900">{statusCounts.approved}</p>
                </div>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200/60 hover:shadow-lg hover:border-gray-300/60 transition-all duration-300"
            >
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-yellow-100 flex items-center justify-center flex-shrink-0">
                  <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-yellow-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">In Review</p>
                  <p className="text-lg sm:text-2xl font-bold text-gray-900">{statusCounts.inReview}</p>
                </div>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-white rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200/60 hover:shadow-lg hover:border-gray-300/60 transition-all duration-300"
            >
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
                  <XCircle className="h-4 w-4 sm:h-5 sm:w-5 text-red-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Rejected</p>
                  <p className="text-lg sm:text-2xl font-bold text-gray-900">{statusCounts.rejected}</p>
                </div>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-white rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200/60 hover:shadow-lg hover:border-gray-300/60 transition-all duration-300"
            >
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0">
                  <Shield className="h-4 w-4 sm:h-5 sm:w-5 text-purple-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Doc Review</p>
                  <p className="text-lg sm:text-2xl font-bold text-gray-900">
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
              className="bg-white rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200/60 hover:shadow-lg hover:border-gray-300/60 transition-all duration-300"
            >
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <UserIcon className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Total</p>
                  <p className="text-lg sm:text-2xl font-bold text-gray-900">{statusCounts.total}</p>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Enhanced Search and Filter Section */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 shadow-sm border border-gray-200/60 hover:shadow-lg hover:border-gray-300/60 transition-all duration-300 mb-4 sm:mb-6 backdrop-blur-sm"
          >
            {/* Main Admin Navigation - Grouped Categories */}
            <div className="mb-6">
              {/* Category Navigation */}
              <div className="flex flex-wrap gap-2 mb-4 p-2 bg-gray-50 rounded-lg border border-gray-200">
                <Button
                  variant={activeCategory === "applications" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setActiveCategory("applications");
                    setActiveTab("applications");
                  }}
                  className="flex items-center gap-2 relative"
                >
                  <Shield className="h-4 w-4" />
                  Applications
                  {(statusCounts.inReview > 0 || pendingLicensesCount > 0) && (
                    <span className="ml-1 bg-yellow-500 text-white text-xs font-semibold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                      {statusCounts.inReview + pendingLicensesCount}
                    </span>
                  )}
                </Button>
                <Button
                  variant={activeCategory === "management" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setActiveCategory("management");
                    setActiveTab("chef-kitchen-access");
                  }}
                  className="flex items-center gap-2"
                >
                  <Users className="h-4 w-4" />
                  Management
                </Button>
                <Button
                  variant={activeCategory === "communications" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setActiveCategory("communications");
                    setActiveTab("promos");
                  }}
                  className="flex items-center gap-2"
                >
                  <Gift className="h-4 w-4" />
                  Communications
                </Button>
                <Button
                  variant={activeCategory === "settings" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setActiveCategory("settings");
                    setActiveTab("platform-settings");
                  }}
                  className="flex items-center gap-2"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </Button>
              </div>

              {/* Sub-tabs within category */}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                {activeCategory === "applications" && (
                  <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3 rounded-xl bg-gray-100 p-1 mb-6 gap-1">
                    <TabsTrigger value="applications" className="flex items-center gap-2 rounded-lg">
                      <Shield className="h-4 w-4" />
                      Chef Applications
                    </TabsTrigger>
                    <TabsTrigger value="delivery-applications" className="flex items-center gap-2 rounded-lg">
                      <Truck className="h-4 w-4" />
                      Delivery Applications
                    </TabsTrigger>
                    <TabsTrigger value="kitchen-licenses" className="flex items-center gap-2 rounded-lg">
                      <FileText className="h-4 w-4" />
                      Kitchen Licenses
                    </TabsTrigger>
                  </TabsList>
                )}

                {activeCategory === "management" && (
                  <TabsList className="grid w-full grid-cols-1 sm:grid-cols-2 rounded-xl bg-gray-100 p-1 mb-6 gap-1">
                    <TabsTrigger value="chef-kitchen-access" className="flex items-center gap-2 rounded-lg">
                      <UserIcon className="h-4 w-4" />
                      Chef Kitchen Access
                    </TabsTrigger>
                    <TabsTrigger value="kitchen-management" className="flex items-center gap-2 rounded-lg">
                      <Building2 className="h-4 w-4" />
                      Manage Kitchens
                    </TabsTrigger>
                  </TabsList>
                )}

                {activeCategory === "communications" && (
                  <TabsList className="grid w-full grid-cols-1 rounded-xl bg-gray-100 p-1 mb-6">
                    <TabsTrigger value="promos" className="flex items-center gap-2 rounded-lg">
                      <Gift className="h-4 w-4" />
                      Send Promo Codes
                    </TabsTrigger>
                  </TabsList>
                )}

                {activeCategory === "settings" && (
                  <TabsList className="grid w-full grid-cols-1 sm:grid-cols-2 rounded-xl bg-gray-100 p-1 mb-6 gap-1">
                    <TabsTrigger value="platform-settings" className="flex items-center gap-2 rounded-lg">
                      <Settings className="h-4 w-4" />
                      Platform Settings
                    </TabsTrigger>
                    <TabsTrigger value="account-settings" className="flex items-center gap-2 rounded-lg">
                      <Shield className="h-4 w-4" />
                      Account Settings
                    </TabsTrigger>
                  </TabsList>
                )}

              {/* Applications Tab Content */}
              <TabsContent value="applications" className="mt-0">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
                    <Search className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg sm:text-xl font-semibold text-gray-900">Search & Filter Applications</h3>
                    <p className="text-xs sm:text-sm text-gray-500 hidden sm:block">Find and manage applications efficiently</p>
                  </div>
                </div>

                {/* Search Bar */}
                <div className="mb-4 sm:mb-6">
                  <div className="relative w-full sm:max-w-md">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      type="text"
                      placeholder="Search by name, email, phone, or ID..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 sm:py-3 rounded-lg sm:rounded-xl border-gray-200 focus:border-indigo-300 focus:ring-indigo-200 text-sm sm:text-base"
                    />
                  </div>
                </div>

                {/* Quick Filter Buttons */}
                <div className="mb-4 sm:mb-6">
                  <h4 className="text-xs sm:text-sm font-medium text-gray-700 mb-2 sm:mb-3">Quick Filters</h4>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    <Button
                      variant={quickFilters.needsDocumentReview ? "default" : "outline"}
                      size="sm"
                      onClick={() => setQuickFilters(prev => ({ ...prev, needsDocumentReview: !prev.needsDocumentReview }))}
                      className="rounded-lg sm:rounded-xl text-xs sm:text-sm px-2 sm:px-3 py-1.5 sm:py-2 h-auto"
                    >
                      <Shield className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                      <span className="hidden xs:inline">Needs </span>Doc Review
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
                      <CalendarDays className="h-4 w-4 mr-2" />
                      Recent (3 days)
                    </Button>
                    
                    <Button
                      variant={quickFilters.hasDocuments ? "default" : "outline"}
                      size="sm"
                      onClick={() => setQuickFilters(prev => ({ ...prev, hasDocuments: !prev.hasDocuments }))}
                      className="rounded-xl"
                    >
                      <UserIcon className="h-4 w-4 mr-2" />
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

                {/* Status Tabs - Mobile Optimized */}
                <Tabs defaultValue="all" className="w-full">
                  <TabsList className="rounded-xl bg-gray-100 p-1 grid w-full grid-cols-2 sm:grid-cols-4 gap-1">
                    <TabsTrigger value="all" className="flex items-center gap-1 sm:gap-2 rounded-lg text-xs sm:text-sm px-2 sm:px-3 py-2">
                      <UserIcon className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0" />
                      <span className="hidden xs:inline">All </span>({statusCounts.total})
                    </TabsTrigger>
                    <TabsTrigger value="inReview" className="flex items-center gap-1 sm:gap-2 rounded-lg text-xs sm:text-sm px-2 sm:px-3 py-2">
                      <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-yellow-500 flex-shrink-0" />
                      <span className="hidden xs:inline">Review </span>({statusCounts.inReview})
                    </TabsTrigger>
                    <TabsTrigger value="approved" className="flex items-center gap-1 sm:gap-2 rounded-lg text-xs sm:text-sm px-2 sm:px-3 py-2">
                      <CheckCircle className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-green-500 flex-shrink-0" />
                      <span className="hidden xs:inline">Approved </span>({statusCounts.approved})
                    </TabsTrigger>
                    <TabsTrigger value="rejected" className="flex items-center gap-1 sm:gap-2 rounded-lg text-xs sm:text-sm px-2 sm:px-3 py-2">
                      <XCircle className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-red-500 flex-shrink-0" />
                      <span className="hidden xs:inline">Rejected </span>({statusCounts.rejected})
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
              </TabsContent>

              {/* Delivery Partner Applications Tab Content */}
              <TabsContent value="delivery-applications" className="mt-0">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                    <Truck className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg sm:text-xl font-semibold text-gray-900">Delivery Partner Applications</h3>
                    <p className="text-xs sm:text-sm text-gray-500 hidden sm:block">Review and manage delivery partner applications</p>
                  </div>
                </div>

                {/* Search Bar */}
                <div className="mb-4 sm:mb-6">
                  <div className="relative w-full sm:max-w-md">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      type="text"
                      placeholder="Search delivery partners by name, email, phone, or ID..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 sm:py-3 rounded-lg sm:rounded-xl border-gray-200 focus:border-blue-300 focus:ring-blue-200 text-sm sm:text-base"
                    />
                  </div>
                </div>

                {/* Quick Filter Buttons */}
                <div className="mb-4 sm:mb-6">
                  <h4 className="text-xs sm:text-sm font-medium text-gray-700 mb-2 sm:mb-3">Quick Filters</h4>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    <Button
                      variant={quickFilters.needsDocumentReview ? "default" : "outline"}
                      size="sm"
                      onClick={() => setQuickFilters(prev => ({ ...prev, needsDocumentReview: !prev.needsDocumentReview }))}
                      className="rounded-lg sm:rounded-xl text-xs sm:text-sm px-2 sm:px-3 py-1.5 sm:py-2 h-auto"
                    >
                      <Shield className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                      <span className="hidden xs:inline">Needs </span>Doc Review
                      {deliveryApplications.filter(app => 
                        app.status === "approved" && (
                          app.driversLicenseStatus === "pending" ||
                          app.vehicleRegistrationStatus === "pending" ||
                          app.insuranceStatus === "pending"
                        )
                      ).length > 0 && (
                        <span className="ml-2 bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full">
                          {deliveryApplications.filter(app => 
                            app.status === "approved" && (
                              app.driversLicenseStatus === "pending" ||
                              app.vehicleRegistrationStatus === "pending" ||
                              app.insuranceStatus === "pending"
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
                      <CalendarDays className="h-4 w-4 mr-2" />
                      Recent (3 days)
                    </Button>
                    
                    <Button
                      variant={quickFilters.hasDocuments ? "default" : "outline"}
                      size="sm"
                      onClick={() => setQuickFilters(prev => ({ ...prev, hasDocuments: !prev.hasDocuments }))}
                      className="rounded-xl"
                    >
                      <Truck className="h-4 w-4 mr-2" />
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

                {/* Status Tabs - Mobile Optimized */}
                <Tabs defaultValue="all" className="w-full">
                  <TabsList className="rounded-xl bg-gray-100 p-1 grid w-full grid-cols-2 sm:grid-cols-4 gap-1">
                    <TabsTrigger value="all" className="flex items-center gap-1 sm:gap-2 rounded-lg text-xs sm:text-sm px-2 sm:px-3 py-2">
                      <Truck className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0" />
                      <span className="hidden xs:inline">All</span>
                      <span className="xs:hidden">All</span>
                      <span className="ml-1 bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full">
                        {deliveryApplications.length}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="inReview" className="flex items-center gap-1 sm:gap-2 rounded-lg text-xs sm:text-sm px-2 sm:px-3 py-2">
                      <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0" />
                      <span className="hidden xs:inline">In Review</span>
                      <span className="xs:hidden">Review</span>
                      <span className="ml-1 bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full">
                        {deliveryApplications.filter(app => app.status === "inReview").length}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="approved" className="flex items-center gap-1 sm:gap-2 rounded-lg text-xs sm:text-sm px-2 sm:px-3 py-2">
                      <CheckCircle className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0" />
                      <span className="hidden xs:inline">Approved</span>
                      <span className="xs:hidden">Approved</span>
                      <span className="ml-1 bg-green-100 text-green-800 text-xs px-2 py-0.5 rounded-full">
                        {deliveryApplications.filter(app => app.status === "approved").length}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="rejected" className="flex items-center gap-1 sm:gap-2 rounded-lg text-xs sm:text-sm px-2 sm:px-3 py-2">
                      <XCircle className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0" />
                      <span className="hidden xs:inline">Rejected</span>
                      <span className="xs:hidden">Rejected</span>
                      <span className="ml-1 bg-red-100 text-red-800 text-xs px-2 py-0.5 rounded-full">
                        {deliveryApplications.filter(app => app.status === "rejected").length}
                      </span>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="all" className="mt-4">
                    {renderDeliveryApplicationList(deliveryApplications)}
                  </TabsContent>
                  <TabsContent value="inReview" className="mt-4">
                    {renderDeliveryApplicationList(deliveryApplications.filter(app => app.status === "inReview"))}
                  </TabsContent>
                  <TabsContent value="approved" className="mt-4">
                    {renderDeliveryApplicationList(deliveryApplications.filter(app => app.status === "approved"))}
                  </TabsContent>
                  <TabsContent value="rejected" className="mt-4">
                    {renderDeliveryApplicationList(deliveryApplications.filter(app => app.status === "rejected"))}
                  </TabsContent>
                </Tabs>
              </TabsContent>

              {/* Promo Codes Tab Content */}
              <TabsContent value="kitchen-licenses" className="mt-0">
                <KitchenLicenseApprovalView />
              </TabsContent>

              <TabsContent value="promos" className="mt-0">
                <PromoCodeSender />
              </TabsContent>

              <TabsContent value="chef-kitchen-access" className="mt-0">
                <ChefKitchenAccessManager />
              </TabsContent>

              <TabsContent value="kitchen-management" className="mt-0">
                <div className="text-center py-12">
                  <h3 className="text-xl font-semibold text-gray-900 mb-4">Kitchen Management</h3>
                  <p className="text-gray-600 mb-6">Create and manage commercial kitchen locations and facilities</p>
                  <Button
                    onClick={() => navigate("/admin/manage-locations")}
                    className="bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 text-white font-bold py-3 px-8 rounded-2xl shadow-lg transform transition hover:-translate-y-1"
                  >
                    Open Kitchen Management →
                  </Button>
                </div>
              </TabsContent>

              {/* Platform Settings Tab Content */}
              <TabsContent value="platform-settings" className="mt-0">
                <PlatformSettingsView />
              </TabsContent>

              {/* Account Settings Tab Content */}
              <TabsContent value="account-settings" className="mt-0">
                <div className="max-w-2xl">
                  <div className="mb-6">
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">Account Settings</h3>
                    <p className="text-gray-600">Manage your admin account password</p>
                  </div>
                  <ChangePassword role="admin" />
                </div>
              </TabsContent>
              </Tabs>
            </div>
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
                                    href={app.foodSafetyLicenseUrl} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium hover:underline transition-colors"
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
                                          className={`text-xs px-2 py-1 h-auto rounded transition-colors ${
                                            app.foodSafetyLicenseStatus === 'approved' 
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
                                          className={`text-xs px-2 py-1 h-auto rounded transition-colors ${
                                            app.foodSafetyLicenseStatus === 'rejected' 
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
                                    href={app.foodEstablishmentCertUrl} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium hover:underline transition-colors"
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
                                          className={`text-xs px-2 py-1 h-auto rounded transition-colors ${
                                            app.foodEstablishmentCertStatus === 'approved' 
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
                                          className={`text-xs px-2 py-1 h-auto rounded transition-colors ${
                                            app.foodEstablishmentCertStatus === 'rejected' 
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

  // Helper function to render delivery partner application list
  function renderDeliveryApplicationList(apps: any[]) {
    if (isLoadingDelivery) {
      return (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4">Loading delivery partner applications...</p>
        </div>
      );
    }

    if (deliveryError) {
      return (
        <div className="text-center py-12">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md mx-auto">
            <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-red-800 mb-2">Unable to Load Delivery Applications</h3>
            <p className="text-red-600 mb-4 text-sm">
              {deliveryError.message || "There was an issue loading the delivery partner applications data."}
            </p>
            <Button
              onClick={forceAdminRefresh}
              disabled={isLoadingDelivery}
              variant="outline"
              size="sm"
              className="border-red-300 text-red-700 hover:bg-red-50"
            >
              {isLoadingDelivery ? (
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
          <h2 className="text-xl font-semibold mb-2">No delivery partner applications found</h2>
          <p className="text-muted-foreground">
            {searchTerm ? 'Try adjusting your search criteria' : 'No delivery partner applications in this category'}
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
        {apps.map((app: any) => {
          const isExpanded = expandedCards.has(app.id);
          
          return (
            <motion.div key={app.id} variants={itemVariants} className="w-full">
              <Card className="overflow-hidden hover:shadow-lg transition-all duration-300 rounded-xl sm:rounded-2xl border border-gray-200/60 hover:border-gray-300/60 bg-white backdrop-blur-sm card-hover">
                
                {/* COMPACT VIEW - Always Visible */}
                <CardContent className="p-0">
                  <div className={`p-3 sm:p-4 lg:p-6 border-l-4 ${getStatusBadgeColor(app.status)}`}>
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                            <Truck className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-sm sm:text-base font-semibold text-gray-900 truncate">
                                {app.fullName}
                              </h3>
                              {getStatusBadge(app.status)}
                            </div>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-xs sm:text-sm text-gray-600">
                              <div className="flex items-center gap-1">
                                <Mail className="h-3 w-3 sm:h-4 sm:w-4" />
                                <span className="truncate">{app.email}</span>
                              </div>
                              {app.phone && (
                                <div className="flex items-center gap-1">
                                  <Phone className="h-3 w-3 sm:h-4 sm:w-4" />
                                  <span>{app.phone}</span>
                                </div>
                              )}
                            </div>
                            <div className="mt-2 text-xs text-gray-500">
                              <span className="font-medium">Vehicle:</span> {app.vehicleYear} {app.vehicleMake} {app.vehicleModel} ({app.vehicleType})
                              <br />
                              <span className="font-medium">License Plate:</span> {app.licensePlate}
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleCardExpansion(app.id)}
                          className="text-gray-500 hover:text-gray-700"
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

                  {/* EXPANDED VIEW - Conditionally Visible */}
                  {isExpanded && (
                    <div className="px-3 sm:px-4 lg:px-6 pb-6 space-y-4">
                      {/* Vehicle Details */}
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <h4 className="text-sm font-semibold mb-3 text-blue-800 flex items-center gap-2">
                          <Truck className="h-4 w-4" />
                          Vehicle Information
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <h5 className="text-xs font-medium text-blue-700 mb-1">Vehicle Details</h5>
                            <p className="text-sm">{app.vehicleYear} {app.vehicleMake} {app.vehicleModel}</p>
                            <p className="text-xs text-blue-600">Type: {app.vehicleType}</p>
                          </div>
                          <div>
                            <h5 className="text-xs font-medium text-blue-700 mb-1">License Plate</h5>
                            <p className="text-sm font-mono">{app.licensePlate}</p>
                          </div>
                        </div>
                      </div>

                      {/* Address Information */}
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <h4 className="text-sm font-semibold mb-3 text-gray-800">Address Information</h4>
                        <div className="text-sm">
                          <p>{app.address}</p>
                          <p>{app.city}, {app.province} {app.postalCode}</p>
                        </div>
                      </div>

                      {/* Document Verification Section */}
                      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
                        <h4 className="text-sm font-semibold mb-4 text-blue-800 flex items-center gap-2">
                          <Shield className="h-5 w-5" />
                          Document Verification
                        </h4>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {/* Driver's License */}
                          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
                            <h5 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                              <Shield className="h-4 w-4 text-blue-600" />
                              Driver's License
                            </h5>
                            {app.driversLicenseUrl ? (
                              <div className="space-y-3">
                                <a 
                                  href={app.driversLicenseUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium hover:underline transition-colors"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                  View Document
                                </a>
                                <div className="flex items-center justify-between">
                                  {getDocumentStatusBadge(app.driversLicenseStatus)}
                                </div>
                                {/* Document Status Controls */}
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant={app.driversLicenseStatus === 'approved' ? 'default' : 'outline'}
                                    onClick={() => updateDeliveryDocumentStatusMutation.mutate({ 
                                      id: app.id, 
                                      field: 'driversLicenseStatus', 
                                      status: 'approved' 
                                    })}
                                    disabled={updateDeliveryDocumentStatusMutation.isPending}
                                    className="flex-1 text-xs"
                                  >
                                    {updateDeliveryDocumentStatusMutation.isPending ? 'Updating...' : 'Approve'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={app.driversLicenseStatus === 'rejected' ? 'destructive' : 'outline'}
                                    onClick={() => updateDeliveryDocumentStatusMutation.mutate({ 
                                      id: app.id, 
                                      field: 'driversLicenseStatus', 
                                      status: 'rejected' 
                                    })}
                                    disabled={updateDeliveryDocumentStatusMutation.isPending}
                                    className="flex-1 text-xs"
                                  >
                                    {updateDeliveryDocumentStatusMutation.isPending ? 'Updating...' : 'Reject'}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="text-center py-4 text-gray-500 text-sm bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                                No document uploaded
                              </div>
                            )}
                          </div>

                          {/* Vehicle Registration */}
                          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
                            <h5 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                              <Shield className="h-4 w-4 text-blue-600" />
                              Vehicle Registration
                            </h5>
                            {app.vehicleRegistrationUrl ? (
                              <div className="space-y-3">
                                <a 
                                  href={app.vehicleRegistrationUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium hover:underline transition-colors"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                  View Document
                                </a>
                                <div className="flex items-center justify-between">
                                  {getDocumentStatusBadge(app.vehicleRegistrationStatus)}
                                </div>
                                {/* Document Status Controls */}
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant={app.vehicleRegistrationStatus === 'approved' ? 'default' : 'outline'}
                                    onClick={() => updateDeliveryDocumentStatusMutation.mutate({ 
                                      id: app.id, 
                                      field: 'vehicleRegistrationStatus', 
                                      status: 'approved' 
                                    })}
                                    disabled={updateDeliveryDocumentStatusMutation.isPending}
                                    className="flex-1 text-xs"
                                  >
                                    {updateDeliveryDocumentStatusMutation.isPending ? 'Updating...' : 'Approve'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={app.vehicleRegistrationStatus === 'rejected' ? 'destructive' : 'outline'}
                                    onClick={() => updateDeliveryDocumentStatusMutation.mutate({ 
                                      id: app.id, 
                                      field: 'vehicleRegistrationStatus', 
                                      status: 'rejected' 
                                    })}
                                    disabled={updateDeliveryDocumentStatusMutation.isPending}
                                    className="flex-1 text-xs"
                                  >
                                    {updateDeliveryDocumentStatusMutation.isPending ? 'Updating...' : 'Reject'}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="text-center py-4 text-gray-500 text-sm bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                                No document uploaded
                              </div>
                            )}
                          </div>

                          {/* Vehicle Insurance */}
                          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
                            <h5 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                              <Shield className="h-4 w-4 text-blue-600" />
                              Vehicle Insurance
                            </h5>
                            {app.insuranceUrl ? (
                              <div className="space-y-3">
                                <a 
                                  href={app.insuranceUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium hover:underline transition-colors"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                  View Document
                                </a>
                                <div className="flex items-center justify-between">
                                  {getDocumentStatusBadge(app.insuranceStatus)}
                                </div>
                                {/* Document Status Controls */}
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant={app.insuranceStatus === 'approved' ? 'default' : 'outline'}
                                    onClick={() => updateDeliveryDocumentStatusMutation.mutate({ 
                                      id: app.id, 
                                      field: 'insuranceStatus', 
                                      status: 'approved' 
                                    })}
                                    disabled={updateDeliveryDocumentStatusMutation.isPending}
                                    className="flex-1 text-xs"
                                  >
                                    {updateDeliveryDocumentStatusMutation.isPending ? 'Updating...' : 'Approve'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={app.insuranceStatus === 'rejected' ? 'destructive' : 'outline'}
                                    onClick={() => updateDeliveryDocumentStatusMutation.mutate({ 
                                      id: app.id, 
                                      field: 'insuranceStatus', 
                                      status: 'rejected' 
                                    })}
                                    disabled={updateDeliveryDocumentStatusMutation.isPending}
                                    className="flex-1 text-xs"
                                  >
                                    {updateDeliveryDocumentStatusMutation.isPending ? 'Updating...' : 'Reject'}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="text-center py-4 text-gray-500 text-sm bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                                No document uploaded
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

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

                        {/* Status Change Dropdown - Delivery Partner */}
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
                                onValueChange={(value) => handleDeliveryStatusChange(app.id, value)}
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

// Kitchen License Approval Component
function KitchenLicenseApprovalView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<Record<number, string>>({});
  const [expandedLicense, setExpandedLicense] = useState<number | null>(null);

  // Fetch pending licenses
  const { data: pendingLicenses = [], isLoading, refetch } = useQuery({
    queryKey: ['/api/admin/locations/pending-licenses'],
    queryFn: async () => {
      const response = await fetch('/api/admin/locations/pending-licenses', {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error('Failed to fetch pending licenses');
      }
      return response.json();
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Approve/Reject license mutation
  const approveLicenseMutation = useMutation({
    mutationFn: async ({ locationId, status, feedbackText }: { locationId: number; status: 'approved' | 'rejected'; feedbackText?: string }) => {
      const response = await fetch(`/api/admin/locations/${locationId}/kitchen-license`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status,
          feedback: feedbackText || null,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to update license status' }));
        throw new Error(error.error || 'Failed to update license status');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/locations/pending-licenses'] });
      refetch();
      toast({
        title: "License Status Updated",
        description: "The license status has been updated successfully.",
      });
      setFeedback({});
      setExpandedLicense(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update license status",
        variant: "destructive",
      });
    },
  });

  const handleApprove = (locationId: number) => {
    const feedbackText = feedback[locationId]?.trim();
    approveLicenseMutation.mutate({ locationId, status: 'approved', feedbackText });
  };

  const handleReject = (locationId: number) => {
    const feedbackText = feedback[locationId]?.trim();
    if (!feedbackText) {
      toast({
        title: "Feedback Required",
        description: "Please provide feedback when rejecting a license.",
        variant: "destructive",
      });
      return;
    }
    approveLicenseMutation.mutate({ locationId, status: 'rejected', feedbackText });
  };

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading pending licenses...</p>
      </div>
    );
  }

  if (pendingLicenses.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-200">
        <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Pending Licenses</h3>
        <p className="text-gray-500">All kitchen licenses have been reviewed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Pending Kitchen Licenses</h3>
            <p className="text-sm text-gray-500">
              {pendingLicenses.length} location{pendingLicenses.length !== 1 ? 's' : ''} awaiting review
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        <div className="space-y-4">
          {pendingLicenses.map((license: any) => (
            <Card key={license.id} className="border-2 border-yellow-200">
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 rounded-lg bg-yellow-100 flex items-center justify-center">
                        <FileText className="h-6 w-6 text-yellow-600" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-gray-900 text-lg">{license.name}</h4>
                        <p className="text-sm text-gray-600">{license.address}</p>
                        {license.managerUsername && (
                          <p className="text-xs text-gray-500 mt-1">
                            Manager: {license.managerUsername}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* License Document */}
                    <div className="mb-4">
                      <a
                        href={`/api/files/kitchen-license/${license.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium text-sm"
                      >
                        <ExternalLink className="h-4 w-4" />
                        View Kitchen License Document
                      </a>
                    </div>

                    {/* Expandable Feedback Section */}
                    {expandedLicense === license.id && (
                      <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Feedback (Required for rejection, optional for approval)
                        </label>
                        <textarea
                          value={feedback[license.id] || ''}
                          onChange={(e) => setFeedback({ ...feedback, [license.id]: e.target.value })}
                          placeholder="Add feedback or notes about this license..."
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                          rows={3}
                        />
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-3 mt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setExpandedLicense(expandedLicense === license.id ? null : license.id)}
                      >
                        {expandedLicense === license.id ? 'Hide Feedback' : 'Add Feedback'}
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleApprove(license.id)}
                        disabled={approveLicenseMutation.isPending}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        <Check className="h-4 w-4 mr-2" />
                        {approveLicenseMutation.isPending ? 'Approving...' : 'Approve'}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleReject(license.id)}
                        disabled={approveLicenseMutation.isPending}
                      >
                        <X className="h-4 w-4 mr-2" />
                        {approveLicenseMutation.isPending ? 'Rejecting...' : 'Reject'}
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

// Platform Settings Component
function PlatformSettingsView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [serviceFeeRate, setServiceFeeRate] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch current service fee rate
  // NOTE: Admins use session-based auth, not Firebase tokens
  // IMPORTANT: Do NOT send Authorization header - this endpoint uses session auth only
  const { data: currentRate, isLoading: isLoadingRate, error: rateError } = useQuery<{
    key: string;
    value: string;
    rate: number;
    percentage: string;
    description?: string;
    updatedAt?: string;
  }>({
    queryKey: ['/api/admin/platform-settings/service-fee-rate'],
    queryFn: async () => {
      // Create headers object without Authorization to prevent Firebase auth
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      const response = await fetch('/api/admin/platform-settings/service-fee-rate', {
        credentials: 'include', // Essential for session-based admin auth
        headers,
      });
      if (!response.ok) {
        throw new Error('Failed to fetch service fee rate');
      }
      return response.json();
    },
  });

  // Handle query success/error with useEffect (React Query v5)
  useEffect(() => {
    if (currentRate?.rate) {
      setServiceFeeRate((currentRate.rate * 100).toFixed(2));
      setIsLoading(false);
    } else if (rateError) {
      setIsLoading(false);
      toast({
        title: "Error",
        description: "Failed to load service fee rate. Using default 5%.",
        variant: "destructive",
      });
      setServiceFeeRate('5.00');
    }
  }, [currentRate, rateError, toast]);

  // Update mutation
  // NOTE: Admins use session-based auth, not Firebase tokens
  // IMPORTANT: Do NOT send Authorization header - this endpoint uses session auth only
  const updateMutation = useMutation<{
    key: string;
    value: string;
    rate: number;
    percentage: string;
    description?: string;
    updatedAt?: string;
    message?: string;
  }, Error, number>({
    mutationFn: async (rate: number) => {
      // Create headers object without Authorization to prevent Firebase auth
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      const response = await fetch('/api/admin/platform-settings/service-fee-rate', {
        method: 'PUT',
        credentials: 'include', // Essential for session-based admin auth
        headers,
        body: JSON.stringify({ rate }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update service fee rate');
      }
      return response.json();
    },
  });

  // Handle mutation success/error with useEffect (React Query v5)
  useEffect(() => {
    if (updateMutation.isSuccess && updateMutation.data) {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/platform-settings/service-fee-rate'] });
      queryClient.invalidateQueries({ queryKey: ['/api/platform-settings/service-fee-rate'] });
      toast({
        title: "Success",
        description: `Service fee rate updated to ${updateMutation.data.percentage}%`,
      });
      setIsSaving(false);
    } else if (updateMutation.isError) {
      toast({
        title: "Error",
        description: updateMutation.error?.message || "Failed to update service fee rate",
        variant: "destructive",
      });
      setIsSaving(false);
    }
  }, [updateMutation.isSuccess, updateMutation.isError, updateMutation.data, updateMutation.error, queryClient, toast]);

  const handleSave = () => {
    const rateValue = parseFloat(serviceFeeRate);
    
    if (isNaN(rateValue) || rateValue < 0 || rateValue > 100) {
      toast({
        title: "Invalid Input",
        description: "Service fee rate must be between 0 and 100",
        variant: "destructive",
      });
      return;
    }

    // Convert percentage to decimal
    const rateDecimal = rateValue / 100;
    setIsSaving(true);
    updateMutation.mutate(rateDecimal);
  };

  const handleReset = () => {
    if (currentRate) {
      setServiceFeeRate((currentRate.rate * 100).toFixed(2));
    } else {
      setServiceFeeRate('5.00');
    }
  };

  if (isLoading || isLoadingRate) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="mb-6">
        <h3 className="text-xl font-semibold text-gray-900 mb-2 flex items-center gap-2">
          <Settings className="h-5 w-5 text-indigo-600" />
          Platform Settings
        </h3>
        <p className="text-gray-600">Configure platform-wide settings that affect all users</p>
      </div>

      {/* Service Fee Rate Card */}
      <Card className="border-2 border-gray-200">
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-indigo-100 to-indigo-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <DollarSign className="h-6 w-6 text-indigo-600" />
              </div>
              <div className="flex-1">
                <h4 className="text-lg font-semibold text-gray-900 mb-1">Service Fee Rate</h4>
                <p className="text-sm text-gray-600 mb-4">
                  The platform service fee rate applied to storage extensions and bookings. This rate is used when chefs extend their storage bookings.
                </p>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Service Fee Rate (%)
                    </label>
                    <div className="flex items-center gap-3">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={serviceFeeRate}
                        onChange={(e) => setServiceFeeRate(e.target.value)}
                        className="max-w-xs"
                        placeholder="5.00"
                      />
                      <span className="text-sm text-gray-500">%</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Enter a value between 0 and 100 (e.g., 5.00 for 5%)
                    </p>
                  </div>

                  {currentRate && (
                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-700">Current Rate</p>
                          <p className="text-2xl font-bold text-indigo-600 mt-1">
                            {currentRate.percentage}%
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            Last updated: {currentRate.updatedAt ? new Date(currentRate.updatedAt).toLocaleString() : 'Never'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-600">Decimal Value</p>
                          <p className="text-lg font-semibold text-gray-900">{currentRate.rate}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <Button
                      onClick={handleSave}
                      disabled={isSaving || !serviceFeeRate}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white"
                    >
                      {isSaving ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4 mr-2" />
                          Save Changes
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={handleReset}
                      disabled={isSaving}
                      variant="outline"
                    >
                      Reset
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="border border-blue-200 bg-blue-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800">
              <p className="font-semibold mb-1">Important Notes:</p>
              <ul className="list-disc list-inside space-y-1 text-blue-700">
                <li>Changes to the service fee rate will apply to all new storage extensions</li>
                <li>Existing bookings will retain their original service fee rate</li>
                <li>The rate is applied as a percentage of the base price</li>
                <li>This setting affects storage extension payments only</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Admin() {
  return (
    <AdminProtectedRoute>
      <AdminDashboard />
    </AdminProtectedRoute>
  );
}
