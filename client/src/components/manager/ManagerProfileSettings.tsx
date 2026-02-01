import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Loader2, Mail, Phone, User, KeyRound, Shield, 
  Camera, CheckCircle2, Building2, Edit3, Lock, MapPin, CreditCard, Clock
} from "lucide-react";
import ChangePassword from "@/components/auth/ChangePassword";
import { useFileUpload } from "@/hooks/useFileUpload";
import { cn } from "@/lib/utils";

export default function ManagerProfileSettings() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { user: firebaseUser } = useFirebaseAuth();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [isEditingProfile, setIsEditingProfile] = useState(false);

    // Avatar upload hook
    const { uploadFile, isUploading } = useFileUpload({
        maxSize: 2 * 1024 * 1024,
        allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
        onSuccess: (response) => {
            setAvatarUrl(response.url);
            // Save avatar URL to profile
            updateProfileMutation.mutate({ avatarUrl: response.url });
        },
        onError: (error) => {
            toast({
                title: 'Upload failed',
                description: error,
                variant: 'destructive',
            });
        },
    });

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
                        return { phone: null, displayName: null, profileImageUrl: null, stripeConnectStatus: 'not_started', locations: [] };
                    }
                    throw new Error(`Failed to fetch manager profile: ${response.status}`);
                }

                return response.json();
            } catch (error) {
                return { phone: null, displayName: null, profileImageUrl: null, stripeConnectStatus: 'not_started', locations: [] };
            }
        },
        enabled: !!user && user.role === 'manager',
    });

    // Initialize form fields
    useEffect(() => {
        if (user) {
            setUsername(user.username || "");
            setEmail(user.email || firebaseUser?.email || "");
            setDisplayName(user.displayName || user.fullName || "");
        }
        if (managerProfile) {
            setPhone(managerProfile.phone || "");
            if (managerProfile.displayName) {
                setDisplayName(managerProfile.displayName);
            }
            if (managerProfile.profileImageUrl) {
                setAvatarUrl(managerProfile.profileImageUrl);
            }
        }
    }, [user, managerProfile, firebaseUser]);

    // Get Stripe Connect status display
    const getStripeStatusDisplay = (status: string) => {
        switch (status) {
            case 'complete':
                return { label: 'Connected', color: 'bg-green-50 text-green-700 border-green-200' };
            case 'in_progress':
                return { label: 'In Progress', color: 'bg-yellow-50 text-yellow-700 border-yellow-200' };
            case 'failed':
                return { label: 'Failed', color: 'bg-red-50 text-red-700 border-red-200' };
            default:
                return { label: 'Not Started', color: 'bg-slate-50 text-slate-600 border-slate-200' };
        }
    };

    // Update profile mutation
    const updateProfileMutation = useMutation({
        mutationFn: async (profileData: {
            username?: string;
            displayName?: string;
            phone?: string;
            avatarUrl?: string;
        }) => {
            const currentFirebaseUser = auth.currentUser;
            if (!currentFirebaseUser) throw new Error("Not authenticated");

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

            if (!response.ok) throw new Error('Failed to update profile');
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/manager/profile"] });
            queryClient.invalidateQueries({ queryKey: ["/api/user/profile", firebaseUser?.uid] });
            setIsEditingProfile(false);
            toast({
                title: "Profile updated",
                description: "Your changes have been saved successfully.",
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
        });
    };

    const handleAvatarClick = () => {
        fileInputRef.current?.click();
    };

    const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            await uploadFile(file);
        }
    };

    // Get initials for avatar fallback
    const getInitials = () => {
        if (displayName) {
            return displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
        }
        if (email) {
            return email[0].toUpperCase();
        }
        return 'U';
    };

    if (isLoadingProfile || isLoadingDetails) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
                    <p className="text-sm text-muted-foreground">Loading your profile...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 max-w-4xl mx-auto pb-12">
            {/* Page Header */}
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Profile Settings</h1>
                <p className="text-muted-foreground mt-1">
                    Manage your account details and security preferences
                </p>
            </div>

            {/* Profile Hero Card */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-teal-500 via-emerald-500 to-teal-600 p-8 text-white shadow-xl">
                {/* Background Pattern */}
                <div className="absolute inset-0 opacity-10">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-white rounded-full -translate-y-1/2 translate-x-1/2" />
                    <div className="absolute bottom-0 left-0 w-48 h-48 bg-white rounded-full translate-y-1/2 -translate-x-1/2" />
                </div>

                <div className="relative flex flex-col sm:flex-row items-center sm:items-start gap-6">
                    {/* Avatar */}
                    <div className="relative group">
                        <Avatar className="h-28 w-28 border-4 border-white/30 shadow-2xl">
                            <AvatarImage src={avatarUrl || undefined} alt={displayName} />
                            <AvatarFallback className="bg-white/20 text-white text-2xl font-semibold">
                                {getInitials()}
                            </AvatarFallback>
                        </Avatar>
                        <button
                            onClick={handleAvatarClick}
                            disabled={isUploading}
                            className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        >
                            {isUploading ? (
                                <Loader2 className="h-6 w-6 animate-spin" />
                            ) : (
                                <Camera className="h-6 w-6" />
                            )}
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={handleAvatarChange}
                            className="hidden"
                        />
                        {/* Online indicator */}
                        <div className="absolute bottom-1 right-1 h-5 w-5 rounded-full bg-green-400 border-2 border-white" />
                    </div>

                    {/* Profile Info */}
                    <div className="flex-1 text-center sm:text-left">
                        <h2 className="text-2xl font-bold">{displayName || 'Your Name'}</h2>
                        <p className="text-white/80 mt-1">{email}</p>
                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-3">
                            <Badge className="bg-white/20 text-white border-0 hover:bg-white/30">
                                <Building2 className="h-3 w-3 mr-1" />
                                Kitchen Manager
                            </Badge>
                            <Badge className="bg-white/20 text-white border-0 hover:bg-white/30">
                                <Shield className="h-3 w-3 mr-1" />
                                Verified
                            </Badge>
                        </div>
                    </div>

                    {/* Edit Button */}
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setIsEditingProfile(!isEditingProfile)}
                        className="bg-white/20 hover:bg-white/30 text-white border-0 backdrop-blur-sm"
                    >
                        <Edit3 className="h-4 w-4 mr-2" />
                        {isEditingProfile ? 'Cancel' : 'Edit Profile'}
                    </Button>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="grid gap-6 lg:grid-cols-3">
                {/* Personal Information - Takes 2 columns */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Personal Details Card */}
                    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-lg bg-teal-100 flex items-center justify-center">
                                    <User className="h-5 w-5 text-teal-600" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-slate-900">Personal Information</h3>
                                    <p className="text-sm text-slate-500">Your public profile details</p>
                                </div>
                            </div>
                        </div>
                        
                        <div className="p-6 space-y-5">
                            {/* Username */}
                            <div className="space-y-2">
                                <Label htmlFor="username" className="text-sm font-medium text-slate-700">
                                    Username
                                </Label>
                                <Input
                                    id="username"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder="johndoe"
                                    disabled={!isEditingProfile}
                                    className={cn(
                                        "h-11 transition-colors",
                                        !isEditingProfile && "bg-slate-50 border-slate-200"
                                    )}
                                />
                            </div>

                            {/* Display Name */}
                            <div className="space-y-2">
                                <Label htmlFor="displayName" className="text-sm font-medium text-slate-700">
                                    Display Name
                                </Label>
                                <Input
                                    id="displayName"
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    placeholder="John Doe"
                                    disabled={!isEditingProfile}
                                    className={cn(
                                        "h-11 transition-colors",
                                        !isEditingProfile && "bg-slate-50 border-slate-200"
                                    )}
                                />
                            </div>

                            {/* Email - Read only */}
                            <div className="space-y-2">
                                <Label htmlFor="email" className="text-sm font-medium text-slate-700">
                                    Email Address
                                </Label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                    <Input
                                        id="email"
                                        type="email"
                                        value={email}
                                        disabled
                                        className="h-11 pl-10 bg-slate-50 border-slate-200 text-slate-600"
                                    />
                                    <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-300" />
                                </div>
                                <p className="text-xs text-slate-500 flex items-center gap-1">
                                    <Shield className="h-3 w-3" />
                                    Email is linked to your authentication and cannot be changed here
                                </p>
                            </div>

                            {/* Phone */}
                            <div className="space-y-2">
                                <Label htmlFor="phone" className="text-sm font-medium text-slate-700">
                                    Phone Number
                                </Label>
                                <div className="relative">
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                    <Input
                                        id="phone"
                                        type="tel"
                                        value={phone}
                                        onChange={(e) => setPhone(e.target.value)}
                                        className={cn(
                                            "h-11 pl-10 transition-colors",
                                            !isEditingProfile && "bg-slate-50 border-slate-200"
                                        )}
                                        placeholder="+1 (555) 000-0000"
                                        disabled={!isEditingProfile}
                                    />
                                </div>
                            </div>

                            {/* Save Button */}
                            {isEditingProfile && (
                                <div className="flex justify-end pt-4 border-t border-slate-100">
                                    <Button
                                        onClick={handleSave}
                                        disabled={updateProfileMutation.isPending}
                                        className="bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700"
                                    >
                                        {updateProfileMutation.isPending ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Saving...
                                            </>
                                        ) : (
                                            <>
                                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                                Save Changes
                                            </>
                                        )}
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Security Card */}
                    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
                                    <KeyRound className="h-5 w-5 text-amber-600" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-slate-900">Security</h3>
                                    <p className="text-sm text-slate-500">Manage your password and account security</p>
                                </div>
                            </div>
                        </div>
                        
                        <div className="p-6">
                            <ChangePassword role="manager" />
                        </div>
                    </div>
                </div>

                {/* Sidebar - Account Summary */}
                <div className="space-y-6">
                    {/* Account Status Card */}
                    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
                            <h3 className="font-semibold text-slate-900">Account Status</h3>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-600">Account Type</span>
                                <Badge variant="secondary" className="bg-teal-50 text-teal-700 border-teal-200">
                                    Manager
                                </Badge>
                            </div>
                            <Separator />
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-600">Email Verified</span>
                                <div className="flex items-center gap-1 text-green-600">
                                    <CheckCircle2 className="h-4 w-4" />
                                    <span className="text-sm font-medium">Yes</span>
                                </div>
                            </div>
                            <Separator />
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-600">Stripe Payments</span>
                                <Badge variant="outline" className={getStripeStatusDisplay(managerProfile?.stripeConnectStatus || 'not_started').color}>
                                    <CreditCard className="h-3 w-3 mr-1" />
                                    {getStripeStatusDisplay(managerProfile?.stripeConnectStatus || 'not_started').label}
                                </Badge>
                            </div>
                        </div>
                    </div>

                    {/* Location Info Card */}
                    {managerProfile?.locations && managerProfile.locations.length > 0 && (
                        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
                                <div className="flex items-center gap-2">
                                    <Building2 className="h-4 w-4 text-slate-500" />
                                    <h3 className="font-semibold text-slate-900">Your Locations</h3>
                                </div>
                            </div>
                            <div className="p-5 space-y-4">
                                {managerProfile.locations.map((location: any) => (
                                    <div key={location.id} className="space-y-2">
                                        <div className="font-medium text-slate-900">{location.name}</div>
                                        <div className="flex items-start gap-2 text-sm text-slate-600">
                                            <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0 text-slate-400" />
                                            <span>{location.address}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-sm text-slate-500">
                                            <Clock className="h-4 w-4 text-slate-400" />
                                            <span>{location.timezone}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Quick Tips Card */}
                    <div className="rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-50 overflow-hidden">
                        <div className="p-5">
                            <div className="flex items-center gap-2 mb-3">
                                <div className="h-8 w-8 rounded-lg bg-teal-100 flex items-center justify-center">
                                    <Shield className="h-4 w-4 text-teal-600" />
                                </div>
                                <h3 className="font-semibold text-teal-900">Security Tips</h3>
                            </div>
                            <ul className="space-y-2 text-sm text-teal-800">
                                <li className="flex items-start gap-2">
                                    <CheckCircle2 className="h-4 w-4 mt-0.5 text-teal-600 flex-shrink-0" />
                                    <span>Use a strong, unique password</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <CheckCircle2 className="h-4 w-4 mt-0.5 text-teal-600 flex-shrink-0" />
                                    <span>Keep your email address up to date</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <CheckCircle2 className="h-4 w-4 mt-0.5 text-teal-600 flex-shrink-0" />
                                    <span>Review account activity regularly</span>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
