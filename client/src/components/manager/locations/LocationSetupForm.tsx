import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { useToast } from "@/hooks/use-toast";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { Input } from "@/components/ui/input";
import { CARD_RADIUS, Card, CardContent } from "@/components/ui/card";
import { FormLegend } from "@/components/ui/form-legend";
import { SettingsRow } from "@/components/manager/settings/SettingsRow";
import AddressAutocomplete from "@/components/ui/address-autocomplete";
import { SERVICE_PROVINCE } from "@shared/service-area";
import { ACCEPTED_IMAGE_TYPES, LogoPhotoField } from "@/components/manager/kitchen/KitchenPhotoFields";
import { cn } from "@/lib/utils";

/**
 * Add a location — IN PLACE, on the page, not in a modal.
 *
 * ## Why it is not a dialog
 *
 * The old one was, and it was the wrong tool. Two reasons, and the second is the decisive one:
 *
 * 1. **It scrolled.** It was `max-h-[90vh] overflow-y-auto` with six fields, two file uploads and a
 *    date picker. SaaSUI's dialog guidance is blunt about that shape: *"Keep it short enough to avoid
 *    scrolling. A scrolling modal usually means the content outgrew the pattern."*
 * 2. **There is nothing behind it.** This form appears only when the manager has NO location — so it
 *    sits over an otherwise EMPTY page. A modal earns its interruption by dimming context the user
 *    needs to keep in view; here there is none, so the overlay was a layer that hid nothing. Their
 *    rule: *"If the user can reasonably ignore it, it should not be a modal."*
 *
 * The repo had already made this call once, for the kitchen step, and written it down: the form IS
 * the part, not something that opens over it. This is the same shape for the same reason.
 *
 * ## Why these three fields
 *
 * - **Name and address** are what the endpoint requires. Nothing else is negotiable.
 * - **Logo** is here on purpose, and it is the one field worth arguing for: the Business step's first
 *   part is not complete without it (`partIsValid(0)`), so leaving it out would mean a
 *   dashboard-created location still sends the manager into the wizard to finish part one. With it,
 *   this form completes that part outright — which is what the dashboard was asked to do.
 * - **Licence, terms, contact email and phone are deliberately absent.** The licence is written ONTO
 *   a location, so requiring it in the form that creates the location puts a document upload in front
 *   of the thing the document belongs to. The contact details belong to the ACCOUNT and are already
 *   filled from it. Both have homes of their own later, and the footer says so rather than leaving
 *   the manager to wonder.
 */
export function LocationSetupForm({ onCancel }: { onCancel?: () => void }) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [name, setName] = useState("");
    const [address, setAddress] = useState("");
    const [logoUrl, setLogoUrl] = useState("");
    const [isCreating, setIsCreating] = useState(false);

    const { uploadFile: uploadLogoFile } = useSessionFileUpload({
        allowedTypes: ACCEPTED_IMAGE_TYPES,
        onError: (message) => toast({ title: mt("uploadFailed2"), description: message, variant: "destructive" }),
    });

    const uploadLogo = async (file: File) => {
        const result = await uploadLogoFile(file, "location-logos");
        if (result?.url) setLogoUrl(result.url);
    };

    /** The endpoint's own minimums, so the button never lies about being ready. */
    const isReady = name.trim().length >= 2 && address.trim().length >= 5 && Boolean(logoUrl);

    const handleCreate = async () => {
        setIsCreating(true);
        try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) throw new Error(tt("firebaseUserNotAvailable"));

            const response = await fetch("/api/manager/locations", {
                method: "POST",
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                credentials: "include",
                body: JSON.stringify({
                    name: name.trim(),
                    address: address.trim(),
                    logoUrl: logoUrl || undefined,
                }),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || tt("failedToCreateLocation"));
            }

            /*
             * No navigation and no callback. The dashboard selects the first location as soon as one
             * exists, so invalidating the list is the whole hand-off — the page that was showing the
             * prerequisite fills itself in. Passing the created row up would be a second way to set
             * the same state.
             */
            queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
            toast({ title: mt("locationCreated"), description: name.trim() });
        } catch (error: any) {
            toast({ title: mt("error"), description: error.message, variant: "destructive" });
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <Card
            /*
             * No entrance animation, deliberately. `animate-in fade-in zoom-in-95 duration-200` was
             * here (copied from the kitchen step's form) and it made the form feel LAGGY rather than
             * smooth: the manager clicks "Add your location" and then waits 200ms while the card
             * fades and scales in. The click IS the feedback — the form appearing at once is what
             * reads as responsive. Nothing is loading behind it, so there is nothing for an animation
             * to cover.
             */
            className={cn(
                "border-0",
                "shadow-[0_8px_30px_rgba(44,44,44,0.07)] ring-1 ring-[#2C2C2C]/[0.05]",
                CARD_RADIUS,
            )}
        >
            <CardContent className="divide-y divide-border p-0">
                <div className="px-4 pt-3">
                    <FormLegend />
                </div>

                <SettingsRow id="new-location-name" label={mt("businessName")} required>
                    <Input
                        id="new-location-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={mt("eGDowntownKitchen2")}
                        className="w-64"
                        autoFocus
                    />
                </SettingsRow>

                <SettingsRow id="new-location-address" label={mt("businessAddress")} required>
                    {/* The wizard's own field, so a manager typing an address in either place gets
                        the same suggestions and the same stored value. */}
                    <AddressAutocomplete
                        value={address}
                        onChange={(value) => setAddress(value)}
                        placeholder={mt("placeholderAddressExample")}
                        className="w-64"
                        // Without this the field offers anywhere in the US and Canada: the server's
                        // province filter only engages when it is told the province. See
                        // `shared/service-area.ts`.
                        province={SERVICE_PROVINCE}
                    />
                </SettingsRow>

                <SettingsRow label={mt("locationLogo")} required layout="stacked">
                    <LogoPhotoField
                        value={logoUrl}
                        onSelectFile={(file) => void uploadLogo(file)}
                        onRemove={() => setLogoUrl("")}
                        className="w-full max-w-xs"
                    />
                </SettingsRow>
            </CardContent>

            {/*
              * The footer states what is NOT being asked for, which is the honest way to leave two
              * fields out: a manager looking for the licence upload reads why it is not here instead
              * of wondering whether the form is broken.
              */}
            <div className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-relaxed text-muted-foreground">
                    {mt("locationSetupNote")}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                    {onCancel ? (
                        <Button
                            variant="ghost"
                            onClick={onCancel}
                            disabled={isCreating}
                            className="!min-h-0 !min-w-0 text-muted-foreground hover:bg-muted"
                        >
                            {mt("cancel")}
                        </Button>
                    ) : null}
                    <StatusButton
                        status={isCreating ? "loading" : "idle"}
                        onClick={() => void handleCreate()}
                        disabled={!isReady}
                        labels={{
                            idle: mt("createLocation"),
                            loading: mt("creating"),
                            success: mt("created"),
                        }}
                    />
                </div>
            </div>
        </Card>
    );
}
