
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    FileText, ImageIcon, Mail, Clock, Globe, HelpCircle,
    Upload, Loader2, Plus, Info, Save, AlertCircle, CheckCircle, Calendar
} from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { DEFAULT_TIMEZONE } from "@/utils/timezone-utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ImageWithReplace } from "@/components/ui/image-with-replace";

import { KitchenGalleryImages } from "../kitchen/KitchenGalleryImages";
import LocationRequirementsSettings from "@/components/manager/LocationRequirementsSettings";

// Type definitions to ensure safety
interface Location {
    id: number;
    name: string;
    address: string;
    cancellationPolicyHours?: number;
    cancellationPolicyMessage?: string;
    defaultDailyBookingLimit?: number;
    minimumBookingWindowHours?: number;
    notificationEmail?: string;
    notificationPhone?: string;
    logoUrl?: string;
    kitchenLicenseUrl?: string;
    kitchenLicenseStatus?: string;
    kitchenLicenseExpiry?: string;
    kitchenLicenseUploadedAt?: string;
    kitchenLicenseFeedback?: string;
    kitchenTermsUrl?: string;
    kitchenTermsUploadedAt?: string;
}

interface Kitchen {
    id: number;
    name: string;
    description?: string;
    imageUrl?: string;
    locationId: number;
    isActive: boolean;
    galleryImages?: string[];
}

interface SettingsViewProps {
    location: Location;
    onUpdateSettings: any; // Ideally strictly typed mutation
    isUpdating: boolean;
}

export function LocationSettingsView({ location, onUpdateSettings, isUpdating }: SettingsViewProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Tab state
    const [activeTab, setActiveTab] = useState<string>('setup');

    // Form State - Controlled by local state, updated when location prop changes
    const [cancellationHours, setCancellationHours] = useState(location.cancellationPolicyHours || 24);
    const [cancellationMessage, setCancellationMessage] = useState(
        location.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time."
    );
    const [dailyBookingLimit, setDailyBookingLimit] = useState(location.defaultDailyBookingLimit || 2);
    const [minimumBookingWindowHours, setMinimumBookingWindowHours] = useState(location.minimumBookingWindowHours || 1);
    const [notificationEmail, setNotificationEmail] = useState(location.notificationEmail || '');
    const [notificationPhone, setNotificationPhone] = useState(location.notificationPhone || '');
    const [logoUrl, setLogoUrl] = useState(location.logoUrl || '');

    // Kitchen state
    const [newKitchenName, setNewKitchenName] = useState('');
    const [newKitchenDescription, setNewKitchenDescription] = useState('');
    const [showCreateKitchen, setShowCreateKitchen] = useState(false);
    const [isCreatingKitchen, setIsCreatingKitchen] = useState(false);
    const [kitchenDescriptions, setKitchenDescriptions] = useState<Record<number, string>>({});
    const [updatingKitchenId, setUpdatingKitchenId] = useState<number | null>(null);

    // License state
    const [licenseFile, setLicenseFile] = useState<File | null>(null);
    const [isUploadingLicense, setIsUploadingLicense] = useState(false);
    const [licenseExpiryDate, setLicenseExpiryDate] = useState<string>(location.kitchenLicenseExpiry || '');
    const [isUploadingLogo, setIsUploadingLogo] = useState(false);

    // Kitchen terms state
    const [termsFile, setTermsFile] = useState<File | null>(null);
    const [isUploadingTerms, setIsUploadingTerms] = useState(false);

    // Sync state when location prop updates
    useEffect(() => {
        setCancellationHours(location.cancellationPolicyHours || 24);
        setCancellationMessage(
            location.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time."
        );
        setDailyBookingLimit(location.defaultDailyBookingLimit || 2);
        setMinimumBookingWindowHours(location.minimumBookingWindowHours || 1);
        setNotificationEmail(location.notificationEmail || '');
        setNotificationPhone(location.notificationPhone || '');
        setLogoUrl(location.logoUrl || '');
        setLicenseExpiryDate(location.kitchenLicenseExpiry || '');
    }, [location]);

    // Fetch kitchens
    const { data: kitchens = [], isLoading: isLoadingKitchens } = useQuery<Kitchen[]>({
        queryKey: ['managerKitchens', location.id],
        queryFn: async () => {
            const currentFirebaseUser = auth.currentUser;
            if (!currentFirebaseUser) throw new Error("Firebase user not available");
            const token = await currentFirebaseUser.getIdToken();

            const response = await fetch(`/api/manager/kitchens/${location.id}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!response.ok) throw new Error('Failed to fetch kitchens');
            return response.json();
        },
        enabled: !!location.id,
    });

    // Init kitchen descriptions
    useEffect(() => {
        if (kitchens.length > 0) {
            const descriptions: Record<number, string> = {};
            kitchens.forEach((kitchen) => {
                descriptions[kitchen.id] = kitchen.description || '';
            });
            setKitchenDescriptions(descriptions);
        }
    }, [kitchens]);

    // Save Handlers
    const handleSave = (overrideLogoUrl?: string) => {
        if (!location.id) return;
        const payload = {
            locationId: location.id,
            cancellationPolicyHours: cancellationHours,
            cancellationPolicyMessage: cancellationMessage,
            defaultDailyBookingLimit: dailyBookingLimit,
            minimumBookingWindowHours: minimumBookingWindowHours,
            notificationEmail: notificationEmail || undefined,
            notificationPhone: notificationPhone || undefined,
            logoUrl: overrideLogoUrl !== undefined ? overrideLogoUrl : (logoUrl || undefined),
            timezone: DEFAULT_TIMEZONE,
        };
        onUpdateSettings.mutate(payload);
    };

    // Helper: License logic
    const isLicenseExpired = location.kitchenLicenseExpiry
        ? new Date(location.kitchenLicenseExpiry) < new Date()
        : false;

    const shouldShowUpload = !location.kitchenLicenseUrl ||
        location.kitchenLicenseStatus === "rejected" ||
        location.kitchenLicenseStatus === "expired" ||
        (location.kitchenLicenseStatus === "approved" && isLicenseExpired);

    const getDaysUntilExpiry = (expiryDate?: string) => {
        if (!expiryDate) return null;
        const expiry = new Date(expiryDate);
        const now = new Date();
        const diffTime = expiry.getTime() - now.getTime();
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    };

    const isExpiryApproaching = (expiryDate?: string) => {
        const days = getDaysUntilExpiry(expiryDate);
        return days !== null && days > 0 && days <= 30;
    };

    const getDocumentFilename = (url?: string) => {
        if (!url) return 'No document';
        try {
            return decodeURIComponent(url.split('/').pop() || 'kitchen-license');
        } catch {
            return 'kitchen-license';
        }
    };

    const handleLicenseUpload = async (file: File, expiryDate: string) => {
        if (!expiryDate) {
            toast({ title: "Date Required", description: "Please provide an expiration date.", variant: "destructive" });
            return;
        }
        setIsUploadingLicense(true);
        try {
            const currentFirebaseUser = auth.currentUser;
            if (!currentFirebaseUser) throw new Error("Auth failed");
            const token = await currentFirebaseUser.getIdToken();

            const formData = new FormData();
            formData.append('file', file);
            const uploadRes = await fetch('/api/files/upload-file', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
            });
            if (!uploadRes.ok) throw new Error("Upload failed");
            const { url } = await uploadRes.json();

            const updateRes = await fetch(`/api/manager/locations/${location.id}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kitchenLicenseUrl: url,
                    kitchenLicenseStatus: 'pending',
                    kitchenLicenseExpiry: expiryDate,
                }),
            });
            if (!updateRes.ok) throw new Error("Update failed");

            queryClient.invalidateQueries({ queryKey: ['/api/manager/locations'] });
            toast({ title: "License Uploaded", description: "Submitted for approval." });
            setLicenseFile(null);
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        } finally {
            setIsUploadingLicense(false);
        }
    };

    const handleTermsUpload = async (file: File) => {
        setIsUploadingTerms(true);
        try {
            const currentFirebaseUser = auth.currentUser;
            if (!currentFirebaseUser) throw new Error("Auth failed");
            const token = await currentFirebaseUser.getIdToken();

            const formData = new FormData();
            formData.append('file', file);
            const uploadRes = await fetch('/api/files/upload-file', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
            });
            if (!uploadRes.ok) throw new Error("Upload failed");
            const { url } = await uploadRes.json();

            const updateRes = await fetch(`/api/manager/locations/${location.id}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kitchenTermsUrl: url,
                }),
            });
            if (!updateRes.ok) throw new Error("Update failed");

            queryClient.invalidateQueries({ queryKey: ['/api/manager/locations'] });
            toast({ title: "Terms Uploaded", description: "Kitchen terms & policies saved successfully." });
            setTermsFile(null);
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        } finally {
            setIsUploadingTerms(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-card rounded-lg shadow-sm border border-border">
                <div className="p-6 border-b border-border">
                    <h2 className="text-xl font-semibold text-foreground">Location Settings</h2>
                    <p className="text-sm text-muted-foreground mt-1">{location.name}</p>
                </div>

                <div className="p-6">
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 mb-6">
                            <TabsTrigger value="setup">Documents</TabsTrigger>
                            <TabsTrigger value="branding">Kitchen</TabsTrigger>
                            <TabsTrigger value="notifications">Notifications</TabsTrigger>
                            <TabsTrigger value="booking-rules">Rules</TabsTrigger>
                            <TabsTrigger value="application-requirements">App Req</TabsTrigger>
                            <TabsTrigger value="location">Location</TabsTrigger>
                        </TabsList>

                        {/* SETUP TAB */}
                        <TabsContent value="setup" className="space-y-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <FileText className="h-5 w-5 text-primary" />
                                        Kitchen License
                                    </CardTitle>
                                    <CardDescription>
                                        Upload or update your kitchen license. Bookings are paused until approved.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {/* Status Blocks */}
                                    {location.kitchenLicenseUrl && location.kitchenLicenseStatus !== "rejected" && location.kitchenLicenseStatus !== "expired" && (
                                        <div className={cn(
                                            "border rounded-lg p-4",
                                            location.kitchenLicenseStatus === "approved" && !isLicenseExpired ? "bg-green-50 border-green-200" :
                                                "bg-yellow-50 border-yellow-200"
                                        )}>
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2 font-medium">
                                                    {location.kitchenLicenseStatus === "approved" ? <CheckCircle className="h-5 w-5 text-green-600" /> : <AlertCircle className="h-5 w-5 text-yellow-600" />}
                                                    <span>License Status: {location.kitchenLicenseStatus?.toUpperCase()}</span>
                                                </div>
                                            </div>
                                            <div className="text-sm space-y-1">
                                                <p>Document: <span className="font-medium">{getDocumentFilename(location.kitchenLicenseUrl)}</span></p>
                                                <p>Expires: <span className="font-medium">{location.kitchenLicenseExpiry ? new Date(location.kitchenLicenseExpiry).toLocaleDateString() : 'N/A'}</span></p>
                                            </div>
                                        </div>
                                    )}

                                    {shouldShowUpload && (
                                        <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
                                            <div className="space-y-2">
                                                <Label>License Expiration Date <span className="text-destructive">*</span></Label>
                                                <Input
                                                    type="date"
                                                    value={licenseExpiryDate}
                                                    onChange={e => setLicenseExpiryDate(e.target.value)}
                                                    min={new Date().toISOString().split('T')[0]}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Upload License Document</Label>
                                                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
                                                    <input
                                                        type="file"
                                                        accept=".pdf,.jpg,.png"
                                                        className="hidden"
                                                        id="license-upload-input"
                                                        onChange={(e) => {
                                                            const file = e.target.files?.[0];
                                                            if (file) setLicenseFile(file);
                                                        }}
                                                        disabled={isUploadingLicense}
                                                    />
                                                    <label htmlFor="license-upload-input" className="cursor-pointer flex flex-col items-center gap-2">
                                                        {isUploadingLicense ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <Upload className="h-8 w-8 text-muted-foreground" />}
                                                        <span className="text-sm font-medium">{licenseFile ? licenseFile.name : "Click to upload"}</span>
                                                        <span className="text-xs text-muted-foreground">PDF, JPG, PNG (max 10MB)</span>
                                                    </label>
                                                    {licenseFile && !isUploadingLicense && (
                                                        <Button size="sm" className="mt-4" onClick={() => handleLicenseUpload(licenseFile, licenseExpiryDate)}>
                                                            Upload Selected File
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Kitchen Terms & Policies Card - shown alongside license */}
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <FileText className="h-5 w-5 text-primary" />
                                        Kitchen Terms & Policies
                                    </CardTitle>
                                    <CardDescription>
                                        Upload your kitchen-specific terms, house rules, and policies that chefs must review when applying.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {/* Show existing terms if uploaded */}
                                    {location.kitchenTermsUrl && (
                                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                            <div className="flex items-center gap-2 font-medium text-blue-800 mb-2">
                                                <CheckCircle className="h-5 w-5 text-blue-600" />
                                                <span>Terms Document Uploaded</span>
                                            </div>
                                            <div className="text-sm text-blue-700">
                                                <p>Document: <span className="font-medium">{getDocumentFilename(location.kitchenTermsUrl)}</span></p>
                                                {location.kitchenTermsUploadedAt && (
                                                    <p>Uploaded: <span className="font-medium">{new Date(location.kitchenTermsUploadedAt).toLocaleDateString()}</span></p>
                                                )}
                                            </div>
                                            <a 
                                                href={location.kitchenTermsUrl} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="text-sm text-blue-600 hover:underline mt-2 inline-block"
                                            >
                                                View Document →
                                            </a>
                                        </div>
                                    )}

                                    {/* Upload section */}
                                    <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
                                        <div className="space-y-2">
                                            <Label>{location.kitchenTermsUrl ? 'Replace Terms Document' : 'Upload Terms Document'}</Label>
                                            <p className="text-xs text-muted-foreground">
                                                Include house rules, equipment usage policies, liability waivers, and any other terms chefs should agree to.
                                            </p>
                                            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
                                                <input
                                                    type="file"
                                                    accept=".pdf,.jpg,.png,.doc,.docx"
                                                    className="hidden"
                                                    id="terms-upload-input"
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) setTermsFile(file);
                                                    }}
                                                    disabled={isUploadingTerms}
                                                />
                                                <label htmlFor="terms-upload-input" className="cursor-pointer flex flex-col items-center gap-2">
                                                    {isUploadingTerms ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <Upload className="h-8 w-8 text-muted-foreground" />}
                                                    <span className="text-sm font-medium">{termsFile ? termsFile.name : "Click to upload"}</span>
                                                    <span className="text-xs text-muted-foreground">PDF, JPG, PNG, DOC (max 10MB)</span>
                                                </label>
                                                {termsFile && !isUploadingTerms && (
                                                    <Button size="sm" className="mt-4" onClick={() => handleTermsUpload(termsFile)}>
                                                        Upload Terms Document
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        {/* BRANDING TAB */}
                        <TabsContent value="branding" className="space-y-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Location Logo</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="max-w-md">
                                        <ImageWithReplace
                                            imageUrl={logoUrl || undefined}
                                            onImageChange={url => {
                                                setLogoUrl(url || '');
                                                handleSave(url || '');
                                            }}
                                            onRemove={() => {
                                                setLogoUrl('');
                                                handleSave('');
                                            }}
                                            className="w-full h-32 object-contain rounded-lg border"
                                            aspectRatio="16/9"
                                            fieldName="logo"
                                        />
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <div>
                                        <CardTitle>Kitchen Spaces</CardTitle>
                                        <CardDescription>Manage your kitchen spaces and galleries.</CardDescription>
                                    </div>
                                    {!showCreateKitchen && (
                                        <Button onClick={() => setShowCreateKitchen(true)} size="sm" className="gap-2">
                                            <Plus className="h-4 w-4" /> Add Kitchen
                                        </Button>
                                    )}
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {showCreateKitchen && (
                                        <div className="border rounded-lg p-4 bg-muted/20 space-y-4 animate-in fade-in slide-in-from-top-2">
                                            <h4 className="font-medium">New Kitchen</h4>
                                            <div className="space-y-2">
                                                <Label>Name</Label>
                                                <Input value={newKitchenName} onChange={e => setNewKitchenName(e.target.value)} placeholder="e.g. Main Kitchen" />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Description</Label>
                                                <Textarea value={newKitchenDescription} onChange={e => setNewKitchenDescription(e.target.value)} placeholder="Describe the space..." />
                                            </div>
                                            <div className="flex gap-2">
                                                <Button
                                                    onClick={async () => {
                                                        if (!newKitchenName) return;
                                                        setIsCreatingKitchen(true);
                                                        try {
                                                            const token = await auth.currentUser?.getIdToken();
                                                            await fetch('/api/manager/kitchens', {
                                                                method: 'POST',
                                                                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({ locationId: location.id, name: newKitchenName, description: newKitchenDescription })
                                                            });
                                                            queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });
                                                            setNewKitchenName('');
                                                            setNewKitchenDescription('');
                                                            setShowCreateKitchen(false);
                                                        } catch (e) { console.error(e); } finally { setIsCreatingKitchen(false); }
                                                    }}
                                                    disabled={isCreatingKitchen}
                                                >
                                                    {isCreatingKitchen ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
                                                </Button>
                                                <Button variant="outline" onClick={() => setShowCreateKitchen(false)}>Cancel</Button>
                                            </div>
                                        </div>
                                    )}

                                    {kitchens.map(kitchen => (
                                        <div key={kitchen.id} className="border rounded-lg p-4 space-y-4">
                                            <div className="flex flex-col md:flex-row gap-4">
                                                <div className="flex-1 space-y-4">
                                                    <h4 className="font-semibold text-lg">{kitchen.name}</h4>
                                                    <div className="space-y-2">
                                                        <Label>Description</Label>
                                                        <Textarea
                                                            value={kitchenDescriptions[kitchen.id] ?? kitchen.description ?? ''}
                                                            onChange={e => setKitchenDescriptions(prev => ({ ...prev, [kitchen.id]: e.target.value }))}
                                                            onBlur={async (e) => {
                                                                if (e.target.value !== kitchen.description) {
                                                                    const token = await auth.currentUser?.getIdToken();
                                                                    await fetch(`/api/manager/kitchens/${kitchen.id}`, {
                                                                        method: 'PUT',
                                                                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                                                                        body: JSON.stringify({ description: e.target.value })
                                                                    });
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="w-full md:w-48">
                                                    <Label className="mb-2 block">Main Image</Label>
                                                    <ImageWithReplace
                                                        imageUrl={(kitchen as any).imageUrl}
                                                        onImageChange={async url => {
                                                            const token = await auth.currentUser?.getIdToken();
                                                            await fetch(`/api/manager/kitchens/${kitchen.id}/image`, {
                                                                method: 'PUT',
                                                                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({ imageUrl: url })
                                                            });
                                                            queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });
                                                        }}
                                                        className="h-32 object-cover rounded-lg"
                                                        aspectRatio="16/9"
                                                    />
                                                </div>
                                            </div>
                                            <div className="pt-4 border-t">
                                                <Label className="mb-3 block">Gallery</Label>
                                                <KitchenGalleryImages
                                                    kitchenId={kitchen.id}
                                                    galleryImages={kitchen.galleryImages || []}
                                                    locationId={location.id}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        </TabsContent>

                        {/* NOTIFICATIONS TAB */}
                        <TabsContent value="notifications">
                            <Card>
                                <CardHeader><CardTitle>Notification Settings</CardTitle></CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>Email Address</Label>
                                        <Input value={notificationEmail} onChange={e => setNotificationEmail(e.target.value)} type="email" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Phone Number</Label>
                                        <Input value={notificationPhone} onChange={e => setNotificationPhone(e.target.value)} type="tel" />
                                    </div>
                                    <Button onClick={() => handleSave()} disabled={isUpdating} className="mt-4">
                                        <Save className="h-4 w-4 mr-2" /> Save Changes
                                    </Button>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        {/* BOOKING RULES TAB */}
                        <TabsContent value="booking-rules">
                            <Card>
                                <CardHeader><CardTitle>Booking Rules</CardTitle></CardHeader>
                                <CardContent className="space-y-6">
                                    <div className="space-y-2">
                                        <Label>Cancellation Window (Hours)</Label>
                                        <Input type="number" value={cancellationHours} onChange={e => setCancellationHours(parseInt(e.target.value) || 0)} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Policy Message</Label>
                                        <Textarea value={cancellationMessage} onChange={e => setCancellationMessage(e.target.value)} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Default Daily Limit (Hours)</Label>
                                        <Input type="number" value={dailyBookingLimit} onChange={e => setDailyBookingLimit(parseInt(e.target.value) || 0)} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Minimum Advance Notice (Hours)</Label>
                                        <Input type="number" value={minimumBookingWindowHours} onChange={e => setMinimumBookingWindowHours(parseInt(e.target.value) || 0)} />
                                    </div>
                                    <Button onClick={() => handleSave()} disabled={isUpdating}>
                                        <Save className="h-4 w-4 mr-2" /> Save All Settings
                                    </Button>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        {/* APP REQUIREMENTS TAB */}
                        <TabsContent value="application-requirements">
                            <LocationRequirementsSettings locationId={location.id} locationName={location.name} />
                        </TabsContent>

                        {/* LOCATION TAB */}
                        <TabsContent value="location">
                            <Card>
                                <CardHeader><CardTitle>Location</CardTitle></CardHeader>
                                <CardContent>
                                    <div className="space-y-2">
                                        <Label>Timezone</Label>
                                        <div className="border rounded-md p-3 bg-muted text-muted-foreground flex items-center gap-2">
                                            <Globe className="h-4 w-4" />
                                            Newfoundland Time (GMT-3:30) (Locked)
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>

                    </Tabs>
                </div>
            </div>
        </div>
    );
}
