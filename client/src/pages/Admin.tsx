import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Application } from "@shared/schema";
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
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "@/components/ui/accordion";
import { AlertCircle, CheckCircle, Clock, XCircle, CalendarDays, Filter, Search, User as UserIcon } from "lucide-react";

function AdminDashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");

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

  // Mutation to update application status
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number, status: string }) => {
      // Include user ID in headers for authentication
      const headers: Record<string, string> = {};
      if (user?.id) {
        headers['X-User-ID'] = user.id.toString();
      }

      const response = await apiRequest("PATCH", `/api/applications/${id}/status`, { status }, headers);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/applications"] });
      toast({
        title: "Status updated",
        description: "Application status has been updated successfully.",
      });
    },
    onError: (error) => {
      console.error("Status update error:", error);
      toast({
        title: "Error updating status",
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
    total: applications.length
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
                      <div className="text-4xl font-bold text-yellow-500">{statusCounts.new}</div>
                      <div className="text-sm mt-1 text-gray-600">New</div>
                    </CardContent>
                  </Card>

                  <Card className="bg-white shadow-sm border-2 border-blue-100">
                    <CardContent className="p-4 text-center">
                      <div className="text-4xl font-bold text-blue-500">{statusCounts.inReview}</div>
                      <div className="text-sm mt-1 text-gray-600">In Review</div>
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
                      <TabsTrigger value="new" className="flex items-center gap-1">
                        <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />
                        New
                      </TabsTrigger>
                      <TabsTrigger value="inReview" className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-blue-500" />
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
                          placeholder="Search applications..."
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
                  <TabsContent value="new" className="mt-0">
                    {renderApplicationList(applications.filter(app => app.status === "new"))}
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
}

export default function Admin() {
  return (
    <AdminProtectedRoute>
      <AdminDashboard />
    </AdminProtectedRoute>
  );
}
