import { logger } from "@/lib/logger";
import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { updateProfile } from "firebase/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import { User, Mail, Phone, Loader2, KeyRound } from "lucide-react";
import ManagerHeader from "@/components/layout/ManagerHeader";
import ChangePassword from "@/components/auth/ChangePassword";

export default function ManagerProfile() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: firebaseUser } = useFirebaseAuth();
  
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
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
        logger.error('Error fetching user profile:', error);
        return null;
      }
    },
    enabled: !!firebaseUser,
    retry: false,
    staleTime: 30 * 1000,
  });

  // Fetch manager profile details
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
            return { phone: null, displayName: null };
          }
          throw new Error(`Failed to fetch manager profile: ${response.status}`);
        }
        
        return response.json();
      } catch (error) {
        logger.error('Error fetching manager profile:', error);
        return { phone: null, displayName: null };
      }
    },
    enabled: !!user && user.role === 'manager',
    retry: false,
  });

  // Initialize form fields when data loads
  // Priority for displayName: Firebase Auth > managerProfile > user record
  useEffect(() => {
    if (user) {
      setUsername(user.username || "");
      setEmail(user.email || firebaseUser?.email || "");
    }
    // Set displayName with priority: Firebase Auth displayName first
    const firebaseDisplayName = auth.currentUser?.displayName;
    if (firebaseDisplayName) {
      setDisplayName(firebaseDisplayName);
    } else if (managerProfile?.displayName) {
      setDisplayName(managerProfile.displayName);
    } else if (user?.displayName || user?.fullName) {
      setDisplayName(user.displayName || user.fullName || "");
    }
    if (managerProfile) {
      setPhone(managerProfile.phone || "");
    }
  }, [user, managerProfile, firebaseUser]);

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (profileData: {
      username?: string;
      displayName?: string;
      phone?: string;
    }) => {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }
      
      // IMPORTANT: Update Firebase Auth displayName if it changed
      if (profileData.displayName) {
        try {
          await updateProfile(currentFirebaseUser, {
            displayName: profileData.displayName,
          });
          logger.info('✅ Firebase Auth displayName updated:', profileData.displayName);
        } catch (firebaseError) {
          logger.error('❌ Failed to update Firebase Auth displayName:', firebaseError);
          // Continue with Neon update even if Firebase update fails
        }
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

  const saveProfileAction = useStatusButton(
    useCallback(async () => {
      await updateProfileMutation.mutateAsync({
        username: username !== user?.username ? username : undefined,
        displayName: displayName || undefined,
        phone: phone || undefined,
      });
    }, [updateProfileMutation, username, user?.username, displayName, phone]),
  );

  if (isLoadingProfile || isLoadingDetails) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-blue-50">
        <ManagerHeader />
        <div className="pt-24 pb-12 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
        </div>
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
                  <StatusButton
                    status={saveProfileAction.status}
                    onClick={saveProfileAction.execute}
                    labels={{ idle: "Save Changes", loading: "Saving", success: "Saved" }}
                  />
                  <Button
                    onClick={() => {
                      setUsername(user.username || "");
                      // Reset to Firebase Auth displayName first, then fallback
                      const firebaseDisplayName = auth.currentUser?.displayName;
                      setDisplayName(firebaseDisplayName || managerProfile?.displayName || user.displayName || user.fullName || "");
                      setPhone(managerProfile?.phone || "");
                    }}
                    variant="outline"
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Reset
                  </Button>
                </div>
              </div>
            </div>

            {/* Change Password Section */}
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <KeyRound className="h-5 w-5 text-orange-600 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">Security</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Manage your password and account security.
                  </p>
                </div>
              </div>

              <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 md:p-6">
                <ChangePassword role="manager" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
