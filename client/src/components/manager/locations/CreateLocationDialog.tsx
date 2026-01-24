
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Plus, Upload, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createLocationSchema, CreateLocationFormValues } from "@/schemas/locationSchema";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";

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

    const [licenseFile, setLicenseFile] = useState<File | null>(null);
    const [isUploadingLicense, setIsUploadingLicense] = useState(false);
    const [isCreating, setIsCreating] = useState(false);

    const form = useForm<CreateLocationFormValues>({
        resolver: zodResolver(createLocationSchema),
        defaultValues: {
            name: "",
            address: "",
            notificationEmail: "",
            notificationPhone: "",
        },
    });

    const resetForm = () => {
        form.reset();
        setLicenseFile(null);
    };

    const onSubmit = async (data: CreateLocationFormValues) => {
        setIsCreating(true);
        try {
            const currentFirebaseUser = auth.currentUser;
            if (!currentFirebaseUser) throw new Error("Firebase user not available");

            const token = await currentFirebaseUser.getIdToken();

            // License is now required, validation happens before this block/API call
            if (!licenseFile) {
                toast({
                    title: "License Required",
                    description: "Please upload a kitchen license to create a location.",
                    variant: "destructive",
                });
                setIsCreating(false);
                return;
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
                    name: data.name.trim(),
                    address: data.address.trim(),
                    notificationEmail: data.notificationEmail?.trim() || undefined,
                    notificationPhone: data.notificationPhone?.trim() || undefined,
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || "Failed to create location");
            }

            const newLocation = await response.json();

            // License is mandatory, so we always upload it here
            setIsUploadingLicense(true);
            const formData = new FormData();
            formData.append("file", licenseFile);

            const uploadResponse = await fetch("/api/files/upload-file", {
                method: "POST",
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
                credentials: "include",
                body: formData,
            });

            if (!uploadResponse.ok) throw new Error("Failed to upload license file"); // or handle gracefully but we require it

            const uploadResult = await uploadResponse.json();
            const licenseUrl = uploadResult.url;
            setIsUploadingLicense(false);

            // Update location with license
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
            });

            queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });

            toast({
                title: "Location Created",
                description: `${newLocation.name} has been created. License submitted for approval.`,
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

                <Alert className="bg-amber-50 border-amber-200">
                    <AlertTitle className="text-amber-800 flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        License Required
                    </AlertTitle>
                    <AlertDescription className="text-amber-700 text-xs mt-1">
                        A valid kitchen license or food establishment permit is required to create a location.
                    </AlertDescription>
                </Alert>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Location Name <span className="text-destructive">*</span></FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g., Downtown Kitchen" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="address"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Address <span className="text-destructive">*</span></FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g., 123 Main St, St. John's, NL" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="notificationEmail"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Notification Email</FormLabel>
                                        <FormControl>
                                            <Input type="email" placeholder="email@example.com" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="notificationPhone"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Notification Phone</FormLabel>
                                        <FormControl>
                                            <Input type="tel" placeholder="(709) 555-1234" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="space-y-2">
                            <FormLabel>Kitchen License <span className="text-destructive">*</span></FormLabel>
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
                                            type="button"
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
                            <p className="text-[0.8rem] text-muted-foreground">
                                Upload a valid food establishment permit or kitchen license.
                            </p>
                        </div>

                        <DialogFooter className="mt-6">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isCreating}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isCreating || isUploadingLicense}>
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
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
