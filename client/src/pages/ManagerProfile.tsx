import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Save, User, Mail, Phone, Image as ImageIcon, Loader2 } from "lucide-react";
import ManagerHeader from "@/components/layout/ManagerHeader";
import Footer from "@/components/layout/Footer";
import { ImageWithReplace } from "@/components/ui/image-with-replace";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";

export default function ManagerProfile() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: firebaseUser } = useFirebaseAuth();
  
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");

  // Fetch manager profile
  const { data: user, isLoading: isLoadingProfile } = useQuery({
    queryKey: ["/api/user/profile", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return null;
      try {
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) return null;
        const token = await currentFirebaseUser.getIdToken();
        const response = await fetch("/api/user/profile", {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            return null;
          }
          throw new Error(`Failed to fetch profile: ${response.status}`);
        }
        
        const userData = await response.json();
        return userData;
      } catch (error) {
        console.error('Error fetching user profile:', error);
        return null;
      }
    },
    enabled: !!firebaseUser,
    retry: false,
    staleTime: 30 * 1000,
  });

  // Fetch manager profile details (including profile image)
  const { data: managerProfile, isLoading: isLoadingDetails } = useQuery({
    queryKey: ["/api/manager/profile"],
    queryFn: async () => {
      try {
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) return null;
        const token = await currentFirebaseUser.getIdToken();
        const response = await fetch("/api/manager/profile", {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          credentials: 'include',
        });
        
        if (!response.ok) {
          if (response.status === 404) {
            // Profile doesn't exist yet, return empty object
            return { profileImageUrl: null, phone: null, displayName: null };
          }
          throw new Error(`Failed to fetch manager profile: ${response.status}`);
        }
        
        return response.json();
      } catch (error) {
        console.error('Error fetching manager profile:', error);
        return { profileImageUrl: null, phone: null, displayName: null };
      }
    },
    enabled: !!user && user.role === 'manager',
    retry: false,
  });

  // Initialize form fields when data loads
  useEffect(() => {
    if (user) {
      setUsername(user.username || "");
      setEmail(user.email || firebaseUser?.email || "");
      setDisplayName(user.displayName || user.fullName || "");
    }
    if (managerProfile) {
      setProfileImageUrl(managerProfile.profileImageUrl || null);
      setPhone(managerProfile.phone || "");
      if (managerProfile.displayName) {
        setDisplayName(managerProfile.displayName);
      }
    }
  }, [user, managerProfile, firebaseUser]);

  // File upload hook for profile image
  const { uploadFile, isUploading: isUploadingImage } = useSessionFileUpload({
    maxSize: 4.5 * 1024 * 1024, // 4.5MB
    allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    onSuccess: (response) => {
      setProfileImageUrl(response.url);
      toast({
        title: 'Image uploaded',
        description: 'Profile image has been uploaded successfully.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Upload failed',
        description: error,
        variant: 'destructive',
      });
    },
  });

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (profileData: {
      username?: string;
      displayName?: string;
      phone?: string;
      profileImageUrl?: string | null;
    }) => {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }
      
      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch("/api/manager/profile", {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(profileData),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update profile');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/manager/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile", firebaseUser?.uid] });
      toast({
        title: "Profile updated",
        description: "Your profile has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update profile",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    updateProfileMutation.mutate({
      username: username !== user?.username ? username : undefined,
      displayName: displayName || undefined,
      phone: phone || undefined,
      profileImageUrl: profileImageUrl,
    });
  };

  if (isLoadingProfile || isLoadingDetails) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-blue-50">
        <ManagerHeader />
        <div className="pt-24 pb-12 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
        </div>
        <Footer />
      </div>
    );
  }

  if (!user || user.role !== 'manager') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-blue-50">
        <ManagerHeader />
        <div className="pt-24 pb-12 container mx-auto px-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-gray-600">Access denied. Manager access required.</p>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-blue-50">
      <ManagerHeader />
      <div className="pt-24 pb-12 container mx-auto px-4 max-w-4xl">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
            <p className="text-sm text-gray-600 mt-1">Manage your personal information and profile settings</p>
          </div>

          <div className="p-6 space-y-6">
            {/* Profile Image Section */}
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <ImageIcon className="h-5 w-5 text-blue-600 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">Profile Picture</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Upload a profile picture to personalize your account. This will be displayed in your manager dashboard.
                  </p>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 md:p-6">
                <div className="max-w-xs">
                  <ImageWithReplace
                    imageUrl={profileImageUrl}
                    onImageChange={(newUrl) => {
                      setProfileImageUrl(newUrl);
                      // Auto-save when image changes
                      if (newUrl) {
                        updateProfileMutation.mutate({ profileImageUrl: newUrl });
                      }
                    }}
                    onRemove={() => {
                      setProfileImageUrl(null);
                      updateProfileMutation.mutate({ profileImageUrl: null });
                    }}
                    alt="Profile picture"
                    className="w-full h-64 object-cover rounded-lg"
                    containerClassName="w-full"
                    aspectRatio="1/1"
                    fieldName="profileImage"
                    maxSize={4.5 * 1024 * 1024}
                    allowedTypes={['image/jpeg', 'image/jpg', 'image/png', 'image/webp']}
                  />
                </div>
              </div>
            </div>

            {/* Personal Information Section */}
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <User className="h-5 w-5 text-purple-600 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">Personal Information</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Update your personal details and contact information.
                  </p>
                </div>
              </div>

              <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 md:p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full max-w-md border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    placeholder="Enter username"
                  />
                  <p className="text-xs text-gray-600 mt-1">
                    Your unique username for login and identification
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full max-w-md border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    placeholder="Enter your full name"
                  />
                  <p className="text-xs text-gray-600 mt-1">
                    Your name as it appears to others
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    <Mail className="h-4 w-4 inline mr-1" />
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    disabled
                    className="w-full max-w-md border border-gray-300 rounded-lg px-4 py-2 bg-gray-100 text-gray-600 cursor-not-allowed"
                  />
                  <p className="text-xs text-gray-600 mt-1">
                    Email is managed through your Firebase account and cannot be changed here
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    <Phone className="h-4 w-4 inline mr-1" />
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full max-w-md border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    placeholder="+1 (555) 123-4567"
                  />
                  <p className="text-xs text-gray-600 mt-1">
                    Optional: Phone number for account recovery and notifications
                  </p>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    onClick={handleSave}
                    disabled={updateProfileMutation.isPending || isUploadingImage}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {updateProfileMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        Save Changes
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => {
                      setUsername(user.username || "");
                      setDisplayName(user.displayName || user.fullName || "");
                      setPhone(managerProfile?.phone || "");
                      setProfileImageUrl(managerProfile?.profileImageUrl || null);
                    }}
                    variant="outline"
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Reset
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
