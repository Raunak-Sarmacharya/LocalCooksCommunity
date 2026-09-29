import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { useToast } from "@/hooks/use-toast";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import { hasKitchenRate } from "@shared/kitchen-booking-rate";
import { AlertCircle } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyInput } from "@/components/ui/currency-input";
import { NumericInput } from "@/components/ui/numeric-input";
import { CARD_RADIUS, Card, CardContent } from "@/components/ui/card";
import { FormLegend } from "@/components/ui/form-legend";
import { SettingsRow } from "./SettingsRow";
import { ACCEPTED_IMAGE_TYPES, CoverPhotoField } from "@/components/manager/kitchen/KitchenPhotoFields";
import { cn } from "@/lib/utils";

interface KitchenSetupFormProps {
    /** The location the new kitchen belongs to — the endpoint scopes and authorises on it. */
    locationId: number;
    /**
     * Absent when there is nothing to go back to. In practice the manager always has something —
     * the empty state, or the tabs the form replaced — so it is optional only so the form cannot
     * render a Cancel button that does nothing.
     */
    onCancel?: () => void;
    /**
     * The kitchen was created. The host closes the form and shows what it was covering.
     *
     * The host owns that flag, so it is told rather than second-guessed: a `kitchens.length > 0`
     * test on the host side would be a different fact, and it would leave the form on screen after
     * the manager had just created the thing it asks for.
     */
    onCreated?: () => void;
}

/**
 * Add a kitchen — IN PLACE, on the page, not in a modal.
 *
 * ## Why it is not a dialog
 *
 * It was one, and it was the wrong tool for the same two reasons the location dialog was (see
 * `LocationSetupForm`):
 *
 * 1. **There is nothing behind it.** It opens over My Kitchens before any kitchen exists — an empty
 *    page — or over the tabs of a page the manager is deliberately leaving. A modal earns its
 *    interruption by dimming context the user needs to keep in view; here there is none, so the
 *    overlay is a layer that hides nothing. SaaSUI: *"If the user can reasonably ignore it, it
 *    should not be a modal."*
 * 2. **The wizard had already made this call for the same form.** `CreateKitchenStep`'s part 1 IS
 *    the form — there is no card in front of it — and the note there says why: *"It put a button
 *    where the work is."* Two hosts for one kitchen had two different shapes; this makes them one.
 *
 * ## CREATING A KITCHEN IS NOT LISTING IT, and this form only does the first
 *
 * Worth stating outright, because the two are easy to run together and the consequences of doing so
 * are a manager who thinks their space is live when nobody can see it:
 *
 *   - **Create** — `POST /manager/kitchens`. `listing_status` is `.default("draft")`, and the
 *     repository note is explicit: *"a kitchen is invisible until its manager publishes it."* The
 *     endpoint even accepts a kitchen with NO pricing at all (*"Draft kitchens can be created before
 *     their pricing is configured"*), because a draft is not a promise to anyone.
 *   - **List / publish** — `POST /manager/kitchens/:id/listing-status`. That is the ONLY writer of
 *     `listing_status` (`listingStatus` is deliberately absent from the kitchen update schema, so no
 *     generic update can slip past the gate), and it refuses unless the readiness checklist passes.
 *
 * So nothing in this form makes a kitchen visible to chefs. What it enforces is the wizard part 1's
 * minimum for "described", which is a form-level rule rather than a gate: a half-described kitchen is
 * work the manager has to come back to, and the wizard already decided what "described" means. Two
 * forms that create the same record must not disagree about that, which is why the field set is the
 * wizard's field for field — name, description, cover photo, rates, minimum booking hours.
 *
 * The RATE rule inside that set is the platform's own, not this form's opinion: `hasKitchenRate` is
 * the shared owner (the publishing gate, the server's readiness service and both forms read it) and
 * it accepts an hourly OR a daily rate. This form used to demand the hourly specifically — so a
 * manager who charges by the day could not create a kitchen here at all, even though the gate would
 * happily have published one. A form must never be stricter than the gate that will judge its record.
 *
 * ## What it deliberately does NOT ask for
 *
 * - **Gallery photos, storage and equipment.** RECOMMENDATIONS in
 *   `@shared/kitchen-listing-readiness` — they never block publishing — and all three have a home on
 *   this very page.
 * - **Availability.** This one IS a publishing REQUIREMENT (`listingReq_availability`), so it is not
 *   omitted because it does not matter: it is its own step in the wizard and its own page in the app,
 *   and it is not part of "describe the kitchen".
 *
 * The footer says where the rest of it lives, rather than leaving the manager to wonder whether the
 * form is broken.
 */
export function KitchenSetupForm({ locationId, onCancel, onCreated }: KitchenSetupFormProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [imageUrl, setImageUrl] = useState("");
    const [hourlyRate, setHourlyRate] = useState("");
    const [dailyRate, setDailyRate] = useState("");
    const [minimumBookingHours, setMinimumBookingHours] = useState("1");
    const [isCreating, setIsCreating] = useState(false);

    const { uploadFile: uploadCoverFile } = useSessionFileUpload({
        allowedTypes: ACCEPTED_IMAGE_TYPES,
        onError: (message) => toast({ title: mt("uploadFailed2"), description: message, variant: "destructive" }),
    });

    const uploadCover = async (file: File) => {
        const result = await uploadCoverFile(file, "kitchen-covers");
        if (result?.url) setImageUrl(result.url);
    };

    /** The wizard's rule, from the wizard's owner. See `hasKitchenRate`. */
    const hasARate = hasKitchenRate(hourlyRate, dailyRate);

    /** The endpoint's own minimums, so the button never lies about being ready. */
    const isReady =
        Boolean(name.trim()) &&
        Boolean(description.trim()) &&
        Boolean(imageUrl) &&
        hasARate &&
        // 1 is the floor everywhere else — a minimum of zero is the absence of one.
        parseInt(minimumBookingHours, 10) >= 1;

    /**
     * Blank means "no rate in this mode", and it has to travel as `undefined` rather than as 0.
     *
     * `parseFloat('')` is NaN and `JSON.stringify` turns NaN into `null`, which the endpoint rejects
     * ("Hourly rate must be nonnegative integer cents") because `null !== undefined`. That is
     * exactly how a kitchen priced ONLY by the day failed to save: the manager set a daily rate and
     * the request carried a broken hourly one. Omitting the key is a real answer here, not a
     * missing one — the same way `CreateKitchenStep` sends it.
     */
    const toCents = (value: string) =>
        value.trim() === "" ? undefined : Math.round(Number.parseFloat(value) * 100);

    const handleCreate = async () => {
        setIsCreating(true);
        try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) throw new Error(tt("firebaseUserNotAvailable"));

            const response = await fetch("/api/manager/kitchens", {
                method: "POST",
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                credentials: "include",
                body: JSON.stringify({
                    locationId,
                    name: name.trim(),
                    description: description.trim(),
                    imageUrl,
                    hourlyRate: toCents(hourlyRate),
                    dailyRate: toCents(dailyRate),
                    currency: "CAD",
                    minimumBookingHours: parseInt(minimumBookingHours, 10) || 1,
                }),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || tt("failedToCreateKitchen"));
            }

            /*
             * Both lists, because both are read: this page's own kitchen query, and the
             * all-kitchens cache the shell's Availability sidebar reads. Invalidating one leaves the
             * other offering a kitchen that is not there.
             */
            queryClient.invalidateQueries({ queryKey: ["managerKitchens", locationId] });
            queryClient.invalidateQueries({ queryKey: ["/api/manager/all-kitchens"] });

            toast({ title: mt("success"), description: mt("kitchenCreatedSuccessfully") });
            onCreated?.();
        } catch (error: any) {
            toast({ title: mt("error"), description: error.message, variant: "destructive" });
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <div className="space-y-4">
            {/*
             * The heading the dialog used to carry. The page header names the PAGE ("My Kitchens"),
             * so without this the manager who opened the form from the switcher menu would face a
             * card of fields with nothing saying what they are for.
             */}
            <div className="space-y-1">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">{mt("newKitchen")}</h2>
                <p className="text-sm text-muted-foreground">{mt("newKitchenDescription")}</p>
            </div>

            <Card
                /*
                 * No entrance animation, deliberately — the same call as `LocationSetupForm`. The
                 * click IS the feedback; a card that fades and scales in for 200ms reads as lag,
                 * not as polish, and nothing is loading behind it for an animation to cover.
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

                    <SettingsRow id="new-kitchen-name" label={mt("kitchenName")} required>
                        <Input
                            id="new-kitchen-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={mt("eGMainKitchenPrepAreaBakeryStation")}
                            className="w-64"
                            autoFocus
                        />
                    </SettingsRow>

                    <SettingsRow
                        id="new-kitchen-description"
                        label={mt("description")}
                        required
                        layout="stacked"
                        hint={mt("describeYourKitchenSpaceEquipmentAndWhatMakesItSpecialForChe")}
                    >
                        <Textarea
                            id="new-kitchen-description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={3}
                            className="max-w-lg resize-none"
                        />
                    </SettingsRow>

                    <SettingsRow
                        label={mt("coverPhoto")}
                        required
                        layout="stacked"
                        hint={mt("aGreatCoverPhotoHelpsAttractMoreChefsToYourSpace")}
                    >
                        <CoverPhotoField
                            value={imageUrl}
                            onSelectFile={(file) => void uploadCover(file)}
                            onRemove={() => setImageUrl("")}
                            disabled={isCreating}
                            className="w-full max-w-xs"
                        />
                    </SettingsRow>

                    {/*
                     * Two ways to give one required answer.
                     *
                     * Neither row carries the required asterisk, because neither is required on its
                     * own — the PAIR is, and the legend's asterisk would say "set both". The rule is
                     * stated once, on the first row, and the second carries a short version of it so
                     * it stands alone for anyone who reads the fields out of order. Same shape and
                     * same copy as the wizard's part 1.
                     */}
                    <SettingsRow
                        id="new-kitchen-rate"
                        label={mt("hourlyRateCAD")}
                        hint={mt("kitchenRateRuleHint")}
                    >
                        <CurrencyInput
                            id="new-kitchen-rate"
                            value={hourlyRate}
                            onValueChange={setHourlyRate}
                            placeholder="25.00"
                            className="w-32"
                        />
                    </SettingsRow>

                    <SettingsRow
                        id="new-kitchen-daily-rate"
                        label={mt("dailyRateCAD")}
                        hint={mt("kitchenRateDailyHint")}
                    >
                        <CurrencyInput
                            id="new-kitchen-daily-rate"
                            value={dailyRate}
                            onValueChange={setDailyRate}
                            placeholder="150.00"
                            className="w-32"
                        />
                    </SettingsRow>

                    <SettingsRow id="new-kitchen-minimum" label={mt("minimumBooking")} required>
                        <NumericInput
                            id="new-kitchen-minimum"
                            value={minimumBookingHours}
                            onValueChange={(val) => {
                                if (val === "") {
                                    setMinimumBookingHours("");
                                    return;
                                }
                                const parsed = parseInt(val, 10);
                                if (!isNaN(parsed) && parsed >= 1 && parsed <= 24) {
                                    setMinimumBookingHours(String(parsed));
                                }
                            }}
                            placeholder="1"
                            suffix={mt("hoursSuffix")}
                            className="w-32"
                        />
                    </SettingsRow>
                </CardContent>

                <div className="border-t border-border p-4">
                    {/*
                     * The reason the primary is inert, stated ABOVE the row rather than between the
                     * buttons — the same placement and treatment the wizard's footer uses, because a
                     * greyed-out button with no stated reason is a dead end.
                     */}
                    {!isReady ? (
                        <p className="mb-3 flex items-start gap-1.5 text-xs text-muted-foreground" role="status">
                            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
                            {mt("completeKitchenEssentials")}
                        </p>
                    ) : null}

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        {/*
                         * The footer states what is NOT being asked for, which is the honest way to
                         * leave four things out: a manager looking for the gallery reads why it is
                         * not here instead of wondering whether the form is broken.
                         */}
                        <p className="text-xs leading-relaxed text-muted-foreground">
                            {mt("kitchenSetupNote")}
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
                                    idle: mt("createKitchen"),
                                    loading: mt("creating"),
                                    success: mt("created"),
                                }}
                            />
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    );
}
