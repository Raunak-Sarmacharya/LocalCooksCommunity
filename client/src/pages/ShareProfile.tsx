import { useChefProfiles } from "@/hooks/use-chef-kitchen-access";
import { useAdminChefKitchenAccess } from "@/hooks/use-chef-kitchen-access";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { MapPin, Share2, CheckCircle, Clock, XCircle, AlertCircle, FileText } from "lucide-react";
import { Link } from "wouter";

export default function ShareProfile() {
  const { profiles, isLoading, shareProfile, refetch } = useChefProfiles();
  const { accessData } = useAdminChefKitchenAccess(); // This gives us locations the chef has access to
  const { toast } = useToast();

  // Get locations the chef has access to from profiles
  // Note: profiles have kitchenId, we need to map to locations
  const accessibleLocations = profiles.map(p => ({
    id: p.kitchenId, // ChefProfile has kitchenId, not locationId
    name: `Kitchen ${p.kitchenId}`, // Location name not directly available in ChefProfile
    address: undefined,
    profile: p.profile,
  }));

  const handleShareProfile = async (locationId: number) => {
    try {
      await shareProfile.mutateAsync(locationId);
      toast({
        title: "Profile Shared",
        description: "Your profile has been shared with the location. The manager will review it soon.",
      });
      refetch();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to share profile",
        variant: "destructive",
      });
    }
  };

  const getProfileStatus = (locationId: number) => {
    const profile = profiles.find(p => p.kitchenId === locationId);
    return profile?.profile;
  };

  const getStatusBadge = (status: 'pending' | 'approved' | 'rejected' | undefined) => {
    if (!status) {
      return (
        <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
          Not Shared
        </span>
      );
    }
    
    switch (status) {
      case 'pending':
        return (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            <Clock className="inline h-3 w-3 mr-1" />
            Pending Approval
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
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <Header />
        <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-12">
          <div className="container mx-auto px-4 py-8 max-w-7xl">
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              <p className="text-gray-600 mt-4">Loading locations...</p>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (accessibleLocations.length === 0) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <Header />
        <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-12">
          <div className="container mx-auto px-4 py-8 max-w-7xl">
            <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
              <AlertCircle className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">No Locations Available</h2>
              <p className="text-gray-600 max-w-md mx-auto mb-6">
                You don't have access to any locations yet. Please contact an administrator to grant you access.
              </p>
              <Link href="/dashboard">
                <Button>Back to Dashboard</Button>
              </Link>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-12">
        <div className="container mx-auto px-4 py-8 max-w-7xl">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Share Your Profile with Locations</h1>
            <p className="text-gray-600 text-lg">
              Share your application and documents with location managers. They'll review your profile before approving you for kitchen bookings.
            </p>
          </div>

          {/* Info Banner */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="text-sm text-blue-900 font-medium mb-1">What gets shared?</p>
                <p className="text-sm text-blue-800">
                  When you share your profile, location managers will see your application details including your name, 
                  contact information, and all documents you uploaded during your application process. Once approved, you'll have access to all kitchens in that location.
                </p>
              </div>
            </div>
          </div>

          {/* Locations Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {accessibleLocations.map((location) => {
              const profile = getProfileStatus(location.id);
              const isPending = profile?.status === 'pending';
              const isApproved = profile?.status === 'approved';
              const isRejected = profile?.status === 'rejected';

              return (
                <div
                  key={location.id}
                  className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
                >
                  {/* Location Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <MapPin className="h-6 w-6 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 truncate">{location.name}</h3>
                        {location.address && (
                          <p className="text-sm text-gray-600 mt-1">{location.address}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div className="mb-4">
                    {getStatusBadge(profile?.status)}
                  </div>

                  {/* Profile Details if shared */}
                  {profile && (
                    <div className="mb-4 text-sm text-gray-600 space-y-1">
                      <p>
                        <span className="font-medium">Shared:</span>{" "}
                        {new Date(profile.sharedAt).toLocaleDateString()}
                      </p>
                      {profile.reviewedAt && (
                        <p>
                          <span className="font-medium">Reviewed:</span>{" "}
                          {new Date(profile.reviewedAt).toLocaleDateString()}
                        </p>
                      )}
                      {profile.reviewFeedback && (
                        <div className="mt-2 p-2 bg-gray-50 rounded text-xs">
                          <span className="font-medium">Manager Feedback:</span>
                          <p className="mt-1">{profile.reviewFeedback}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action Button */}
                  <div className="mt-4">
                    {!profile ? (
                      <Button
                        onClick={() => handleShareProfile(location.id)}
                        disabled={shareProfile.isPending}
                        className="w-full bg-blue-600 hover:bg-blue-700"
                      >
                        {shareProfile.isPending ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                            Sharing...
                          </>
                        ) : (
                          <>
                            <Share2 className="mr-2 h-4 w-4" />
                            Share Profile
                          </>
                        )}
                      </Button>
                    ) : isRejected ? (
                      <Button
                        onClick={() => handleShareProfile(location.id)}
                        disabled={shareProfile.isPending}
                        className="w-full bg-blue-600 hover:bg-blue-700"
                      >
                        <Share2 className="mr-2 h-4 w-4" />
                        Share Again
                      </Button>
                    ) : isApproved ? (
                      <Link href="/book-kitchen" className="block">
                        <Button className="w-full bg-green-600 hover:bg-green-700">
                          <CheckCircle className="mr-2 h-4 w-4" />
                          Book Kitchens
                        </Button>
                      </Link>
                    ) : (
                      <Button disabled className="w-full bg-gray-300 cursor-not-allowed">
                        <Clock className="mr-2 h-4 w-4" />
                        Waiting for Approval
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Back Button */}
          <div className="mt-8">
            <Link href="/dashboard">
              <Button variant="outline">Back to Dashboard</Button>
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

