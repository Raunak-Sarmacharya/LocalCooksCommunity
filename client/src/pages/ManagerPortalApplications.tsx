import { useManagerPortalApplications } from "@/hooks/use-manager-portal-applications";
import ManagerHeader from "@/components/layout/ManagerHeader";
import Footer from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { 
  User, 
  MapPin, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Mail, 
  Phone,
  Building2,
  AlertCircle,
  Loader2
} from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ManagerPortalApplicationsProps {
  embedded?: boolean;
}

export default function ManagerPortalApplications({ embedded = false }: ManagerPortalApplicationsProps) {
  const { applications, isLoading, updateApplicationStatus } = useManagerPortalApplications();
  const { toast } = useToast();
  const [selectedApplication, setSelectedApplication] = useState<any | null>(null);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState("");

  const handleApprove = async (applicationId: number) => {
    try {
      await updateApplicationStatus.mutateAsync({
        id: applicationId,
        status: 'approved',
        feedback: reviewFeedback || undefined,
      });
      toast({
        title: "Application Approved",
        description: "Portal user can now access their assigned location and book kitchens.",
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

  const handleReject = async (applicationId: number) => {
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
        id: applicationId,
        status: 'rejected',
        feedback: reviewFeedback,
      });
      toast({
        title: "Application Rejected",
        description: "Portal user has been notified.",
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
    setShowReviewDialog(true);
    setReviewFeedback(application.feedback || "");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading portal applications...</p>
        </div>
      </div>
    );
  }

  const pendingApplications = applications.filter(app => app.status === 'inReview');
  const approvedApplications = applications.filter(app => app.status === 'approved');
  const rejectedApplications = applications.filter(app => app.status === 'rejected');

  const content = (
    <>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Portal User Applications</h1>
        <p className="text-gray-600">
          Review and approve third-party portal user applications for your locations.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Pending Review</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-600">{pendingApplications.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Approved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{approvedApplications.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Rejected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{rejectedApplications.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Pending Applications */}
      {pendingApplications.length > 0 ? (
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Pending Review</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pendingApplications.map((application) => (
              <ApplicationCard
                key={application.id}
                application={application}
                onReview={() => openReviewDialog(application)}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="mb-8">
          <Card>
            <CardContent className="py-12 text-center">
              <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Pending Applications</h3>
              <p className="text-gray-600">All portal user applications have been reviewed.</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Review Dialog */}
      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review Portal User Application</DialogTitle>
            <DialogDescription>
              Review the application details and provide feedback.
            </DialogDescription>
          </DialogHeader>

          {selectedApplication && (
            <div className="space-y-6">
              {/* Application Details */}
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Location</label>
                  <div className="mt-1 p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-gray-500" />
                      <span className="font-medium">{selectedApplication.location.name}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-sm text-gray-600">
                      <MapPin className="h-3 w-3" />
                      <span>{selectedApplication.location.address}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700">Full Name</label>
                    <div className="mt-1 p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-gray-500" />
                        <span>{selectedApplication.fullName}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-700">Username</label>
                    <div className="mt-1 p-3 bg-gray-50 rounded-lg">
                      <span>{selectedApplication.user.username}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700">Email</label>
                    <div className="mt-1 p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-gray-500" />
                        <span>{selectedApplication.email}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-700">Phone</label>
                    <div className="mt-1 p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-gray-500" />
                        <span>{selectedApplication.phone}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {selectedApplication.company && (
                  <div>
                    <label className="text-sm font-medium text-gray-700">Company</label>
                    <div className="mt-1 p-3 bg-gray-50 rounded-lg">
                      <span>{selectedApplication.company}</span>
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium text-gray-700">Applied On</label>
                  <div className="mt-1 p-3 bg-gray-50 rounded-lg">
                    <span>{new Date(selectedApplication.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>

              {/* Feedback */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Feedback (Optional)
                </label>
                <Textarea
                  value={reviewFeedback}
                  onChange={(e) => setReviewFeedback(e.target.value)}
                  placeholder="Provide feedback for the applicant..."
                  rows={4}
                  className="w-full"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowReviewDialog(false);
                    setSelectedApplication(null);
                    setReviewFeedback("");
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                {selectedApplication.status === 'inReview' && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => handleReject(selectedApplication.id)}
                      disabled={updateApplicationStatus.isPending || !reviewFeedback.trim()}
                      className="flex-1 border-red-300 text-red-700 hover:bg-red-50"
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Reject
                    </Button>
                    <Button
                      onClick={() => handleApprove(selectedApplication.id)}
                      disabled={updateApplicationStatus.isPending}
                      className="flex-1 bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Approve
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <ManagerHeader />
      <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-12">
        <div className="container mx-auto px-4 py-8 max-w-7xl">
          {content}
        </div>
      </main>
      <Footer />
    </div>
  );
}

// Application Card Component
function ApplicationCard({ application, onReview }: { application: any; onReview: () => void }) {
  const getStatusBadge = () => {
    const status = application.status;
    switch (status) {
      case 'inReview':
        return (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 whitespace-nowrap flex-shrink-0">
            <Clock className="inline h-3 w-3 mr-1" />
            Pending
          </span>
        );
      case 'approved':
        return (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 whitespace-nowrap flex-shrink-0">
            <CheckCircle className="inline h-3 w-3 mr-1" />
            Approved
          </span>
        );
      case 'rejected':
        return (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 whitespace-nowrap flex-shrink-0">
            <XCircle className="inline h-3 w-3 mr-1" />
            Rejected
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-gray-500" />
            <CardTitle className="text-lg">{application.fullName}</CardTitle>
          </div>
          {getStatusBadge()}
        </div>
        <CardDescription>
          <div className="flex items-center gap-2 mt-2">
            <Building2 className="h-4 w-4" />
            <span>{application.location.name}</span>
          </div>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Mail className="h-4 w-4" />
          <span>{application.email}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Phone className="h-4 w-4" />
          <span>{application.phone}</span>
        </div>
        {application.company && (
          <div className="text-sm text-gray-600">
            <span className="font-medium">Company:</span> {application.company}
          </div>
        )}
        <div className="text-xs text-gray-500 pt-2 border-t">
          Applied: {new Date(application.createdAt).toLocaleDateString()}
        </div>
        {application.status === 'inReview' && (
          <Button
            onClick={onReview}
            className="w-full mt-3"
            variant="default"
          >
            Review Application
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

