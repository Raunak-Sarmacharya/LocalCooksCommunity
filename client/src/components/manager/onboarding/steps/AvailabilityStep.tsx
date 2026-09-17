import { useEffect, useRef, useState } from 'react';
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { CheckCircle, Calendar, ClipboardCheck } from "@/components/ui/manager-icons";
import KitchenAvailabilityManagement, { type KitchenAvailabilityManagementHandle } from '@/pages/KitchenAvailabilityManagement';
import { BookingRulesSettings, type BookingPoliciesHandle } from "@/components/manager/settings";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { FormLegend } from "@/components/ui/form-legend";
import { useScrollToTopOnChange } from "@/hooks/use-scroll-to-top-on-change";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";

const PART_COUNT = 2;

/**
 * Availability, in two parts.
 *
 * Part A is the weekly schedule. Part B is the booking policies — split out for
 * the same reason the Business step is split: they are separate decisions, and
 * putting cancellation windows and notice periods on the same screen as the
 * schedule buries them. Managers rarely go looking for these on their own, so
 * onboarding is where they need to meet them.
 *
 * The policies surface is the dashboard's own `BookingRulesSettings`, embedded
 * rather than reimplemented, so the two can never disagree about what a rule
 * means. Arrival timings are suppressed: that window belongs to the
 * check-in/check-out page, and a manager only needs to know here that the
 * check-in/check-out checklists exist.
 */
const AvailabilityStep = () => {
    const {
        selectedLocationId,
        selectedKitchenId,
        selectedLocation,
        handleNext,
        handleBack,
        isFirstStep,
        refreshAvailability,
        hasAvailability,
        hasUnsavedChanges,
        setUnsavedChanges,
        registerStepSave,
        saveAndExit,
        isSubmitting,
    } = useManagerOnboarding();
    const availabilityRef = useRef<KitchenAvailabilityManagementHandle>(null);
    const bookingPoliciesRef = useRef<BookingPoliciesHandle>(null);
    const [activePart, setActivePart] = useState(0);
    const [isSaving, setIsSaving] = useState(false);
    const [bookingPoliciesDirty, setBookingPoliciesDirty] = useState(false);
    // Continuing to a shorter part used to leave you mid-page.
    const scrollRef = useScrollToTopOnChange(activePart);

    // The wizard's guard has to speak for both parts, not just the schedule.
    useEffect(() => {
        setUnsavedChanges(hasUnsavedChanges || bookingPoliciesDirty);
    }, [hasUnsavedChanges, bookingPoliciesDirty, setUnsavedChanges]);

    // "Save changes" from the leave dialog persists whichever part is dirty.
    useEffect(() => {
        registerStepSave(async () => {
            if (bookingPoliciesDirty) {
                const savedPolicies = await bookingPoliciesRef.current?.saveAllChanges();
                if (!savedPolicies) return false;
            }
            return (await availabilityRef.current?.saveAllChanges()) ?? true;
        });
        return () => registerStepSave(null);
    }, [registerStepSave, bookingPoliciesDirty]);

    /** Persist booking rules for this location — same endpoint the dashboard uses. */
    const saveBookingRules = async (updates: Record<string, unknown>) => {
        if (!selectedLocationId) throw new Error(mt("pleaseCreateALocationFirst"));
        const token = await auth.currentUser?.getIdToken();
        const response = await fetch(`/api/manager/locations/${selectedLocationId}/cancellation-policy`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ ...updates, locationId: selectedLocationId }),
        });
        if (!response.ok) {
            let message = mt("error");
            try {
                const body = await response.json();
                message = body.error || body.message || message;
            } catch {
                // Non-JSON error body; the status is all we have.
                message = `${response.status} ${response.statusText}`;
            }
            throw new Error(message);
        }
        return response.json();
    };

    const partIsDirty = activePart === 0 ? hasUnsavedChanges : bookingPoliciesDirty;

    /** Persist this part (only if it changed), then move on. */
    const handleContinue = async () => {
        if (activePart < PART_COUNT - 1) {
            if (hasUnsavedChanges) {
                setIsSaving(true);
                try {
                    const saved = await availabilityRef.current?.saveWeeklySchedule();
                    if (!saved) return;
                } finally {
                    setIsSaving(false);
                }
            }
            setActivePart(1);
            return;
        }

        // Final part — flush the policies, then let the wizard advance.
        if (bookingPoliciesDirty) {
            setIsSaving(true);
            try {
                const saved = await bookingPoliciesRef.current?.saveAllChanges();
                if (!saved) return;
            } finally {
                setIsSaving(false);
            }
        }
        await handleNext();
    };

    const handlePartBack = () => {
        if (activePart === 0) {
            handleBack();
            return;
        }
        setActivePart(0);
    };

    const partHeading = [
        { title: mt("availabilityPartScheduleTitle"), description: mt("availabilityPartScheduleDesc") },
        { title: mt("availabilityPartPoliciesTitle"), description: mt("availabilityPartPoliciesDesc") },
    ][activePart];

    return (
        <div ref={scrollRef} className="space-y-6 animate-in fade-in duration-500">
            {/* Part progress — the same segmented dots the Business step uses, so
                the two multi-part steps read identically. */}
            <div className="flex items-center gap-3">
                <div
                    className="flex items-center gap-1.5"
                    role="group"
                    aria-label={mt("businessStepProgress", { current: activePart + 1, total: PART_COUNT })}
                >
                    {Array.from({ length: PART_COUNT }, (_, index) => (
                        <span
                            key={index}
                            aria-hidden
                            className={cn(
                                "h-1.5 rounded-full transition-all duration-300",
                                index === activePart
                                    ? "w-6 bg-primary"
                                    : index < activePart
                                        ? "w-1.5 bg-primary/50"
                                        : "w-1.5 bg-muted-foreground/25",
                            )}
                        />
                    ))}
                </div>
                <span className="text-xs text-muted-foreground">
                    {mt("businessStepProgress", { current: activePart + 1, total: PART_COUNT })}
                </span>
            </div>

            <div className="space-y-1">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">{partHeading.title}</h2>
                <p className="text-sm text-muted-foreground">{partHeading.description}</p>
            </div>

            <FormLegend />

            {activePart === 0 && (
                <>
                    {/* Status line — what this part still needs */}
                    <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
                        {hasAvailability ? (
                            <CheckCircle className="mt-px h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                            <Calendar className="mt-px h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <p className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                                {hasAvailability ? mt("availabilitySaved") : mt("setYourAvailability")}
                            </span>
                            {` — ${hasAvailability ? mt("modifyBelowOrContinue") : mt("saveScheduleToContinue")}`}
                        </p>
                    </div>

                    {/* Availability Management — brings its own cards */}
                    {selectedLocationId ? (
                        <KitchenAvailabilityManagement
                            ref={availabilityRef}
                            embedded={true}
                            initialLocationId={selectedLocationId}
                            initialKitchenId={selectedKitchenId || undefined}
                            onSaveSuccess={refreshAvailability}
                            hideWeeklyScheduleSaveButton={true}
                            onDirtyChange={setUnsavedChanges}
                        />
                    ) : (
                        <p className="py-8 text-center text-sm text-muted-foreground">{mt("pleaseCreateALocationFirst")}</p>
                    )}
                </>
            )}

            {activePart === 1 && (
                <>
                    {/*
                     * Awareness, not configuration. The arrival window and the
                     * checklist itself are set on the check-in/check-out page;
                     * duplicating those fields here would raise the question of
                     * which one wins. What a manager needs mid-setup is to know
                     * the option exists.
                     */}
                    <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
                        <ClipboardCheck className="mt-px h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                            <p className="text-xs font-medium text-foreground">
                                {mt("availabilityChecklistNoticeTitle")}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                {mt("availabilityChecklistNoticeDesc")}
                            </p>
                        </div>
                    </div>

                    {selectedLocation ? (
                        <BookingRulesSettings
                            ref={bookingPoliciesRef}
                            location={selectedLocation}
                            onSave={saveBookingRules}
                            onDirtyChange={setBookingPoliciesDirty}
                            hideArrivalTimings
                            hideTerms
                        />
                    ) : (
                        <p className="py-8 text-center text-sm text-muted-foreground">{mt("pleaseCreateALocationFirst")}</p>
                    )}
                </>
            )}

            <OnboardingNavigationFooter
                onNext={() => void handleContinue()}
                onBack={handlePartBack}
                onSaveAndExit={() => void saveAndExit()}
                isSavingAndExiting={isSubmitting}
                showBack={!isFirstStep || activePart > 0}
                nextLabel={partIsDirty ? mt("saveAndContinue") : tt("continue")}
                isNextDisabled={
                    isSaving ||
                    isSubmitting ||
                    // Part A needs a kitchen to schedule against; part B works off
                    // the location, which part A already required.
                    (activePart === 0 && !selectedKitchenId)
                }
                isLoading={isSaving}
            />
        </div>
    );
};

export default AvailabilityStep;
