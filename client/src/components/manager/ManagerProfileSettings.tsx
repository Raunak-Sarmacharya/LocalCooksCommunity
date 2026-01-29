import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Mail, Phone, User, Save, KeyRound } from "lucide-react";
import ChangePassword from "@/components/auth/ChangePassword";

export default function ManagerProfileSettings() {
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
                        return { phone: null, displayName: null };
                    }
                    throw new Error(`Failed to fetch manager profile: ${response.status}`);
                }

                return response.json();
            } catch (error) {
                return { phone: null, displayName: null };
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
        });
    };

    if (isLoadingProfile || isLoadingDetails) {
        return (
            <div className="flex justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Profile Settings</h1>
                <p className="text-muted-foreground">Manage your personal information and security settings.</p>
            </div>

            <div className="grid gap-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <User className="h-5 w-5 text-purple-600" />
                            Personal Information
                        </CardTitle>
                        <CardDescription>
                            Update your public profile and contact details.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-2">
                            <Label htmlFor="username">Username</Label>
                            <Input
                                id="username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="johndoe"
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="displayName">Display Name</Label>
                            <Input
                                id="displayName"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                placeholder="John Doe"
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="email">Email</Label>
                            <div className="relative">
                                <Mail className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    id="email"
                                    type="email"
                                    value={email}
                                    disabled
                                    className="pl-9 bg-muted"
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Email cannot be changed directly.
                            </p>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="phone">Phone Number</Label>
                            <div className="relative">
                                <Phone className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    id="phone"
                                    type="tel"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    className="pl-9"
                                    placeholder="+1 (555) 000-0000"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end pt-4">
                            <Button
                                onClick={handleSave}
                                disabled={updateProfileMutation.isPending}
                            >
                                {updateProfileMutation.isPending && (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                )}
                                Save Changes
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <KeyRound className="h-5 w-5 text-orange-600" />
                            Security
                        </CardTitle>
                        <CardDescription>
                            Manage your password and security preferences.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ChangePassword role="manager" />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
