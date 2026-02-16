import { logger } from "@/lib/logger";
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { updateProfile } from "firebase/auth";
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
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
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
    
    // Location contact fields state
    const [locationContactEdits, setLocationContactEdits] = useState<Record<number, {
        contactEmail: string;
        contactPhone: string;
        preferredContactMethod: 'email' | 'phone' | 'both';
        isEditing: boolean;
    }>>({});

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
                logger.error('Error fetching user profile:', error);
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
            if (managerProfile.profileImageUrl) {
                setAvatarUrl(managerProfile.profileImageUrl);
            }
            // Initialize location contact edits
            if (managerProfile.locations) {
                const edits: Record<number, any> = {};
                managerProfile.locations.forEach((loc: any) => {
                    edits[loc.id] = {
                        contactEmail: loc.contactEmail || '',
                        contactPhone: loc.contactPhone || '',
                        preferredContactMethod: loc.preferredContactMethod || 'email',
                        isEditing: false,
                    };
                });
                setLocationContactEdits(edits);
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

    const saveProfileAction = useStatusButton(
        useCallback(async () => {
            await updateProfileMutation.mutateAsync({
                username: username !== user?.username ? username : undefined,
                displayName: displayName || undefined,
                phone: phone || undefined,
            });
        }, [updateProfileMutation, username, user?.username, displayName, phone]),
    );

    // Update location contact info mutation
    const updateLocationContactMutation = useMutation({
        mutationFn: async ({ locationId, contactEmail, contactPhone, preferredContactMethod }: {
            locationId: number;
            contactEmail: string;
            contactPhone: string;
            preferredContactMethod: 'email' | 'phone' | 'both';
        }) => {
            const currentFirebaseUser = auth.currentUser;
            if (!currentFirebaseUser) throw new Error("Not authenticated");

            const token = await currentFirebaseUser.getIdToken();
            const response = await fetch(`/api/manager/locations/${locationId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    contactEmail: contactEmail || null,
                    contactPhone: contactPhone || null,
                    preferredContactMethod,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to update contact info');
            }
            return response.json();
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ["/api/manager/profile"] });
            queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
            setLocationContactEdits(prev => ({
                ...prev,
                [variables.locationId]: {
                    ...prev[variables.locationId],
                    isEditing: false,
                },
            }));
            toast({
                title: "Contact info updated",
                description: "Your business contact information has been saved.",
            });
        },
        onError: (error: any) => {
            toast({
                title: "Update failed",
                description: error.message || "Failed to update contact info",
                variant: "destructive",
            });
        },
    });

    const handleLocationContactEdit = (locationId: number, field: string, value: string) => {
        setLocationContactEdits(prev => ({
            ...prev,
            [locationId]: {
                ...prev[locationId],
                [field]: value,
            },
        }));
    };

    const handleSaveLocationContact = (locationId: number) => {
        const edit = locationContactEdits[locationId];
        if (edit) {
            updateLocationContactMutation.mutate({
                locationId,
                contactEmail: edit.contactEmail,
                contactPhone: edit.contactPhone,
                preferredContactMethod: edit.preferredContactMethod,
            });
        }
    };

    const toggleLocationContactEdit = (locationId: number) => {
        setLocationContactEdits(prev => ({
            ...prev,
            [locationId]: {
                ...prev[locationId],
                isEditing: !prev[locationId]?.isEditing,
            },
        }));
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
                                    <StatusButton
                                        status={saveProfileAction.status}
                                        onClick={saveProfileAction.execute}
                                        labels={{ idle: "Save Changes", loading: "Saving", success: "Saved" }}
                                    />
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
                                <Badge variant="info">
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
                                {managerProfile.locations.map((location: any) => {
                                    const edit = locationContactEdits[location.id];
                                    const isEditingContact = edit?.isEditing || false;
                                    
                                    return (
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
                                            
                                            {/* Editable Contact Info */}
                                            <div className="pt-2 mt-2 border-t border-slate-100 space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                                                        Business Contact
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => toggleLocationContactEdit(location.id)}
                                                        className="h-6 px-2 text-xs"
                                                    >
                                                        <Edit3 className="h-3 w-3 mr-1" />
                                                        {isEditingContact ? 'Cancel' : 'Edit'}
                                                    </Button>
                                                </div>
                                                
                                                {isEditingContact ? (
                                                    <div className="space-y-2">
                                                        <div className="space-y-1">
                                                            <Label className="text-xs text-slate-500">Contact Email</Label>
                                                            <Input
                                                                type="email"
                                                                value={edit?.contactEmail || ''}
                                                                onChange={(e) => handleLocationContactEdit(location.id, 'contactEmail', e.target.value)}
                                                                placeholder="contact@business.com"
                                                                className="h-8 text-sm"
                                                            />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label className="text-xs text-slate-500">Contact Phone</Label>
                                                            <Input
                                                                type="tel"
                                                                value={edit?.contactPhone || ''}
                                                                onChange={(e) => handleLocationContactEdit(location.id, 'contactPhone', e.target.value)}
                                                                placeholder="+1 (555) 000-0000"
                                                                className="h-8 text-sm"
                                                            />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label className="text-xs text-slate-500">Preferred Method</Label>
                                                            <select
                                                                value={edit?.preferredContactMethod || 'email'}
                                                                onChange={(e) => handleLocationContactEdit(location.id, 'preferredContactMethod', e.target.value)}
                                                                className="w-full h-8 px-2 text-sm border border-slate-200 rounded-md bg-white"
                                                            >
                                                                <option value="email">Email</option>
                                                                <option value="phone">Phone</option>
                                                                <option value="both">Both</option>
                                                            </select>
                                                        </div>
                                                        <Button
                                                            size="sm"
                                                            onClick={() => handleSaveLocationContact(location.id)}
                                                            disabled={updateLocationContactMutation.isPending}
                                                            className="w-full h-8 text-xs"
                                                        >
                                                            {updateLocationContactMutation.isPending ? (
                                                                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                                            ) : (
                                                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                                            )}
                                                            Save Contact Info
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-1.5">
                                                        {(edit?.contactEmail || location.contactEmail) ? (
                                                            <div className="flex items-center gap-2 text-sm text-slate-600">
                                                                <Mail className="h-3.5 w-3.5 text-slate-400" />
                                                                <span>{edit?.contactEmail || location.contactEmail}</span>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-2 text-sm text-slate-400 italic">
                                                                <Mail className="h-3.5 w-3.5" />
                                                                <span>No email set</span>
                                                            </div>
                                                        )}
                                                        {(edit?.contactPhone || location.contactPhone) ? (
                                                            <div className="flex items-center gap-2 text-sm text-slate-600">
                                                                <Phone className="h-3.5 w-3.5 text-slate-400" />
                                                                <span>{edit?.contactPhone || location.contactPhone}</span>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-2 text-sm text-slate-400 italic">
                                                                <Phone className="h-3.5 w-3.5" />
                                                                <span>No phone set</span>
                                                            </div>
                                                        )}
                                                        <div className="text-xs text-slate-400">
                                                            Preferred: {edit?.preferredContactMethod || location.preferredContactMethod || 'email'}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
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
