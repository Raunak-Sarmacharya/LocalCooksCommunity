
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Plus, Upload, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface CreateLocationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onLocationCreated: (location: any) => void;
    hasExistingLocations: boolean;
}

export function CreateLocationDialog({
    open,
    onOpenChange,
    onLocationCreated,
    hasExistingLocations
}: CreateLocationDialogProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [name, setName] = useState('');
    const [address, setAddress] = useState('');
    const [notificationEmail, setNotificationEmail] = useState('');
    const [notificationPhone, setNotificationPhone] = useState('');
    const [licenseFile, setLicenseFile] = useState<File | null>(null);

    const [isUploadingLicense, setIsUploadingLicense] = useState(false);
    const [isCreating, setIsCreating] = useState(false);

    const resetForm = () => {
        setName('');
        setAddress('');
        setNotificationEmail('');
        setNotificationPhone('');
        setLicenseFile(null);
    };

    const handleCreateLocation = async () => {
        if (!name.trim() || !address.trim()) {
            toast({
                title: "Missing Information",
                description: "Please fill in location name and address",
                variant: "destructive",
            });
            return;
        }

        setIsCreating(true);
        try {
            const currentFirebaseUser = auth.currentUser;
            if (!currentFirebaseUser) throw new Error("Firebase user not available");

            const token = await currentFirebaseUser.getIdToken();

            // Upload license file if provided
            let licenseUrl: string | undefined;
            if (licenseFile) {
                setIsUploadingLicense(true);
                const formData = new FormData();
                formData.append("file", licenseFile);

                const uploadResponse = await fetch("/api/upload-file", {
                    method: "POST",
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    },
                    credentials: "include",
                    body: formData,
                });

                if (!uploadResponse.ok) throw new Error("Failed to upload license file");

                const uploadResult = await uploadResponse.json();
                licenseUrl = uploadResult.url;
                setIsUploadingLicense(false);
            }

            // Create the location
            const response = await fetch(`/api/manager/locations`, {
                method: "POST",
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                credentials: "include",
                body: JSON.stringify({
                    name: name.trim(),
                    address: address.trim(),
                    notificationEmail: notificationEmail.trim() || undefined,
                    notificationPhone: notificationPhone.trim() || undefined,
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || "Failed to create location");
            }

            const newLocation = await response.json();

            // Update location with license if uploaded
            if (licenseUrl) {
                // Optimistically ignore failure here as location is already created
                await fetch(`/api/manager/locations/${newLocation.id}`, {
                    method: "PUT",
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    credentials: "include",
                    body: JSON.stringify({
                        kitchenLicenseUrl: licenseUrl,
                        kitchenLicenseStatus: 'pending',
                    }),
                }).catch(err => console.error("Failed to update license on new location", err));
            }

            queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });

            toast({
                title: "Location Created",
                description: licenseUrl
                    ? `${newLocation.name} has been created. License submitted for approval.`
                    : `${newLocation.name} has been created. Upload a license to activate bookings.`,
            });

            onLocationCreated(newLocation);
            onOpenChange(false);
            resetForm();

        } catch (error: any) {
            toast({
                title: "Error",
                description: error.message || "Failed to create location",
                variant: "destructive",
            });
        } finally {
            setIsCreating(false);
            setIsUploadingLicense(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(val) => {
            if (!val) resetForm(); // Reset on close
            onOpenChange(val);
        }}>
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        {hasExistingLocations ? 'Add New Location' : 'Create Your First Location'}
                    </DialogTitle>
                    <DialogDescription>
                        Enter the details for your new kitchen location.
                    </DialogDescription>
                </DialogHeader>

                {hasExistingLocations && (
                    <Alert className="bg-amber-50 border-amber-200">
                        <AlertTitle className="text-amber-800 flex items-center gap-2">
                            <FileText className="h-4 w-4" />
                            License Required
                        </AlertTitle>
                        <AlertDescription className="text-amber-700 text-xs mt-1">
                            Each location requires its own kitchen license approval before bookings can be accepted.
                        </AlertDescription>
                    </Alert>
                )}

                <div className="space-y-4 py-2">
                    <div className="space-y-2">
                        <Label htmlFor="location-name">Location Name <span className="text-destructive">*</span></Label>
                        <Input
                            id="location-name"
                            placeholder="e.g., Downtown Kitchen"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="location-address">Address <span className="text-destructive">*</span></Label>
                        <Input
                            id="location-address"
                            placeholder="e.g., 123 Main St, St. John's, NL"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="notif-email">Notification Email</Label>
                            <Input
                                id="notif-email"
                                type="email"
                                placeholder="email@example.com"
                                value={notificationEmail}
                                onChange={(e) => setNotificationEmail(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="notif-phone">Notification Phone</Label>
                            <Input
                                id="notif-phone"
                                type="tel"
                                placeholder="(709) 555-1234"
                                value={notificationPhone}
                                onChange={(e) => setNotificationPhone(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Kitchen License {hasExistingLocations ? '*' : '(Optional)'}</Label>
                        <div
                            className={cn(
                                "border-2 border-dashed border-border rounded-lg p-4 hover:border-primary/50 transition-colors bg-muted/10",
                                licenseFile ? "border-primary/50 bg-primary/5" : ""
                            )}
                        >
                            {licenseFile ? (
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <FileText className="h-5 w-5 text-primary" />
                                        <span className="text-sm text-foreground truncate max-w-[200px]">{licenseFile.name}</span>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setLicenseFile(null)}
                                        className="h-8 w-8 p-0"
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            ) : (
                                <label className="cursor-pointer flex flex-col items-center gap-2">
                                    <input
                                        type="file"
                                        accept=".pdf,.jpg,.jpeg,.png"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                                if (file.size > 10 * 1024 * 1024) {
                                                    toast({
                                                        title: "File Too Large",
                                                        description: "Please upload a file smaller than 10MB",
                                                        variant: "destructive",
                                                    });
                                                    return;
                                                }
                                                setLicenseFile(file);
                                            }
                                        }}
                                        className="hidden"
                                    />
                                    <Upload className="h-8 w-8 text-muted-foreground" />
                                    <span className="text-sm font-medium text-primary">Click to upload license</span>
                                    <span className="text-xs text-muted-foreground">PDF, JPG, or PNG (max 10MB)</span>
                                </label>
                            )}
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCreating}>
                        Cancel
                    </Button>
                    <Button onClick={handleCreateLocation} disabled={isCreating || isUploadingLicense}>
                        {isUploadingLicense ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Uploading...
                            </>
                        ) : isCreating ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Creating...
                            </>
                        ) : (
                            <>
                                <Plus className="h-4 w-4 mr-2" />
                                Create Location
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
