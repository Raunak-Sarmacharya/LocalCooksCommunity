import { useManagerKitchenApplications } from "@/hooks/use-manager-kitchen-applications";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  Calendar,
  Check,
  ChefHat,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Shield,
  User,
  XCircle,
} from "lucide-react";
import { useState, useEffect } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface ManagerKitchenApplicationsProps {
  embedded?: boolean;
  locationId?: number;
}

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: "spring", stiffness: 100 },
  },
};

export default function ManagerKitchenApplications({
  embedded = false,
  locationId,
}: ManagerKitchenApplicationsProps) {
  const {
    applications,
    pendingApplications,
    approvedApplications,
    rejectedApplications,
    pendingCount,
    approvedCount,
    isLoading,
    updateApplicationStatus,
    verifyDocuments,
    refetch,
  } = useManagerKitchenApplications();
  
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("pending");
  const [selectedApplication, setSelectedApplication] = useState<any | null>(null);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [showDocumentsDialog, setShowDocumentsDialog] = useState(false);
  const [documentsApplication, setDocumentsApplication] = useState<any | null>(null);
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
      // Wait a bit and try again
      await new Promise(resolve => setTimeout(resolve, 100));
      return getPresignedUrl(fileUrl);
    }

    // Check if it's an R2 URL (needs presigning)
    const isR2Url = fileUrl.includes('r2.cloudflarestorage.com') || 
                    fileUrl.includes('cloudflare') ||
                    (fileUrl.startsWith('http') && !fileUrl.startsWith('/api/files/'));

    if (!isR2Url) {
      // Not an R2 URL, return as-is
      return fileUrl;
    }

    try {
      setLoadingUrls(prev => new Set(prev).add(fileUrl));
      
      // Get auth token
      const { auth } = await import('@/lib/firebase');
      const currentUser = auth.currentUser;
      const token = currentUser ? await currentUser.getIdToken() : null;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      if (currentUser?.uid) {
        headers['X-User-ID'] = currentUser.uid;
      }

      const response = await fetch(`/api/files/r2-presigned?url=${encodeURIComponent(fileUrl)}`, {
        method: 'GET',
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed to get presigned URL: ${response.statusText}`);
      }

      const data = await response.json();
      const presignedUrl = data.url || fileUrl;

      // Cache the presigned URL
      setPresignedUrls(prev => ({ ...prev, [fileUrl]: presignedUrl }));
      return presignedUrl;
    } catch (error) {
      console.error('Error getting presigned URL:', error);
      // Fallback to original URL
      return fileUrl;
    } finally {
      setLoadingUrls(prev => {
        const next = new Set(prev);
        next.delete(fileUrl);
        return next;
      });
    }
  };

  // Filter by location if provided
  const filteredPending = locationId
    ? pendingApplications.filter((a) => a.locationId === locationId)
    : pendingApplications;
  const filteredApproved = locationId
    ? approvedApplications.filter((a) => a.locationId === locationId)
    : approvedApplications;
  const filteredRejected = locationId
    ? rejectedApplications.filter((a) => a.locationId === locationId)
    : rejectedApplications;

  const handleApprove = async () => {
    if (!selectedApplication) return;

    try {
      await updateApplicationStatus.mutateAsync({
        applicationId: selectedApplication.id,
        status: "approved",
        feedback: reviewFeedback || undefined,
      });
      toast({
        title: "Application Approved!",
        description: "Chef can now book kitchens at this location.",
      });
      setShowReviewDialog(false);
      setSelectedApplication(null);
      setReviewFeedback("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to approve application",
        variant: "destructive",
      });
    }
  };

  const handleReject = async () => {
    if (!selectedApplication) return;

    if (!reviewFeedback.trim()) {
      toast({
        title: "Feedback Required",
        description: "Please provide feedback when rejecting an application.",
        variant: "destructive",
      });
      return;
    }

    try {
      await updateApplicationStatus.mutateAsync({
        applicationId: selectedApplication.id,
        status: "rejected",
        feedback: reviewFeedback,
      });
      toast({
        title: "Application Rejected",
        description: "Chef has been notified.",
      });
      setShowReviewDialog(false);
      setSelectedApplication(null);
      setReviewFeedback("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to reject application",
        variant: "destructive",
      });
    }
  };

  const openReviewDialog = (application: any) => {
    setSelectedApplication(application);
    setReviewFeedback(application.feedback || "");
    setShowReviewDialog(true);
  };

  const openDocumentsDialog = async (application: any) => {
    setDocumentsApplication(application);
    setShowDocumentsDialog(true);
    
    // Pre-fetch presigned URLs for documents
    if (application.foodSafetyLicenseUrl) {
      await getPresignedUrl(application.foodSafetyLicenseUrl);
    }
    if (application.foodEstablishmentCertUrl) {
      await getPresignedUrl(application.foodEstablishmentCertUrl);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "inReview":
        return (
          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
            <Clock className="h-3 w-3 mr-1" />
            Pending Review
          </Badge>
        );
      case "approved":
        return (
          <Badge className="bg-green-100 text-green-800 border-green-200">
            <Check className="h-3 w-3 mr-1" />
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge className="bg-red-100 text-red-800 border-red-200">
            <XCircle className="h-3 w-3 mr-1" />
            Rejected
          </Badge>
        );
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getDocStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="text-yellow-600 border-yellow-300">Pending</Badge>;
      case "approved":
        return <Badge variant="outline" className="text-green-600 border-green-300">Verified</Badge>;
      case "rejected":
        return <Badge variant="outline" className="text-red-600 border-red-300">Rejected</Badge>;
      default:
        return null;
    }
  };

  const ApplicationCard = ({ application }: { application: any }) => (
    <motion.div variants={itemVariants}>
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
              <User className="h-6 w-6 text-white" />
            </div>

            {/* Main Content */}
            <div className="flex-1 min-w-0">
              {/* Header Row */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="font-semibold text-lg">{application.fullName}</h3>
                  <p className="text-sm text-gray-600">{application.location?.name || "Unknown Location"}</p>
                </div>
                {getStatusBadge(application.status)}
              </div>

              {/* Contact Info */}
              <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-600">
                <span className="flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" />
                  {application.email}
                </span>
                <span className="flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" />
                  {application.phone}
                </span>
              </div>

              {/* Kitchen Preference */}
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="secondary">
                  <ChefHat className="h-3 w-3 mr-1" />
                  {application.kitchenPreference === "commercial"
                    ? "Commercial Kitchen"
                    : application.kitchenPreference === "home"
                    ? "Home Kitchen"
                    : "Not Sure"}
                </Badge>
                
                {application.foodSafetyLicense === "yes" && (
                  <Badge variant="secondary" className="bg-green-50 text-green-700">
                    <Shield className="h-3 w-3 mr-1" />
                    Food Safety License
                  </Badge>
                )}
                
                {application.foodEstablishmentCert === "yes" && (
                  <Badge variant="secondary" className="bg-blue-50 text-blue-700">
                    <FileText className="h-3 w-3 mr-1" />
                    Food Establishment Cert
                  </Badge>
                )}
              </div>

              {/* Timestamps */}
              <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Applied: {new Date(application.createdAt).toLocaleDateString()}
                </span>
                {application.reviewedAt && (
                  <span>
                    Reviewed: {new Date(application.reviewedAt).toLocaleDateString()}
                  </span>
                )}
              </div>

              {/* Feedback if rejected */}
              {application.status === "rejected" && application.feedback && (
                <div className="mt-3 p-3 bg-red-50 rounded-lg text-sm text-red-800">
                  <strong>Rejection Reason:</strong> {application.feedback}
                </div>
              )}

              {/* Actions */}
              <div className="mt-4 flex gap-2 flex-wrap">
                {/* View Documents */}
                {(application.foodSafetyLicenseUrl || application.foodEstablishmentCertUrl) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openDocumentsDialog(application)}
                  >
                    <Eye className="mr-1 h-4 w-4" />
                    View Documents
                  </Button>
                )}

                {/* Review Actions */}
                {application.status === "inReview" && (
                  <Button
                    size="sm"
                    onClick={() => openReviewDialog(application)}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Check className="mr-1 h-4 w-4" />
                    Review
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8">
          <div className="flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const content = (
    <>
      {/* Stats Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="p-4 bg-yellow-50 rounded-xl text-center">
          <p className="text-3xl font-bold text-yellow-600">{filteredPending.length}</p>
          <p className="text-sm text-gray-600">Pending</p>
        </div>
        <div className="p-4 bg-green-50 rounded-xl text-center">
          <p className="text-3xl font-bold text-green-600">{filteredApproved.length}</p>
          <p className="text-sm text-gray-600">Approved</p>
        </div>
        <div className="p-4 bg-red-50 rounded-xl text-center">
          <p className="text-3xl font-bold text-red-600">{filteredRejected.length}</p>
          <p className="text-sm text-gray-600">Rejected</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="pending">
            <Clock className="h-4 w-4 mr-2" />
            Pending ({filteredPending.length})
          </TabsTrigger>
          <TabsTrigger value="approved">
            <Check className="h-4 w-4 mr-2" />
            Approved ({filteredApproved.length})
          </TabsTrigger>
          <TabsTrigger value="rejected">
            <XCircle className="h-4 w-4 mr-2" />
            Rejected ({filteredRejected.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          {filteredPending.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-xl">
              <Clock className="h-12 w-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">No pending applications</p>
              <p className="text-sm text-gray-500 mt-1">
                New applications will appear here for review
              </p>
            </div>
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="space-y-4"
            >
              {filteredPending.map((app) => (
                <ApplicationCard key={app.id} application={app} />
              ))}
            </motion.div>
          )}
        </TabsContent>

        <TabsContent value="approved">
          {filteredApproved.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-xl">
              <Check className="h-12 w-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">No approved applications</p>
            </div>
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="space-y-4"
            >
              {filteredApproved.map((app) => (
                <ApplicationCard key={app.id} application={app} />
              ))}
            </motion.div>
          )}
        </TabsContent>

        <TabsContent value="rejected">
          {filteredRejected.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-xl">
              <XCircle className="h-12 w-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">No rejected applications</p>
            </div>
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="space-y-4"
            >
              {filteredRejected.map((app) => (
                <ApplicationCard key={app.id} application={app} />
              ))}
            </motion.div>
          )}
        </TabsContent>
      </Tabs>

      {/* Review Dialog */}
      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Review Application</DialogTitle>
            <DialogDescription>
              Review {selectedApplication?.fullName}'s application for{" "}
              {selectedApplication?.location?.name}
            </DialogDescription>
          </DialogHeader>

          {selectedApplication && (
            <div className="space-y-4">
              {/* Applicant Info Summary */}
              <div className="p-4 bg-gray-50 rounded-lg space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Email:</span>
                  <span>{selectedApplication.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Phone:</span>
                  <span>{selectedApplication.phone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Kitchen Type:</span>
                  <span className="capitalize">{selectedApplication.kitchenPreference}</span>
                </div>
                {selectedApplication.foodSafetyLicense === "yes" && (
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Food Safety License:</span>
                      <div className="flex items-center gap-2">
                        {selectedApplication.foodSafetyLicenseUrl && (
                          <a
                            href={presignedUrls[selectedApplication.foodSafetyLicenseUrl] || 
                              (selectedApplication.foodSafetyLicenseUrl?.includes('r2.cloudflarestorage.com') 
                                ? `/api/files/r2-proxy?url=${encodeURIComponent(selectedApplication.foodSafetyLicenseUrl)}`
                                : selectedApplication.foodSafetyLicenseUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline text-xs flex items-center"
                            onClick={async (e) => {
                              const url = selectedApplication.foodSafetyLicenseUrl;
                              if (url && !presignedUrls[url] && url.includes('r2.cloudflarestorage.com')) {
                                e.preventDefault();
                                const presignedUrl = await getPresignedUrl(url);
                                window.open(presignedUrl, '_blank');
                              }
                            }}
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            View
                          </a>
                        )}
                        {getDocStatusBadge(selectedApplication.foodSafetyLicenseStatus)}
                      </div>
                    </div>
                    {selectedApplication.foodSafetyLicenseExpiry && (
                      <div className="flex justify-between items-center">
                        <span className="text-gray-500 text-xs">Expiry Date:</span>
                        <span className="text-xs font-medium text-gray-700">
                          {new Date(selectedApplication.foodSafetyLicenseExpiry).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {selectedApplication.foodEstablishmentCert === "yes" && (
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Establishment Cert:</span>
                      <div className="flex items-center gap-2">
                        {selectedApplication.foodEstablishmentCertUrl && (
                          <a
                            href={presignedUrls[selectedApplication.foodEstablishmentCertUrl] || selectedApplication.foodEstablishmentCertUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline text-xs flex items-center"
                            onClick={async (e) => {
                              if (!presignedUrls[selectedApplication.foodEstablishmentCertUrl]) {
                                e.preventDefault();
                                const url = await getPresignedUrl(selectedApplication.foodEstablishmentCertUrl);
                                window.open(url, '_blank');
                              }
                            }}
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            View
                          </a>
                        )}
                        {getDocStatusBadge(selectedApplication.foodEstablishmentCertStatus)}
                      </div>
                    </div>
                    {selectedApplication.foodEstablishmentCertExpiry && (
                      <div className="flex justify-between items-center">
                        <span className="text-gray-500 text-xs">Expiry Date:</span>
                        <span className="text-xs font-medium text-gray-700">
                          {new Date(selectedApplication.foodEstablishmentCertExpiry).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Business Description */}
              {selectedApplication.businessDescription && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">Business Description:</p>
                  <p className="text-sm text-gray-600 p-3 bg-gray-50 rounded-lg">
                    {selectedApplication.businessDescription}
                  </p>
                </div>
              )}

              {/* Feedback Input */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">
                  Feedback (required for rejection)
                </label>
                <Textarea
                  value={reviewFeedback}
                  onChange={(e) => setReviewFeedback(e.target.value)}
                  placeholder="Enter feedback for the applicant..."
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setShowReviewDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={updateApplicationStatus.isPending}
            >
              {updateApplicationStatus.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <XCircle className="h-4 w-4 mr-1" />
              )}
              Reject
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={handleApprove}
              disabled={updateApplicationStatus.isPending}
            >
              {updateApplicationStatus.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Check className="h-4 w-4 mr-1" />
              )}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Documents Dialog */}
      <Dialog open={showDocumentsDialog} onOpenChange={setShowDocumentsDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Application Documents</DialogTitle>
            <DialogDescription>
              Review documents submitted by {documentsApplication?.fullName}
            </DialogDescription>
          </DialogHeader>

          {documentsApplication && (
            <div className="space-y-4">
              {/* Food Safety License */}
              {documentsApplication.foodSafetyLicenseUrl && (
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Shield className="h-5 w-5 text-blue-600" />
                      <span className="font-medium">Food Safety License</span>
                    </div>
                    {getDocStatusBadge(documentsApplication.foodSafetyLicenseStatus)}
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={presignedUrls[documentsApplication.foodSafetyLicenseUrl] || 
                        (documentsApplication.foodSafetyLicenseUrl?.includes('r2.cloudflarestorage.com') 
                          ? `/api/files/r2-proxy?url=${encodeURIComponent(documentsApplication.foodSafetyLicenseUrl)}`
                          : documentsApplication.foodSafetyLicenseUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={async (e) => {
                        const url = documentsApplication.foodSafetyLicenseUrl;
                        if (url && !presignedUrls[url] && url.includes('r2.cloudflarestorage.com')) {
                          e.preventDefault();
                          const presignedUrl = await getPresignedUrl(url);
                          window.open(presignedUrl, '_blank');
                        }
                      }}
                    >
                      <Button variant="outline" size="sm" disabled={loadingUrls.has(documentsApplication.foodSafetyLicenseUrl)}>
                        {loadingUrls.has(documentsApplication.foodSafetyLicenseUrl) ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <ExternalLink className="h-4 w-4 mr-1" />
                        )}
                        View Document
                      </Button>
                    </a>
                    <a
                      href={presignedUrls[documentsApplication.foodSafetyLicenseUrl] || 
                        (documentsApplication.foodSafetyLicenseUrl?.includes('r2.cloudflarestorage.com') 
                          ? `/api/files/r2-proxy?url=${encodeURIComponent(documentsApplication.foodSafetyLicenseUrl)}`
                          : documentsApplication.foodSafetyLicenseUrl)}
                      download
                      onClick={async (e) => {
                        if (!presignedUrls[documentsApplication.foodSafetyLicenseUrl]) {
                          e.preventDefault();
                          const url = await getPresignedUrl(documentsApplication.foodSafetyLicenseUrl);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = '';
                          a.click();
                        }
                      }}
                    >
                      <Button variant="outline" size="sm" disabled={loadingUrls.has(documentsApplication.foodSafetyLicenseUrl)}>
                        {loadingUrls.has(documentsApplication.foodSafetyLicenseUrl) ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4 mr-1" />
                        )}
                        Download
                      </Button>
                    </a>
                  </div>
                </div>
              )}

              {/* Food Establishment Cert */}
              {documentsApplication.foodEstablishmentCertUrl && (
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-green-600" />
                      <span className="font-medium">Food Establishment Certificate</span>
                    </div>
                    {getDocStatusBadge(documentsApplication.foodEstablishmentCertStatus)}
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={presignedUrls[documentsApplication.foodEstablishmentCertUrl] || 
                        (documentsApplication.foodEstablishmentCertUrl?.includes('r2.cloudflarestorage.com') 
                          ? `/api/files/r2-proxy?url=${encodeURIComponent(documentsApplication.foodEstablishmentCertUrl)}`
                          : documentsApplication.foodEstablishmentCertUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={async (e) => {
                        const url = documentsApplication.foodEstablishmentCertUrl;
                        if (url && !presignedUrls[url] && url.includes('r2.cloudflarestorage.com')) {
                          e.preventDefault();
                          const presignedUrl = await getPresignedUrl(url);
                          window.open(presignedUrl, '_blank');
                        }
                      }}
                    >
                      <Button variant="outline" size="sm" disabled={loadingUrls.has(documentsApplication.foodEstablishmentCertUrl)}>
                        {loadingUrls.has(documentsApplication.foodEstablishmentCertUrl) ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <ExternalLink className="h-4 w-4 mr-1" />
                        )}
                        View Document
                      </Button>
                    </a>
                    <a
                      href={presignedUrls[documentsApplication.foodEstablishmentCertUrl] || 
                        (documentsApplication.foodEstablishmentCertUrl?.includes('r2.cloudflarestorage.com') 
                          ? `/api/files/r2-proxy?url=${encodeURIComponent(documentsApplication.foodEstablishmentCertUrl)}`
                          : documentsApplication.foodEstablishmentCertUrl)}
                      download
                      onClick={async (e) => {
                        const url = documentsApplication.foodEstablishmentCertUrl;
                        if (url && !presignedUrls[url] && url.includes('r2.cloudflarestorage.com')) {
                          e.preventDefault();
                          const presignedUrl = await getPresignedUrl(url);
                          const a = document.createElement('a');
                          a.href = presignedUrl;
                          a.download = '';
                          a.click();
                        }
                      }}
                    >
                      <Button variant="outline" size="sm" disabled={loadingUrls.has(documentsApplication.foodEstablishmentCertUrl)}>
                        {loadingUrls.has(documentsApplication.foodEstablishmentCertUrl) ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4 mr-1" />
                        )}
                        Download
                      </Button>
                    </a>
                  </div>
                </div>
              )}

              {!documentsApplication.foodSafetyLicenseUrl && !documentsApplication.foodEstablishmentCertUrl && (
                <div className="text-center py-8 bg-gray-50 rounded-lg">
                  <AlertCircle className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600">No documents uploaded</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setShowDocumentsDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ChefHat className="h-5 w-5 text-blue-600" />
          Chef Applications
        </CardTitle>
        <CardDescription>
          Review and manage chef applications to your kitchens
        </CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}

