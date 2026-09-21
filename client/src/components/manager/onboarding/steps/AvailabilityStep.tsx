import { useEffect, useRef, useState } from 'react';
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import i18n from "@/i18n";
import { CheckCircle, Calendar, ClipboardCheck } from "@/components/ui/manager-icons";
import KitchenAvailabilityManagement, { type KitchenAvailabilityManagementHandle } from '@/pages/KitchenAvailabilityManagement';
import { BookingRulesSettings, type BookingPoliciesHandle } from "@/components/manager/settings";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { getDocumentFilename, truncateFilename } from "@/lib/formatters";
import { FormLegend } from "@/components/ui/form-legend";
import { useScrollToTopOnChange } from "@/hooks/use-scroll-to-top-on-change";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";
import { StepSummary } from "../StepSummary";
import { useStepParts } from "../use-step-parts";

const PART_COUNT = 2;

/**
 * The review, on its own after the two parts.
 *
 * Not a third PART — the work is two things, so the dots stay at two. A manager coming
 * back to a finished Availability step sees the week they set and the policies they chose
 * on one screen, each with an Edit that goes to the part that owns it, instead of being
 * walked through both forms again.
 */
const SUMMARY_PART = PART_COUNT;

/** A stored `HH:mm` as the manager's own clock reads it. */
function formatClock(value: string): string {
    const [hours, minutes] = value.split(':').map(Number);
    if (Number.isNaN(hours)) return value;
    return new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' })
        .format(new Date(2023, 0, 1, hours, Number.isNaN(minutes) ? 0 : minutes));
}

/**
 * A weekday name for a `0 = Sunday` index.
 *
 * Derived rather than listed: the app already hardcodes an English day array on the
 * availability page, and a second hand-written list is one more thing to keep in step.
 * 1 January 2023 was a Sunday, so the index lines up with the calendar's own numbering.
 */
function formatWeekday(dayOfWeek: number): string {
    return new Intl.DateTimeFormat(i18n.language, { weekday: 'long' }).format(new Date(2023, 0, 1 + dayOfWeek));
}

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
        availabilityLoaded,
        hasUnsavedChanges,
        setUnsavedChanges,
        registerStepSave,
        saveAndExit,
        isSubmitting,
    } = useManagerOnboarding();
    const availabilityRef = useRef<KitchenAvailabilityManagementHandle>(null);
    const bookingPoliciesRef = useRef<BookingPoliciesHandle>(null);
    /**
     * A finished Availability step opens on its review. `availabilityLoaded` — not
     * `hasAvailability` — is the readiness signal: the flag is false until the fetch lands,
     * so deciding on it would open every revisit at part 0 and never reach the review. The
     * decision latches, so saving a schedule for the first time does not throw the manager
     * onto the review before they have seen the policies.
     */
    const { activePart, isSummary, editPart, goNext, goBack } = useStepParts({
        // `availabilityLoaded` — not `hasAvailability` — is the readiness signal: the flag is
        // false until the fetch lands, so deciding on it would open every revisit at part 0
        // and never reach the review.
        isComplete: Boolean(hasAvailability),
        isReady: Boolean(availabilityLoaded),
        partCount: PART_COUNT,
    });
    const [isSaving, setIsSaving] = useState(false);
    const [bookingPoliciesDirty, setBookingPoliciesDirty] = useState(false);
    // Continuing to a shorter part used to leave you mid-page.
    const scrollRef = useScrollToTopOnChange(activePart);

    /**
     * What the review shows: the days that are open, and the dated exceptions.
     *
     * Read on the review rather than once at mount, so it reflects a schedule the manager
     * has just edited. The context keeps only a boolean, so this is its own pair of reads.
     */
    const [openDays, setOpenDays] = useState<{ dayOfWeek: number; startTime: string; endTime: string }[]>([]);
    const [exceptionCount, setExceptionCount] = useState(0);
    useEffect(() => {
        if (activePart !== SUMMARY_PART || !selectedKitchenId) return;
        let cancelled = false;
        void (async () => {
            const token = await auth.currentUser?.getIdToken();
            if (!token) return;
            const headers = { Authorization: `Bearer ${token}` };
            const [availabilityRes, overridesRes] = await Promise.all([
                fetch(`/api/manager/availability/${selectedKitchenId}`, { headers }),
                fetch(`/api/manager/kitchens/${selectedKitchenId}/date-overrides`, { headers }),
            ]);
            if (cancelled) return;
            if (availabilityRes.ok) {
                const rows = await availabilityRes.json();
                setOpenDays((Array.isArray(rows) ? rows : [])
                    .filter((row: any) => row.isAvailable ?? row.is_available)
                    .map((row: any) => ({
                        dayOfWeek: row.dayOfWeek ?? row.day_of_week,
                        startTime: row.startTime ?? row.start_time ?? "",
                        endTime: row.endTime ?? row.end_time ?? "",
                    }))
                    .sort((a: any, b: any) => a.dayOfWeek - b.dayOfWeek));
            }
            if (overridesRes.ok) {
                const rows = await overridesRes.json();
                setExceptionCount(Array.isArray(rows) ? rows.length : 0);
            }
        })();
        return () => { cancelled = true; };
    }, [activePart, selectedKitchenId]);

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
        // The review is the last screen; only IT moves the wizard on.
        if (isSummary) {
            await handleNext();
            return;
        }

        setIsSaving(true);
        try {
            if (activePart === 0 && hasUnsavedChanges) {
                const saved = await availabilityRef.current?.saveWeeklySchedule();
                if (!saved) return;
            }
            if (activePart === 1 && bookingPoliciesDirty) {
                const saved = await bookingPoliciesRef.current?.saveAllChanges();
                if (!saved) return;
            }
        } finally {
            setIsSaving(false);
        }

        goNext();
    };

    const handlePartBack = () => {
        if (goBack()) return;
        handleBack();
    };

    const partHeading = [
        { title: mt("availabilityPartScheduleTitle"), description: mt("availabilityPartScheduleDesc") },
        { title: mt("availabilityPartPoliciesTitle"), description: mt("availabilityPartPoliciesDesc") },
        { title: mt("availabilitySummaryTitle"), description: mt("availabilitySummaryDesc") },
    ][activePart];

    /**
     * The review. The week the manager set, read back as days and hours, plus the dated
     * exceptions and the policies — everything the two parts produce, on one screen, each
     * with an Edit that goes back to the part that owns it.
     */
    const scheduleRows = openDays.length > 0
        ? openDays.map((day) => ({
            key: `day-${day.dayOfWeek}`,
            label: formatWeekday(day.dayOfWeek),
            value: day.startTime && day.endTime
                ? `${formatClock(day.startTime)} – ${formatClock(day.endTime)}`
                : mt("availabilitySummaryAllDay"),
        }))
        : [{
            key: "schedule-empty",
            value: mt("notSet"),
        }];

    /**
     * The terms document on file. It is uploaded in part 2 now, having moved out of the Business
     * step, so the review has to name it — otherwise a manager uploads it and never sees it again.
     */
    const termsUrl = selectedLocation?.kitchenTermsUrl || (selectedLocation as any)?.kitchen_terms_url || null;

    const policyValues = [
        selectedLocation?.cancellationPolicyHours != null
            ? mt("availabilitySummaryCancellation", { hours: selectedLocation.cancellationPolicyHours })
            : null,
        selectedLocation?.defaultDailyBookingLimit != null
            ? mt("availabilitySummaryDailyLimit", { count: selectedLocation.defaultDailyBookingLimit })
            : null,
        selectedLocation?.minimumBookingWindowHours != null
            ? mt("availabilitySummaryNotice", { hours: selectedLocation.minimumBookingWindowHours })
            : null,
    ].filter(Boolean);

    /**
     * The review, grouped by the step's own two parts: one group per part, one Edit per group.
     *
     * The week is up to seven rows. Giving each one its own Edit put eight buttons on a
     * screen with two parts, which reads as eight things to fix rather than "here is what
     * you set, and here is how to change it".
     */
    const summarySections = [
        {
            key: "schedule",
            title: mt("availabilitySectionSchedule"),
            part: 0,
            rows: [
                ...scheduleRows,
                {
                    key: "exceptions",
                    label: mt("availabilitySummaryExceptions"),
                    value: exceptionCount > 0
                        ? mt("availabilitySummaryExceptionCount", { count: exceptionCount })
                        : mt("availabilitySummaryNoExceptions"),
                },
            ],
        },
        {
            key: "policies",
            title: mt("availabilitySummaryPolicies"),
            part: 1,
            rows: [
                // The group's title is the row's label — no need to say it twice.
                {
                    key: "values",
                    value: policyValues.length > 0 ? policyValues.join(" · ") : mt("notSet"),
                },
                // The terms document is collected in this part now, having moved out of the
                // Business step, so the review has to name it — otherwise a manager uploads it
                // and never sees it again before finishing.
                {
                    key: "terms",
                    // Nothing on file is a valid answer here, so say so rather than let a blank
                    // row read as something the manager forgot.
                    label: termsUrl ? mt("termsPolicies") : `${mt("termsPolicies")} (${mt("optional")})`,
                    value: termsUrl
                        ? (truncateFilename(getDocumentFilename(termsUrl)) || mt("termsOnFile"))
                        : mt("notSet"),
                },
            ],
        },
    ];

    return (
        <div ref={scrollRef} className="space-y-6 animate-in fade-in duration-500">
            {/* Part progress — the same segmented dots the Business step uses, so
                the two multi-part steps read identically. */}
            <div className="flex items-center gap-3">
                <div
                    className="flex items-center gap-1.5"
                    role="group"
                    aria-label={mt("businessStepProgress", { current: Math.min(activePart + 1, PART_COUNT), total: PART_COUNT })}
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
                    {mt("businessStepProgress", { current: Math.min(activePart + 1, PART_COUNT), total: PART_COUNT })}
                </span>
            </div>

            <div className="space-y-1">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">{partHeading.title}</h2>
                <p className="text-sm text-muted-foreground">{partHeading.description}</p>
            </div>

            {/* Not on the review: nothing there is a field, so nothing there can be required. */}
            {!isSummary && <FormLegend />}

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

                    {/*
                     * Why this part is required, and where to come back to.
                     *
                     * Availability is per-KITCHEN and a kitchen with no opening hours cannot be
                     * listed — the publish review blocks it. The manager should hear that here,
                     * where they can act on it, rather than discovering it at the publish attempt.
                     * The same notice shape as the check-in/check-out note in part 2, and the same
                     * "My Kitchens > X on your dashboard" wording, so the two read as one voice.
                     */}
                    <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
                        <Calendar className="mt-px h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                            <p className="text-xs font-medium text-foreground">
                                {mt("availabilityRequiredNoticeTitle")}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                {mt("availabilityRequiredNoticeDesc")}
                            </p>
                        </div>
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
                            /*
                             * The terms document is OPTIONAL and the step must say so: it used to be
                             * collected in the Business step, where it was required, so a manager who
                             * leaves it blank here needs to know that is allowed and where to come
                             * back to it. The names come from the sidebar's own keys, so this
                             * sentence follows if those are ever renamed.
                             */
                            termsNote={mt("termsOptionalNote", {
                                spaces: mt("navSpaces"),
                                policies: mt("navBookingRules"),
                            })}
                            hideArrivalTimings
                            /*
                             * Terms & Policies is NOT hidden here. It used to be collected in the
                             * Business step's last part; it belongs with the booking policies, and
                             * this is the dashboard's own component, so un-hiding it means the
                             * manager meets one implementation in both places.
                             */
                        />
                    ) : (
                        <p className="py-8 text-center text-sm text-muted-foreground">{mt("pleaseCreateALocationFirst")}</p>
                    )}
                </>
            )}

            {/* ------------------------------------------------------------ Review */}
            {isSummary && (
                <StepSummary
                    sections={summarySections}
                    onEdit={editPart}
                    noteTitle={mt("availabilityRecapTitle")}
                    noteBody={mt("availabilityRecapBody")}
                />
            )}

            <OnboardingNavigationFooter
                onNext={() => void handleContinue()}
                onBack={handlePartBack}
                onSaveAndExit={() => void saveAndExit()}
                isSavingAndExiting={isSubmitting}
                /* No Back on the review: each group's Edit already opens the part it names,
                   and a Back button beside them is a second route to the same place. */
                showBack={!isSummary && (!isFirstStep || activePart > 0)}
                hasUnsavedWork={partIsDirty}
                nextLabel={partIsDirty ? mt("saveAndContinue") : tt("continue")}
                isNextDisabled={
                    isSaving ||
                    isSubmitting ||
                    // Part A needs a kitchen to schedule against; part B works off
                    // the location, which part A already required. The review is never
                    // gated — it is only reachable once both parts have been saved.
                    (!isSummary && activePart === 0 && !selectedKitchenId)
                }
                isLoading={isSaving}
            />
        </div>
    );
};

export default AvailabilityStep;
