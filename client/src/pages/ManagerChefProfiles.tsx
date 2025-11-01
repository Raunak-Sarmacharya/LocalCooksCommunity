import { useManagerChefProfiles } from "@/hooks/use-manager-chef-profiles";
import ManagerHeader from "@/components/layout/ManagerHeader";
import Footer from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { 
  User, 
  Building, 
  FileText, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Mail, 
  Phone,
  Download,
  Eye,
  AlertCircle
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

interface ManagerChefProfilesProps {
  embedded?: boolean;
}

export default function ManagerChefProfiles({ embedded = false }: ManagerChefProfilesProps) {
  const { profiles, isLoading, updateProfileStatus } = useManagerChefProfiles();
  const { toast } = useToast();
  const [selectedProfile, setSelectedProfile] = useState<any | null>(null);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState("");

  const handleApprove = async (profileId: number) => {
    try {
      await updateProfileStatus.mutateAsync({
        profileId,
        status: 'approved',
        reviewFeedback: reviewFeedback || undefined,
      });
      toast({
        title: "Profile Approved",
        description: "Chef can now book this kitchen.",
      });
      setShowReviewDialog(false);
      setSelectedProfile(null);
      setReviewFeedback("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to approve profile",
        variant: "destructive",
      });
    }
  };

  const handleReject = async (profileId: number) => {
    if (!reviewFeedback.trim()) {
      toast({
        title: "Feedback Required",
        description: "Please provide feedback when rejecting a profile.",
        variant: "destructive",
      });
      return;
    }
    
    try {
      await updateProfileStatus.mutateAsync({
        profileId,
        status: 'rejected',
        reviewFeedback,
      });
      toast({
        title: "Profile Rejected",
        description: "Chef has been notified.",
      });
      setShowReviewDialog(false);
      setSelectedProfile(null);
      setReviewFeedback("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to reject profile",
        variant: "destructive",
      });
    }
  };

  const openReviewDialog = (profile: any) => {
    setSelectedProfile(profile);
    setShowReviewDialog(true);
    setReviewFeedback(profile.reviewFeedback || "");
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            <Clock className="inline h-3 w-3 mr-1" />
            Pending
          </span>
        );
      case 'approved':
        return (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircle className="inline h-3 w-3 mr-1" />
            Approved
          </span>
        );
      case 'rejected':
        return (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
            <XCircle className="inline h-3 w-3 mr-1" />
            Rejected
          </span>
        );
      default:
        return null;
    }
  };

  const pendingProfiles = profiles.filter(p => p.status === 'pending');
  const otherProfiles = profiles.filter(p => p.status !== 'pending');

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <ManagerHeader />
        <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-12">
          <div className="container mx-auto px-4 py-8 max-w-7xl">
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              <p className="text-gray-600 mt-4">Loading chef profiles...</p>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const content = (
    <>
      {/* Header */}
      {!embedded && (
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Chef Profiles</h1>
          <p className="text-gray-600 text-lg">
            Review chef profiles and documents. Approve chefs to allow them to book your kitchens.
          </p>
        </div>
      )}

      {embedded && (
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Chef Profiles</h2>
          <p className="text-gray-600">
            Review chef profiles and documents. Approve chefs to allow them to book your kitchens.
          </p>
        </div>
      )}

          {/* Pending Profiles */}
          {pendingProfiles.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <AlertCircle className="h-5 w-5 text-yellow-600" />
                <h2 className="text-xl font-semibold text-gray-900">
                  Pending Review ({pendingProfiles.length})
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {pendingProfiles.map((profile) => (
                  <ProfileCard
                    key={profile.id}
                    profile={profile}
                    onReview={() => openReviewDialog(profile)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Other Profiles */}
          {otherProfiles.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                All Profiles ({profiles.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {otherProfiles.map((profile) => (
                  <ProfileCard
                    key={profile.id}
                    profile={profile}
                    onReview={() => openReviewDialog(profile)}
                  />
                ))}
              </div>
            </div>
          )}

          {profiles.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
              <User className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">No Chef Profiles</h2>
              <p className="text-gray-600 max-w-md mx-auto">
                No chefs have shared their profiles with your kitchens yet.
              </p>
            </div>
          )}
        </div>
      {/* Review Dialog */}
      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Chef Profile</DialogTitle>
            <DialogDescription>
              Review the chef's application and documents before approving or rejecting.
            </DialogDescription>
          </DialogHeader>

          {selectedProfile && (
            <div className="space-y-6">
              {/* Chef Info */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3">Chef Information</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-gray-600" />
                    <span className="font-medium">Username:</span> {selectedProfile.chef?.username}
                  </div>
                  {selectedProfile.kitchen && (
                    <div className="flex items-center gap-2">
                      <Building className="h-4 w-4 text-gray-600" />
                      <span className="font-medium">Kitchen:</span> {selectedProfile.kitchen.name}
                    </div>
                  )}
                </div>
              </div>

              {/* Application Details */}
              {selectedProfile.application && (
                <div className="bg-blue-50 rounded-lg p-4">
                  <h3 className="font-semibold text-gray-900 mb-3">Application Details</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-gray-600" />
                      <span className="font-medium">Name:</span> {selectedProfile.application.fullName}
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-gray-600" />
                      <span className="font-medium">Email:</span> {selectedProfile.application.email}
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-gray-600" />
                      <span className="font-medium">Phone:</span> {selectedProfile.application.phone}
                    </div>
                  </div>
                </div>
              )}

              {/* Documents */}
              {selectedProfile.application && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3">Documents</h3>
                  <div className="space-y-3">
                    {selectedProfile.application.foodSafetyLicenseUrl && (
                      <div className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg">
                        <div className="flex items-center gap-2">
                          <FileText className="h-5 w-5 text-blue-600" />
                          <span className="text-sm font-medium">Food Safety License</span>
                        </div>
                        <div className="flex gap-2">
                          <a
                            href={selectedProfile.application.foodSafetyLicenseUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 hover:bg-gray-100 rounded"
                          >
                            <Eye className="h-4 w-4 text-blue-600" />
                          </a>
                          <a
                            href={selectedProfile.application.foodSafetyLicenseUrl}
                            download
                            className="p-2 hover:bg-gray-100 rounded"
                          >
                            <Download className="h-4 w-4 text-gray-600" />
                          </a>
                        </div>
                      </div>
                    )}
                    {selectedProfile.application.foodEstablishmentCertUrl && (
                      <div className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg">
                        <div className="flex items-center gap-2">
                          <FileText className="h-5 w-5 text-blue-600" />
                          <span className="text-sm font-medium">Food Establishment Certificate</span>
                        </div>
                        <div className="flex gap-2">
                          <a
                            href={selectedProfile.application.foodEstablishmentCertUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 hover:bg-gray-100 rounded"
                          >
                            <Eye className="h-4 w-4 text-blue-600" />
                          </a>
                          <a
                            href={selectedProfile.application.foodEstablishmentCertUrl}
                            download
                            className="p-2 hover:bg-gray-100 rounded"
                          >
                            <Download className="h-4 w-4 text-gray-600" />
                          </a>
                        </div>
                      </div>
                    )}
                    {!selectedProfile.application.foodSafetyLicenseUrl &&
                      !selectedProfile.application.foodEstablishmentCertUrl && (
                        <p className="text-sm text-gray-500 text-center py-4">
                          No documents uploaded
                        </p>
                      )}
                  </div>
                </div>
              )}

              {/* Review Feedback */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Review Feedback {selectedProfile.status !== 'pending' && '(Optional)'}
                </label>
                <Textarea
                  value={reviewFeedback}
                  onChange={(e) => setReviewFeedback(e.target.value)}
                  placeholder="Add feedback or notes about this chef profile..."
                  rows={4}
                  className="w-full"
                />
                {selectedProfile.status === 'pending' && (
                  <p className="text-xs text-gray-500 mt-1">
                    Feedback is required when rejecting a profile.
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowReviewDialog(false);
                    setSelectedProfile(null);
                    setReviewFeedback("");
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                {selectedProfile.status === 'pending' && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => handleReject(selectedProfile.id)}
                      disabled={updateProfileStatus.isPending || !reviewFeedback.trim()}
                      className="flex-1 border-red-300 text-red-700 hover:bg-red-50"
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Reject
                    </Button>
                    <Button
                      onClick={() => handleApprove(selectedProfile.id)}
                      disabled={updateProfileStatus.isPending}
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

// Profile Card Component
function ProfileCard({ profile, onReview }: { profile: any; onReview: () => void }) {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            <Clock className="inline h-3 w-3 mr-1" />
            Pending
          </span>
        );
      case 'approved':
        return (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircle className="inline h-3 w-3 mr-1" />
            Approved
          </span>
        );
      case 'rejected':
        return (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
            <XCircle className="inline h-3 w-3 mr-1" />
            Rejected
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-3 flex-1">
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <User className="h-6 w-6 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">
              {profile.application?.fullName || profile.chef?.username || 'Unknown Chef'}
            </h3>
            {profile.kitchen && (
              <p className="text-sm text-gray-600 mt-1">{profile.kitchen.name}</p>
            )}
          </div>
        </div>
        {getStatusBadge(profile.status)}
      </div>

      {profile.application && (
        <div className="mb-4 space-y-1 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            <span className="truncate">{profile.application.email}</span>
          </div>
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4" />
            <span>{profile.application.phone}</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500 mb-4">
        <span>Shared: {new Date(profile.sharedAt).toLocaleDateString()}</span>
        {profile.reviewedAt && (
          <span>Reviewed: {new Date(profile.reviewedAt).toLocaleDateString()}</span>
        )}
      </div>

      <Button
        onClick={onReview}
        variant="outline"
        className="w-full"
      >
        <Eye className="mr-2 h-4 w-4" />
        {profile.status === 'pending' ? 'Review Profile' : 'View Details'}
      </Button>
    </div>
  );
}

