import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Application, DocumentVerification } from "@shared/schema";
import {
  formatCertificationStatus,
  formatKitchenPreference,
  formatApplicationStatus,
  getStatusBadgeColor
} from "@/lib/applicationSchema";
import { useAuth } from "@/hooks/use-auth";
import AdminProtectedRoute from "@/components/admin/AdminProtectedRoute";
import { motion } from "framer-motion";

import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "@/components/ui/accordion";
import { AlertCircle, CheckCircle, Clock, XCircle, CalendarDays, Filter, Search, User as UserIcon, FileText, ExternalLink, BadgeCheck } from "lucide-react";

function AdminDashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [activeTab, setActiveTab] = useState("applications");

  const { user } = useAuth();

  // Debug authentication state
  console.log('Admin Dashboard - Authentication state:', {
    isLoggedIn: !!user,
    userId: user?.id,
    userRole: user?.role,
    localStorageUserId: localStorage.getItem('userId')
  });

  // Fetch all applications with user ID in header
  const { data: applications = [], isLoading, error } = useQuery<Application[]>({
    queryKey: ["/api/applications"],
    queryFn: async ({ queryKey }) => {
      const headers: Record<string, string> = {};

      // Include user ID in header for authentication
      if (user?.id) {
        headers['X-User-ID'] = user.id.toString();
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
      console.log('Raw admin application data:', rawData);

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
        applicantUsername: app.applicant_username || app.applicantUsername
      }));

      console.log('Normalized admin application data:', normalizedData);
      return normalizedData;
    },
    enabled: !!user, // Only run query when user is authenticated
  });

  // Fetch document verifications
  const { data: documentVerifications = [], isLoading: isLoadingDocs } = useQuery<DocumentVerification[]>({
    queryKey: ["/api/document-verification"],
    queryFn: async ({ queryKey }) => {
      const headers: Record<string, string> = {};
      if (user?.id) {
        headers['X-User-ID'] = user.id.toString();
      }

      const response = await apiRequest("GET", queryKey[0] as string, undefined, headers);
      if (!response.ok) {
        throw new Error("Failed to fetch document verifications");
      }
      return response.json();
    },
    enabled: !!user,
  });

  // Mutation to update application status
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number, status: string }) => {
      // Create custom headers with user ID for authentication
      const customHeaders: Record<string, string> = {};

      // Include user ID in header for authentication
      if (user?.id) {
        customHeaders['X-User-ID'] = user.id.toString();
        console.log('Adding X-User-ID header for status update:', user.id);
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/applications"] });
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
  const updateDocumentMutation = useMutation({
    mutationFn: async ({ 
      id, 
      foodSafetyLicenseStatus, 
      foodEstablishmentCertStatus, 
      adminFeedback 
    }: { 
      id: number; 
      foodSafetyLicenseStatus?: string; 
      foodEstablishmentCertStatus?: string; 
      adminFeedback?: string; 
    }) => {
      const headers: Record<string, string> = {};
      if (user?.id) {
        headers['X-User-ID'] = user.id.toString();
      }

      const response = await apiRequest("PATCH", `/api/document-verification/${id}/status`, {
        foodSafetyLicenseStatus,
        foodEstablishmentCertStatus,
        adminFeedback,
      }, headers);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-verification"] });
      toast({
        title: "Document status updated",
        description: "Document verification status has been updated successfully.",
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

  // Filter applications based on status and search term
  const filteredApplications = applications ? applications.filter((app) => {
    const matchesStatus = filterStatus === "all" || app.status === filterStatus;
    const matchesSearch = searchTerm === "" ||
      app.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.email.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesStatus && matchesSearch;
  }) : [];

  // Handle status change
  const handleStatusChange = (id: number, newStatus: string) => {
    updateStatusMutation.mutate({ id, status: newStatus });
  };

  // Handle document status change
  const handleDocumentStatusChange = (
    id: number, 
    field: 'foodSafetyLicenseStatus' | 'foodEstablishmentCertStatus', 
    status: string,
    feedback?: string
  ) => {
    updateDocumentMutation.mutate({
      id,
      [field]: status,
      adminFeedback: feedback,
    });
  };

  // Handle logout
  const { logoutMutation } = useAuth();

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        navigate("/");
      }
    });
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
      case "new": return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case "inReview": return <Clock className="h-4 w-4 text-blue-500" />;
      case "approved": return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "rejected": return <XCircle className="h-4 w-4 text-red-500" />;
      case "cancelled": return <XCircle className="h-4 w-4 text-gray-500" />;
      case "pending": return <Clock className="h-4 w-4 text-yellow-500" />;
      default: return null;
    }
  };

  // Get status counts for dashboard metrics
  const statusCounts = {
    new: applications.filter(app => app.status === "new").length,
    inReview: applications.filter(app => app.status === "inReview").length,
    approved: applications.filter(app => app.status === "approved").length,
    rejected: applications.filter(app => app.status === "rejected").length,
    cancelled: applications.filter(app => app.status === "cancelled").length,
  };

  const documentCounts = {
    pending: documentVerifications.filter(doc => 
      doc.foodSafetyLicenseStatus === 'pending' || doc.foodEstablishmentCertStatus === 'pending'
    ).length,
    approved: documentVerifications.filter(doc => 
      doc.foodSafetyLicenseStatus === 'approved' && 
      (doc.foodEstablishmentCertStatus === 'approved' || !doc.foodEstablishmentCertUrl)
    ).length,
    rejected: documentVerifications.filter(doc => 
      doc.foodSafetyLicenseStatus === 'rejected' || doc.foodEstablishmentCertStatus === 'rejected'
    ).length,
  };

  return (
    <div className="min-h-screen flex flex-col bg-light-gray">
      <Header />
      <main className="flex-grow pt-28 pb-16">
        <div className="container mx-auto px-4 max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-8"
          >
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
                <p className="text-gray-600 mt-2">Manage applications and document verifications</p>
              </div>
              <Button
                onClick={handleLogout}
                variant="outline"
                className="flex items-center gap-2"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </Button>
            </div>

            {/* Main Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="applications" className="flex items-center gap-2">
                  <UserIcon className="h-4 w-4" />
                  Applications ({applications.length})
                </TabsTrigger>
                <TabsTrigger value="documents" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Document Verifications ({documentVerifications.length})
                </TabsTrigger>
              </TabsList>

              {/* Applications Tab */}
              <TabsContent value="applications" className="mt-6">
                {/* Dashboard Metrics */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">New</p>
                          <p className="text-2xl font-bold">{statusCounts.new}</p>
                        </div>
                        <AlertCircle className="h-8 w-8 text-yellow-500" />
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">In Review</p>
                          <p className="text-2xl font-bold">{statusCounts.inReview}</p>
                        </div>
                        <Clock className="h-8 w-8 text-blue-500" />
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Approved</p>
                          <p className="text-2xl font-bold">{statusCounts.approved}</p>
                        </div>
                        <CheckCircle className="h-8 w-8 text-green-500" />
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Rejected</p>
                          <p className="text-2xl font-bold">{statusCounts.rejected}</p>
                        </div>
                        <XCircle className="h-8 w-8 text-red-500" />
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Total</p>
                          <p className="text-2xl font-bold">{applications.length}</p>
                        </div>
                        <UserIcon className="h-8 w-8 text-gray-500" />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Filters and Search */}
                <Card className="mb-6">
                  <CardContent className="p-6">
                    <div className="flex flex-col md:flex-row gap-4">
                      <div className="flex-1">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                          <Input
                            placeholder="Search by name or email..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Filter className="h-4 w-4 text-gray-500" />
                        <Select value={filterStatus} onValueChange={setFilterStatus}>
                          <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Filter by status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Applications</SelectItem>
                            <SelectItem value="new">New</SelectItem>
                            <SelectItem value="inReview">In Review</SelectItem>
                            <SelectItem value="approved">Approved</SelectItem>
                            <SelectItem value="rejected">Rejected</SelectItem>
                            <SelectItem value="cancelled">Cancelled</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Applications List */}
                <Card>
                  <CardHeader>
                    <CardTitle>Applications</CardTitle>
                    <CardDescription>
                      Manage and review all submitted applications
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Tabs defaultValue="all" className="w-full">
                      <TabsList className="grid w-full grid-cols-5">
                        <TabsTrigger value="all">All ({filteredApplications.length})</TabsTrigger>
                        <TabsTrigger value="new">New ({filteredApplications.filter(app => app.status === "new").length})</TabsTrigger>
                        <TabsTrigger value="inReview">In Review ({filteredApplications.filter(app => app.status === "inReview").length})</TabsTrigger>
                        <TabsTrigger value="approved">Approved ({filteredApplications.filter(app => app.status === "approved").length})</TabsTrigger>
                        <TabsTrigger value="rejected">Rejected ({filteredApplications.filter(app => app.status === "rejected").length})</TabsTrigger>
                      </TabsList>
                      <TabsContent value="all" className="mt-0">
                        {renderApplicationList(filteredApplications)}
                      </TabsContent>
                      <TabsContent value="new" className="mt-0">
                        {renderApplicationList(filteredApplications.filter(app => app.status === "new"))}
                      </TabsContent>
                      <TabsContent value="inReview" className="mt-0">
                        {renderApplicationList(filteredApplications.filter(app => app.status === "inReview"))}
                      </TabsContent>
                      <TabsContent value="approved" className="mt-0">
                        {renderApplicationList(filteredApplications.filter(app => app.status === "approved"))}
                      </TabsContent>
                      <TabsContent value="rejected" className="mt-0">
                        {renderApplicationList(filteredApplications.filter(app => app.status === "rejected"))}
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Document Verifications Tab */}
              <TabsContent value="documents" className="mt-6">
                {/* Document Metrics */}
                <div className="grid grid-cols-3 gap-4 mb-8">
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Pending Review</p>
                          <p className="text-2xl font-bold">{documentCounts.pending}</p>
                        </div>
                        <Clock className="h-8 w-8 text-yellow-500" />
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Approved</p>
                          <p className="text-2xl font-bold">{documentCounts.approved}</p>
                        </div>
                        <CheckCircle className="h-8 w-8 text-green-500" />
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Rejected</p>
                          <p className="text-2xl font-bold">{documentCounts.rejected}</p>
                        </div>
                        <XCircle className="h-8 w-8 text-red-500" />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Document Verifications List */}
                <Card>
                  <CardHeader>
                    <CardTitle>Document Verifications</CardTitle>
                    <CardDescription>
                      Review and approve uploaded documents for verification
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {renderDocumentVerificationList(documentVerifications)}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

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
        className="space-y-4"
      >
        {apps.map((app: Application) => (
          <motion.div key={app.id} variants={itemVariants} className="w-full">
            <Card className="overflow-hidden hover:shadow-md transition-shadow duration-300">
              <CardContent className="p-0">
                <div className="flex flex-col md:flex-row">
                  <div className={`p-6 border-l-4 ${getStatusBadgeColor(app.status)} flex-grow`}>
                    <div className="flex flex-col md:flex-row justify-between">
                      <div>
                        <h3 className="text-lg font-semibold flex items-center">
                          <UserIcon className="h-4 w-4 mr-2 text-gray-500" />
                          {app.fullName}
                        </h3>
                        <p className="text-sm text-gray-500">{app.email} • {app.phone}</p>
                      </div>
                      <div className="mt-2 md:mt-0">
                        <Badge className={`${getStatusBadgeColor(app.status)} flex items-center gap-1.5 px-2 py-1`}>
                          {getStatusIcon(app.status)}
                          {formatApplicationStatus(app.status)}
                        </Badge>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                      <div className="bg-gray-50 p-3 rounded-md">
                        <h4 className="text-xs font-medium text-muted-foreground mb-1">
                          Food Safety License
                        </h4>
                        <p className="font-medium text-sm">{formatCertificationStatus(app.foodSafetyLicense)}</p>
                      </div>
                      <div className="bg-gray-50 p-3 rounded-md">
                        <h4 className="text-xs font-medium text-muted-foreground mb-1">
                          Food Establishment Certificate
                        </h4>
                        <p className="font-medium text-sm">{formatCertificationStatus(app.foodEstablishmentCert)}</p>
                      </div>
                      <div className="bg-gray-50 p-3 rounded-md">
                        <h4 className="text-xs font-medium text-muted-foreground mb-1">
                          Kitchen Preference
                        </h4>
                        <p className="font-medium text-sm">{formatKitchenPreference(app.kitchenPreference)}</p>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t w-full">
                      <h3 className="text-sm font-medium mb-3">Application Details</h3>
                      <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <h4 className="text-xs font-medium text-muted-foreground mb-1">Full Name</h4>
                            <p className="font-medium text-sm">{app.fullName || "No name provided"}</p>
                          </div>
                          <div>
                            <h4 className="text-xs font-medium text-muted-foreground mb-1">Email</h4>
                            <p className="font-medium text-sm">{app.email || "No email provided"}</p>
                          </div>
                          <div>
                            <h4 className="text-xs font-medium text-muted-foreground mb-1">Phone</h4>
                            <p className="font-medium text-sm">{app.phone || "No phone provided"}</p>
                          </div>
                          <div>
                            <h4 className="text-xs font-medium text-muted-foreground mb-1">Created Date</h4>
                            <p className="font-medium text-sm">{app.createdAt ? new Date(app.createdAt).toLocaleDateString() : "N/A"}</p>
                          </div>
                          <div>
                            <h4 className="text-xs font-medium text-muted-foreground mb-1">Food Safety License</h4>
                            <p className="font-medium text-sm">{formatCertificationStatus(app.foodSafetyLicense)}</p>
                          </div>
                          <div>
                            <h4 className="text-xs font-medium text-muted-foreground mb-1">Food Establishment Cert</h4>
                            <p className="font-medium text-sm">{formatCertificationStatus(app.foodEstablishmentCert)}</p>
                          </div>
                          <div>
                            <h4 className="text-xs font-medium text-muted-foreground mb-1">Status</h4>
                            <Badge className={`${getStatusBadgeColor(app.status)}`}>
                              {formatApplicationStatus(app.status)}
                            </Badge>
                          </div>
                          <div className="col-span-2 mt-2">
                            <h4 className="text-xs font-medium text-muted-foreground mb-1">Feedback/Questions</h4>
                            <p className="font-medium text-sm bg-gray-50 p-3 rounded-md border border-gray-200">
                              {app.feedback || "No feedback or questions provided"}
                            </p>
                          </div>
                          <div>
                            <h4 className="text-xs font-medium text-muted-foreground mb-1">Application ID</h4>
                            <p className="font-medium text-sm">#{app.id}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t flex flex-col md:flex-row justify-between items-center">
                      <div className="flex items-center text-xs text-muted-foreground">
                        <CalendarDays className="h-3 w-3 mr-1" />
                        Submitted on {new Date(app.createdAt).toLocaleDateString()}
                      </div>
                      <div className="mt-2 md:mt-0">
                        <Select
                          defaultValue={app.status}
                          onValueChange={(value) => handleStatusChange(app.id, value)}
                        >
                          <SelectTrigger className="h-8 w-[140px]">
                            <SelectValue placeholder="Update Status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="new">New</SelectItem>
                            <SelectItem value="inReview">In Review</SelectItem>
                            <SelectItem value="approved">Approve</SelectItem>
                            <SelectItem value="rejected">Reject</SelectItem>
                            <SelectItem value="cancelled">Cancel</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    );
  }

  // Helper function to render document verification list
  function renderDocumentVerificationList(docs: DocumentVerification[]) {
    if (isLoadingDocs) {
      return (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4">Loading document verifications...</p>
        </div>
      );
    }

    if (docs.length === 0) {
      return (
        <div className="text-center py-12 border rounded-lg bg-muted/20">
          <FileText className="h-12 w-12 mx-auto mb-4 text-gray-400" />
          <h2 className="text-xl font-semibold mb-2">No document verifications found</h2>
          <p className="text-muted-foreground">
            No users have uploaded documents for verification yet.
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
        {docs.map((doc: DocumentVerification) => (
          <motion.div key={doc.id} variants={itemVariants} className="w-full">
            <Card className="overflow-hidden hover:shadow-md transition-shadow duration-300">
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      Document Verification #{doc.id}
                    </h3>
                    <p className="text-sm text-muted-foreground">User ID: {doc.userId}</p>
                  </div>
                  <Badge variant="outline">
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Food Safety License */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">Food Safety License</h4>
                      <Badge className={`${
                        doc.foodSafetyLicenseStatus === 'approved' ? 'bg-green-100 text-green-800' :
                        doc.foodSafetyLicenseStatus === 'rejected' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {getStatusIcon(doc.foodSafetyLicenseStatus || 'pending')}
                        {doc.foodSafetyLicenseStatus || 'pending'}
                      </Badge>
                    </div>
                    {doc.foodSafetyLicenseUrl && (
                      <div className="flex items-center gap-2">
                        <a
                          href={doc.foodSafetyLicenseUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="h-4 w-4" />
                          View Document
                        </a>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-green-600 border-green-200 hover:bg-green-50"
                        onClick={() => handleDocumentStatusChange(doc.id, 'foodSafetyLicenseStatus', 'approved')}
                        disabled={updateDocumentMutation.isPending}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => handleDocumentStatusChange(doc.id, 'foodSafetyLicenseStatus', 'rejected')}
                        disabled={updateDocumentMutation.isPending}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>

                  {/* Food Establishment Certificate */}
                  {doc.foodEstablishmentCertUrl && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium">Food Establishment Certificate</h4>
                        <Badge className={`${
                          doc.foodEstablishmentCertStatus === 'approved' ? 'bg-green-100 text-green-800' :
                          doc.foodEstablishmentCertStatus === 'rejected' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {getStatusIcon(doc.foodEstablishmentCertStatus || 'pending')}
                          {doc.foodEstablishmentCertStatus || 'pending'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <a
                          href={doc.foodEstablishmentCertUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="h-4 w-4" />
                          View Document
                        </a>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-600 border-green-200 hover:bg-green-50"
                          onClick={() => handleDocumentStatusChange(doc.id, 'foodEstablishmentCertStatus', 'approved')}
                          disabled={updateDocumentMutation.isPending}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 border-red-200 hover:bg-red-50"
                          onClick={() => handleDocumentStatusChange(doc.id, 'foodEstablishmentCertStatus', 'rejected')}
                          disabled={updateDocumentMutation.isPending}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Admin Feedback */}
                <div className="mt-6 pt-4 border-t">
                  <Label htmlFor={`feedback-${doc.id}`} className="text-sm font-medium">
                    Admin Feedback
                  </Label>
                  <Textarea
                    id={`feedback-${doc.id}`}
                    placeholder="Add feedback for the applicant..."
                    defaultValue={doc.adminFeedback || ''}
                    className="mt-2"
                    rows={3}
                    onBlur={(e) => {
                      if (e.target.value !== (doc.adminFeedback || '')) {
                        updateDocumentMutation.mutate({
                          id: doc.id,
                          adminFeedback: e.target.value,
                        });
                      }
                    }}
                  />
                </div>

                {doc.reviewedAt && (
                  <div className="mt-4 text-sm text-muted-foreground">
                    Last reviewed: {new Date(doc.reviewedAt).toLocaleDateString()}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
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
