
import { useState } from "react";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Plus, Upload, X } from "@/components/ui/manager-icons";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createLocationSchema, CreateLocationFormValues } from "@/schemas/locationSchema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { FormLegend } from "@/components/ui/form-legend";
import { DateField } from "@/components/ui/date-field";
import { UnsavedChangesDialog } from "@/components/manager/UnsavedChangesDialog";

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
    const [licenseExpiryDate, setLicenseExpiryDate] = useState("");
    const [termsFile, setTermsFile] = useState<File | null>(null);
    const [isUploadingLicense, setIsUploadingLicense] = useState(false);
    const [isUploadingTerms, setIsUploadingTerms] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [confirmExit, setConfirmExit] = useState(false);

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
        setLicenseExpiryDate("");
        setTermsFile(null);
    };
    const requestClose = () => {
        if (isCreating || isUploadingLicense || isUploadingTerms) return;
        if (form.formState.isDirty || licenseFile || termsFile || licenseExpiryDate) setConfirmExit(true);
        else { onOpenChange(false); resetForm(); }
    };

    /**
     * Upload one document and return its URL. Both attachments route through here so the two
     * copies of this fetch cannot drift apart.
     */
    const uploadDocument = async (file: File, token: string): Promise<string> => {
        const body = new FormData();
        body.append("file", file);
        const response = await fetch("/api/files/upload-file", {
            method: "POST",
            headers: { 'Authorization': `Bearer ${token}` },
            credentials: "include",
            body,
        });
        if (!response.ok) throw new Error(tt("failedToUploadLicense"));
        return (await response.json()).url;
    };

    const onSubmit = async (data: CreateLocationFormValues) => {
        setIsCreating(true);
        try {
            const currentFirebaseUser = auth.currentUser;
            if (!currentFirebaseUser) throw new Error(tt("firebaseUserNotAvailable"));

            const token = await currentFirebaseUser.getIdToken();

            /*
             * The licence and the terms are OPTIONAL, deliberately.
             *
             * The licence is written ONTO a location (`location.kitchenLicenseUrl`), so it cannot
             * exist before one does — requiring it in the form that CREATES the location puts a
             * document upload in front of the very thing the document belongs to, and a manager who
             * has not found that PDF yet cannot get past it. It becomes the next outstanding item
             * instead, on the dashboard's licence page.
             *
             * The one rule that stays: a licence WITH NO EXPIRY is refused, here and by the API
             * ("A license expiry date is required when uploading a kitchen license"), because a
             * document nobody can date cannot be reviewed or warned about before it lapses.
             */
            if (licenseFile && !licenseExpiryDate) {
                toast({ title: mt("expirationDateRequired"),
                    description: mt("pleaseProvideAnExpirationDateForTheLicense"),
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
                throw new Error(error.error || tt("failedToCreateLocation"));
            }

            const newLocation = await response.json();

            // Attach only what was actually supplied, in ONE write.
            const documents: Record<string, unknown> = {};
            if (licenseFile) {
                setIsUploadingLicense(true);
                documents.kitchenLicenseUrl = await uploadDocument(licenseFile, token);
                documents.kitchenLicenseStatus = 'pending';
                documents.kitchenLicenseExpiry = licenseExpiryDate;
                setIsUploadingLicense(false);
            }
            if (termsFile) {
                setIsUploadingTerms(true);
                documents.kitchenTermsUrl = await uploadDocument(termsFile, token);
                setIsUploadingTerms(false);
            }

            if (Object.keys(documents).length > 0) {
                const attach = await fetch(`/api/manager/locations/${newLocation.id}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    credentials: "include",
                    body: JSON.stringify(documents),
                });
                if (!attach.ok) {
                    const error = await attach.json().catch(() => ({}));
                    throw new Error(error.error || tt("failedToCreateLocation"));
                }
            }

            queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });

            // The description names the documents only when there were any — claiming they were
            // submitted is the kind of copy that makes a platform feel untrustworthy.
            toast({ title: mt("locationCreated"),
                description: documents.kitchenLicenseUrl
                    ? `${newLocation.name} has been created. License and terms submitted.`
                    : newLocation.name,
            });

            onLocationCreated(newLocation);
            onOpenChange(false);
            resetForm();

        } catch (error: any) {
            toast({ title: mt("error"),
                description: error.message || tt("failedToCreateLocation"),
                variant: "destructive",
            });
        } finally {
            setIsCreating(false);
            setIsUploadingLicense(false);
            setIsUploadingTerms(false);
        }
    };

    return (
        <>
        <Dialog open={open} onOpenChange={(val) => val ? onOpenChange(true) : requestClose()}>
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        {hasExistingLocations ? mt("addNewLocation") : mt("createYourFirstLocation")}
                    </DialogTitle>
                    <DialogDescription>{mt("enterTheDetailsForYourNewKitchenLocation")}</DialogDescription>
                </DialogHeader>

                <FormLegend />

                {/*
                  * A note, not a warning. These documents are OPTIONAL here: the licence is written
                  * ONTO a location, so it cannot exist before one does, and gating creation on it
                  * put a document upload in front of the very thing the document belongs to. The
                  * amber "Required Documents" framing made a three-field form read as a compliance
                  * checkpoint. The expiry date stays conditional — see the guard in onSubmit.
                  */}
                <p className="text-xs text-muted-foreground">{mt("locationDocumentsOptional")}</p>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{mt("locationName")}<span className="text-destructive">*</span></FormLabel>
                                    <FormControl>
                                        <Input placeholder={mt("eGDowntownKitchen2")} {...field} />
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
                                    <FormLabel>{mt("address")}<span className="text-destructive">*</span></FormLabel>
                                    <FormControl>
                                        <Input placeholder={mt("placeholderAddressExample")} {...field} />
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
                                        <FormLabel>{mt("notificationEmail")}</FormLabel>
                                        <FormControl>
                                            <Input type="email" placeholder={mt("emailExampleCom")} {...field} />
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
                                        <FormLabel>{mt("notificationPhone")}</FormLabel>
                                        <FormControl>
                                            <Input type="tel" placeholder="(709) 555-1234" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        {/*
                          * The expiry date appears WITH the licence, never on its own.
                          *
                          * A licence and its date are one fact — the date is what makes the document
                          * reviewable and what lets the platform warn before it lapses — so asking
                          * for a date on its own invites a date for a document that is not there.
                          * Choosing the file reveals the field; the guard in onSubmit is the
                          * backstop, not the only defence.
                          */}
                        {licenseFile && (
                            <div className="space-y-2">
                                <FormLabel>{mt("licenseExpirationDate")}</FormLabel>
                                <DateField
                                    id="new-location-license-expiry"
                                    value={licenseExpiryDate}
                                    onChange={setLicenseExpiryDate}
                                    placeholder={mt("licenseExpirationDate")}
                                />
                                <p className="text-[0.8rem] text-muted-foreground">{mt("licenseExpiryRequiredWithUpload")}</p>
                            </div>
                        )}

                        <div className="space-y-2">
                            <FormLabel>{mt("kitchenLicense")}</FormLabel>
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
                                                        toast({ title: mt("fileTooLarge"),
                                                            description: mt("pleaseUploadAFileSmallerThan10MB"),
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
                                        <span className="text-sm font-medium text-primary">{mt("clickToUploadLicense")}</span>
                                        <span className="text-xs text-muted-foreground">{mt("pDFJPGOrPNGMax10MB")}</span>
                                    </label>
                                )}
                            </div>
                            <p className="text-[0.8rem] text-muted-foreground">{mt("uploadAValidFoodEstablishmentPermitOrKitchenLicense")}</p>
                        </div>

                        {/* Kitchen Terms & Policies Upload */}
                        <div className="space-y-2">
                            <FormLabel>{mt("kitchenTermsPolicies")}</FormLabel>
                            <div
                                className={cn(
                                    "border-2 border-dashed border-border rounded-lg p-4 hover:border-primary/50 transition-colors bg-muted/10",
                                    termsFile ? "border-primary/50 bg-primary/5" : ""
                                )}
                            >
                                {termsFile ? (
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <FileText className="h-5 w-5 text-primary" />
                                            <span className="text-sm text-foreground truncate max-w-[200px]">{termsFile.name}</span>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setTermsFile(null)}
                                            className="h-8 w-8 p-0"
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ) : (
                                    <label className="cursor-pointer flex flex-col items-center gap-2">
                                        <input
                                            type="file"
                                            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) {
                                                    if (file.size > 10 * 1024 * 1024) {
                                                        toast({ title: mt("fileTooLarge"),
                                                            description: mt("pleaseUploadAFileSmallerThan10MB"),
                                                            variant: "destructive",
                                                        });
                                                        return;
                                                    }
                                                    setTermsFile(file);
                                                }
                                            }}
                                            className="hidden"
                                        />
                                        <Upload className="h-8 w-8 text-muted-foreground" />
                                        <span className="text-sm font-medium text-primary">{mt("clickToUploadTerms")}</span>
                                        <span className="text-xs text-muted-foreground">{mt("pDFJPGPNGOrDOCMax10MB")}</span>
                                    </label>
                                )}
                            </div>
                            <p className="text-[0.8rem] text-muted-foreground">{mt("uploadYourKitchenHouseRulesUsagePoliciesAndTermsThatChefsMus")}</p>
                        </div>

                        <DialogFooter className="mt-6">
                            <Button type="button" variant="ghost" onClick={requestClose} disabled={isCreating}>{mt("cancel")}</Button>
                            <StatusButton
                                type="submit"
                                status={(isCreating || isUploadingLicense || isUploadingTerms) ? "loading" : "idle"}
                                labels={{ idle: mt("createLocation"), loading: (isUploadingLicense || isUploadingTerms) ? mt("uploadingLabel") : mt("creating"), success: mt("created") }}
                            />
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
        <UnsavedChangesDialog open={confirmExit} onOpenChange={setConfirmExit} description={mt("locationModalUnsavedDescription")} onDiscard={() => { setConfirmExit(false); onOpenChange(false); resetForm(); }} />
        </>
    );
}
