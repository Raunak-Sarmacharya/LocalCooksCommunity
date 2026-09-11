import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Mail, Phone, KeyRound, Shield, Camera, CheckCircle2, Building2, Edit3, Lock, MapPin } from "@/components/ui/manager-icons";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import ChangePassword from "@/components/auth/ChangePassword";
import { useFileUpload } from "@/hooks/useFileUpload";
import { cn } from "@/lib/utils";
import { tt } from "@/i18n/common-ns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users } from "lucide-react";
import StripeConnectSetup from "@/components/manager/StripeConnectSetup";
import NotificationsSettings from "@/components/manager/settings/NotificationsSettings";
import { InfoChip } from "@/components/chef/info-chip";

interface ManagerProfileSettingsProps {
    notificationLocation?: {
        id: number;
        name: string;
        notificationEmail?: string;
        notificationPhone?: string;
    } | null;
    onSaveNotificationSettings?: (updates: any) => Promise<unknown>;
}

export default function ManagerProfileSettings({
    notificationLocation,
    onSaveNotificationSettings,
}: ManagerProfileSettingsProps = {}) {
  
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
    const [activeTab, setActiveTab] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        const legacyView = params.get("view");
        const tab = legacyView === "payments"
            ? "payments"
            : legacyView === "notification-settings"
                ? "notifications"
                : params.get("tab");
        return tab === "password" || tab === "payments" || tab === "notifications" ? tab : "account";
    });
    
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
            toast({ title: mt("uploadFailed2"),
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

    // Update profile mutation
    const updateProfileMutation = useMutation({
        mutationFn: async (profileData: {
            username?: string;
            displayName?: string;
            phone?: string;
            avatarUrl?: string;
        }) => {
            const currentFirebaseUser = auth.currentUser;
            if (!currentFirebaseUser) throw new Error(tt("notAuthenticated"));

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

            if (!response.ok) throw new Error(tt("failedToUpdateProfile"));
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/manager/profile"] });
            queryClient.invalidateQueries({ queryKey: ["/api/user/profile", firebaseUser?.uid] });
            setIsEditingProfile(false);
            toast({ title: mt("profileUpdated"),
                description: mt("yourChangesHaveBeenSavedSuccessfully"),
            });
        },
        onError: (error: any) => {
            toast({ title: mt("updateFailed2"),
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
            if (!currentFirebaseUser) throw new Error(tt("notAuthenticated"));

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
            toast({ title: mt("contactInfoUpdated"),
                description: mt("yourBusinessContactInformationHasBeenSaved"),
            });
        },
        onError: (error: any) => {
            toast({ title: mt("updateFailed2"),
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

    const handleTabChange = (tab: string) => {
        setActiveTab(tab);
        const url = new URL(window.location.href);
        if (tab === "account") url.searchParams.delete("tab");
        else url.searchParams.set("tab", tab);
        window.history.replaceState({}, "", url);
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
                    <p className="text-sm text-muted-foreground">{mt("loadingYourProfile")}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="relative mx-auto max-w-4xl space-y-8 pb-10">
            {/* Page Header */}
            <div className="flex items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900">{mt("cmdProfileSettings")}</h1>
                    <p className="text-muted-foreground mt-1">{mt("manageYourAccountDetailsAndSecurityPreferences")}</p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditingProfile(!isEditingProfile)}
                    className="shrink-0 bg-white"
                >
                    <Edit3 className="h-4 w-4 mr-2" />
                    {isEditingProfile ? mt("cancel") : mt("editProfile")}
                </Button>
            </div>

            {/* Profile Hero Card */}
            <div className="relative overflow-hidden rounded-[1.35rem] border bg-card">
                <div className="absolute inset-x-0 top-0 h-20 bg-[linear-gradient(180deg,hsl(173_63%_34%_/_0.1),transparent)]" />

                <div className="relative flex flex-col items-center gap-3 p-4 sm:flex-row">
                    {/* Avatar */}
                    <div className="relative group shrink-0">
                        <Avatar className="h-[4.5rem] w-[4.5rem] border-2 border-background shadow-sm ring-2 ring-primary/20">
                            <AvatarImage src={avatarUrl || undefined} alt={displayName} />
                            <AvatarFallback className="bg-primary/10 text-primary text-2xl font-semibold">
                                {getInitials()}
                            </AvatarFallback>
                        </Avatar>
                        <button
                            onClick={handleAvatarClick}
                            disabled={isUploading}
                            className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100 cursor-pointer"
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
                        <div className="absolute bottom-0 right-0 h-4 w-4 rounded-full bg-emerald-500 border-2 border-background" />
                    </div>

                    {/* Profile Info */}
                    <div className="min-w-0 flex-1 text-center sm:text-left">
                        <p className="text-sm font-medium leading-none text-primary">Local Cooks</p>
                        <h2 className="mt-1 truncate text-xl font-semibold tracking-tight text-foreground">{displayName || mt("yourName")}</h2>
                        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2 text-sm sm:justify-start">
                            <span className="truncate text-muted-foreground">{email}</span>
                            <InfoChip tone="neutral" icon={<Building2 />}>
                                {mt("kitchenManager")}
                            </InfoChip>
                            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                                <Shield className="h-3 w-3 mr-1" />{mt("verified")}</Badge>
                        </div>
                    </div>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                <TabsList className="h-auto w-full justify-start gap-0 rounded-none border-b bg-transparent p-0">
                    {[
                        ["account", mt("personalInformation")],
                        ["password", mt("security")],
                        ["payments", mt("paymentsPayouts")],
                        ["notifications", mt("notificationSettings")],
                        ["teams", mt("navTeams")],
                    ].map(([value, label]) => (
                        <TabsTrigger
                            key={value}
                            value={value}
                            className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                        >
                            {label}
                        </TabsTrigger>
                    ))}
                </TabsList>

                <TabsContent value="account" className="mt-6 focus-visible:ring-0">
            <div className="space-y-6">
                <div className="space-y-6">
                    {/* Personal Details Card */}
                    <div className="overflow-hidden rounded-[1.35rem] border bg-card">
                        <div className="border-b px-5 py-4">
                            <div className="flex items-center gap-3">
                                <div>
                                    <h3 className="font-semibold text-foreground">{mt("personalInformation")}</h3>
                                    <p className="text-sm text-muted-foreground">{mt("yourPublicProfileDetails")}</p>
                                </div>
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
                            {/* Username */}
                            <div className="space-y-2">
                                <Label htmlFor="username" className="text-sm font-medium text-slate-700">{mt("username")}</Label>
                                <Input
                                    id="username"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder={mt("johndoe")}
                                    disabled={!isEditingProfile}
                                    className={cn(
                                        "h-11 transition-colors",
                                        !isEditingProfile && "bg-slate-50 border-slate-200"
                                    )}
                                />
                            </div>

                            {/* Display Name */}
                            <div className="space-y-2">
                                <Label htmlFor="displayName" className="text-sm font-medium text-slate-700">{mt("displayName")}</Label>
                                <Input
                                    id="displayName"
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    placeholder={mt("johnDoe")}
                                    disabled={!isEditingProfile}
                                    className={cn(
                                        "h-11 transition-colors",
                                        !isEditingProfile && "bg-slate-50 border-slate-200"
                                    )}
                                />
                            </div>

                            {/* Email - Read only */}
                            <div className="space-y-2">
                                <Label htmlFor="email" className="text-sm font-medium text-slate-700">{mt("emailAddress")}</Label>
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
                                    <Shield className="h-3 w-3" />{mt("emailIsLinkedToYourAuthenticationAndCannotBeChangedHere")}</p>
                            </div>

                            {/* Phone */}
                            <div className="space-y-2">
                                <Label htmlFor="phone" className="text-sm font-medium text-slate-700">{mt("phoneNumber")}</Label>
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
                                <div className="flex justify-end border-t pt-4 sm:col-span-2">
                                    <StatusButton
                                        status={saveProfileAction.status}
                                        onClick={saveProfileAction.execute}
                                        labels={{ idle: mt("saveChanges"), loading: mt("saving"), success: mt("saved") }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                </div>

                <div className="space-y-6">
                    {/* Location Info Card */}
                    {managerProfile?.locations && managerProfile.locations.length > 0 && (
                        <div className="overflow-hidden rounded-[1.35rem] border bg-card">
                            <div className="border-b px-5 py-4">
                                <div className="flex items-center gap-2">
                                    <Building2 className="h-4 w-4 text-slate-500" />
                                    <h3 className="font-semibold text-slate-900">{mt("yourLocations")}</h3>
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
                                            

                                            {/* Editable Contact Info */}
                                            <div className="pt-2 mt-2 border-t border-slate-100 space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{mt("businessContact")}</div>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => toggleLocationContactEdit(location.id)}
                                                        className="h-6 px-2 text-xs"
                                                    >
                                                        <Edit3 className="h-3 w-3 mr-1" />
                                                        {isEditingContact ? mt("cancel") : mt("edit")}
                                                    </Button>
                                                </div>
                                                
                                                {isEditingContact ? (
                                                    <div className="space-y-2">
                                                        <div className="space-y-1">
                                                            <Label className="text-xs text-slate-500">{mt("contactEmail")}</Label>
                                                            <Input
                                                                type="email"
                                                                value={edit?.contactEmail || ''}
                                                                onChange={(e) => handleLocationContactEdit(location.id, 'contactEmail', e.target.value)}
                                                                placeholder={mt("contactBusinessCom")}
                                                                className="h-8 text-sm"
                                                            />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label className="text-xs text-slate-500">{mt("contactPhone")}</Label>
                                                            <Input
                                                                type="tel"
                                                                value={edit?.contactPhone || ''}
                                                                onChange={(e) => handleLocationContactEdit(location.id, 'contactPhone', e.target.value)}
                                                                placeholder="+1 (555) 000-0000"
                                                                className="h-8 text-sm"
                                                            />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label className="text-xs text-slate-500">{mt("preferredMethod")}</Label>
                                                            <select
                                                                value={edit?.preferredContactMethod || 'email'}
                                                                onChange={(e) => handleLocationContactEdit(location.id, 'preferredContactMethod', e.target.value)}
                                                                className="w-full h-8 px-2 text-sm border border-slate-200 rounded-md bg-white"
                                                            >
                                                                <option value="email">{mt("email")}</option>
                                                                <option value="phone">{mt("phone")}</option>
                                                                <option value="both">{mt("both")}</option>
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
                                                                <span>{mt("noEmailSet")}</span>
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
                                                                <span>{mt("noPhoneSet")}</span>
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

                </div>
            </div>
                </TabsContent>

                <TabsContent value="password" className="mt-6 focus-visible:ring-0">
                    <div className="rounded-xl border bg-card p-6">
                        <div className="mb-5 flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
                                <KeyRound className="h-5 w-5 text-amber-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-foreground">{mt("security")}</h3>
                                <p className="text-sm text-muted-foreground">{mt("manageYourPasswordAndAccountSecurity")}</p>
                            </div>
                        </div>
                        <ChangePassword role="manager" />
                    </div>
                </TabsContent>

                <TabsContent value="payments" className="mt-6 focus-visible:ring-0">
                    <StripeConnectSetup />
                </TabsContent>

                <TabsContent value="notifications" className="mt-6 focus-visible:ring-0">
                    {notificationLocation && onSaveNotificationSettings ? (
                        <NotificationsSettings
                            location={notificationLocation}
                            onSave={onSaveNotificationSettings}
                        />
                    ) : (
                        <div className="rounded-[1.35rem] border border-dashed bg-card p-10 text-center">
                            <h3 className="font-semibold text-foreground">{mt("selectALocation")}</h3>
                            <p className="mt-1 text-sm text-muted-foreground">{mt("chooseALocationToManageNotificationSettings")}</p>
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="teams" className="mt-6 focus-visible:ring-0">
                    <div className="rounded-[1.35rem] border border-dashed border-primary/20 bg-primary/5 p-10 text-center space-y-4">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                            <Users className="h-7 w-7 text-primary" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-foreground">{mt("teamsComingSoon")}</h3>
                            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                                {mt("teamsComingSoonDesc")}
                            </p>
                        </div>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}
