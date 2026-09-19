import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useManagerOnboarding } from "@/components/manager/onboarding/ManagerOnboardingContext";
import { componentRegistry } from "@/config/onboarding";
import EnterpriseStepper from "@/components/manager/onboarding/EnterpriseStepper";
import { Button } from "@/components/ui/button";
import { ChevronRight, Home, HelpCircle, Loader2 } from "@/components/ui/manager-icons";
import { useLocation } from "wouter";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { UnsavedChangesDialog } from "@/components/manager/UnsavedChangesDialog";
import { mt } from "@/i18n/manager";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SmartImage } from "@/components/ui/smart-image";
import { resolveImageUrl } from "@/lib/resolve-image-url";

export default function ManagerSetupPage() {
    return (
        <TooltipProvider>
            <ManagerSetupPageContent />
        </TooltipProvider>
    );
}

/**
 * Setup wizard frame: a quiet sidebar, a breadcrumb bar with the exit action, and
 * the current step's own cards. The page adds a heading and nothing else — the
 * steps bring their own surfaces, so a wrapper card here would nest boxes.
 */
function ManagerSetupPageContent() {
    const { t } = useTranslation(["chef", "manager"]);
    const {
        currentStepData,
        currentStepIndex,
        hasUnsavedChanges,
        pendingLeave,
        clearPendingLeave,
        saveAndLeave,
        discardAndLeave,
        isSavingBeforeLeave,
        locationForm,
        selectedLocation,
    } = useManagerOnboarding();

    const [, setLocation] = useLocation();
    // Points at ScrollArea's viewport (not its Root — the Root is overflow-hidden),
    // so we can reset scroll position when the step changes.
    const contentRef = useRef<HTMLDivElement>(null);
    const prevStepIndex = useRef(currentStepIndex);

    /**
     * The business being set up, shown on every step.
     *
     * The draft wins over the saved record so this doubles as a live preview:
     * type the name in part 1 of the Business step and it appears up here at
     * once. Read-only by design — the field itself stays the single place to
     * edit it, so there is never a second source of truth.
     */
    const businessName = locationForm?.name || selectedLocation?.name || "";
    const businessLogo = locationForm?.logoUrl || selectedLocation?.logoUrl || "";
    const businessInitials = businessName
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0])
        .join("")
        .toUpperCase();

    // Scroll to top when step changes
    useEffect(() => {
        if (prevStepIndex.current !== currentStepIndex && contentRef.current) {
            contentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
        prevStepIndex.current = currentStepIndex;
    }, [currentStepIndex]);

    // Cover browser refresh / tab close, which the in-app guard cannot intercept.
    useEffect(() => {
        if (!hasUnsavedChanges) return;
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [hasUnsavedChanges]);

    // Get the component for the current step
    const StepComponent = currentStepData?.componentKey
        ? componentRegistry[currentStepData.componentKey as keyof typeof componentRegistry]
        : null;

    return (
        <div className="min-h-screen w-full bg-background flex overflow-hidden">
            {/* Left Sidebar */}
            <aside className="hidden lg:flex w-80 border-r border-border bg-background z-20 flex-col h-screen">
                <EnterpriseStepper />
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
                {/* Top Bar */}
                <header className="h-16 border-b border-border bg-background/85 backdrop-blur-md flex items-center justify-between px-6 flex-shrink-0 z-10">
                    <div className="flex items-center gap-4">
                        {/* Mobile Title */}
                        <div className="md:hidden flex items-center gap-2">
                            <span className="text-foreground font-semibold text-sm truncate max-w-[150px]">
                                {currentStepData?.title || t("managerSetupSetup")}
                            </span>
                        </div>
                        {/* Desktop Breadcrumb */}
                        <nav className="hidden md:flex items-center gap-2 text-sm">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button 
                                        onClick={() => setLocation('/manager/dashboard')}
                                        aria-label={t("dashboard", { ns: "common" })}
                                        className="text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        <Home className="w-4 h-4" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent>{t("dashboard", { ns: "common" })}</TooltipContent>
                            </Tooltip>
                            <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
                            <span className="font-medium text-muted-foreground">{t("managerSetupWizard")}</span>
                            {/*
                             * No step crumb on the welcome step. It would read
                             * "Setup Wizard › Welcome" on a page the manager reaches straight
                             * after the manager welcome screen — the same redundancy the
                             * heading block below skips this step for.
                             */}
                            {currentStepData?.componentKey !== 'welcome' && (
                                <>
                                    <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
                                    <span className="text-foreground font-medium">
                                        {currentStepData?.title || t("loading", { ns: "common" })}
                                    </span>
                                </>
                            )}
                        </nav>
                    </div>

                    {/*
                     * No "Save & exit" here anymore — the step footer owns that
                     * action now, so the top bar keeps only the breadcrumb and
                     * help. Duplicating it left two save affordances per screen.
                     */}
                    <div className="flex items-center gap-3">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={t("managerSetupNeedHelp")}
                                    className="text-muted-foreground hover:text-foreground"
                                >
                                    <HelpCircle className="w-5 h-5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t("managerSetupNeedHelp")}</TooltipContent>
                        </Tooltip>
                    </div>
                </header>

                {/*
                 * Content container. Uses the shared ScrollArea so long steps
                 * get the same top fade + bottom fade/chevron as the
                 * notification dropdown, instead of a bare scrollbar.
                 */}
                <ScrollArea viewportRef={contentRef} className="flex-1">
                    <div className="p-6 md:p-10 lg:p-12">
                        <div className="max-w-3xl mx-auto w-full">
                            {/*
                             * Step heading. The welcome step is skipped: it
                             * renders its own eyebrow + headline, and showing
                             * "Welcome / Learn about the setup process" above
                             * that repeated the same idea twice.
                             */}
                            {currentStepData?.componentKey !== 'welcome' && (
                                <div className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                                    <div className="min-w-0">
                                        <h1 className="text-xl font-semibold tracking-tight text-foreground">
                                            {currentStepData?.title || t("managerSetupSetup")}
                                        </h1>
                                        {currentStepData?.description && (
                                            <p className="mt-1 text-sm text-muted-foreground">
                                                {currentStepData.description}
                                            </p>
                                        )}
                                    </div>

                                    {/*
                                     * The business being configured, sitting beside
                                     * the step heading. It belongs to the content
                                     * column rather than the top bar, so it is
                                     * present on every step without competing for
                                     * room with the chrome's own actions.
                                     */}
                                    {(businessName || businessLogo) && (
                                        <div className="flex shrink-0 items-center gap-2.5 rounded-full border border-border bg-muted/40 py-1 pl-1 pr-3">
                                            <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background">
                                                {businessLogo ? (
                                                    <SmartImage
                                                        src={resolveImageUrl(businessLogo) ?? undefined}
                                                        alt=""
                                                        className="h-full w-full object-cover"
                                                        hideOnError
                                                    />
                                                ) : (
                                                    <span aria-hidden className="text-[11px] font-semibold text-muted-foreground">
                                                        {businessInitials}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="max-w-[10rem] truncate text-sm font-medium text-foreground">
                                                {businessName || t("manager:managerSetupYourBusiness")}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {StepComponent ? (
                                <StepComponent />
                            ) : (
                                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                                    <Loader2 className="w-6 h-6 animate-spin" />
                                    <p className="mt-3 text-sm font-medium">{t("managerSetupLoadingStep")}</p>
                                </div>
                            )}

                            {/* Bottom Spacer for better scroll experience */}
                            <div className="h-12" />
                        </div>
                    </div>
                </ScrollArea>
            </main>

            {/* The same confirmation the dashboard's settings tabs use. */}
            <UnsavedChangesDialog
                open={pendingLeave !== null}
                onOpenChange={(open) => !open && clearPendingLeave()}
                description={mt("onboardingUnsavedChangesDescription")}
                isSaving={isSavingBeforeLeave}
                onDiscard={discardAndLeave}
                onSave={saveAndLeave}
            />
        </div>
    );
}
