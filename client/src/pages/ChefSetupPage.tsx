import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { OnboardingProvider } from "@onboardjs/react";
import { ChefOnboardingProvider, useChefOnboarding } from "@/components/chef/onboarding/ChefOnboardingContext";
import { ChefStepper } from "@/components/chef/onboarding/ChefStepper";
import {
  BrowseKitchensStep,
  CompletionStep,
  LocalCooksApplicationStep,
  PathSelectionStep,
  SummaryStep,
  TrainingStep,
  WelcomeStep,
} from "@/components/chef/onboarding/ChefOnboardingSteps";
import { BrandName, withBrandName } from "@/components/chef/onboarding/BrandName";
import { chefOnboardingSteps } from "@/config/chef-onboarding-steps";
import { Button } from "@/components/ui/button";
import Logo from "@/components/ui/logo";
import { useFirebaseAuth } from "@/hooks/use-auth";
import TidioController, { useTidioChat } from "@/components/chat/TidioController";
import { ArrowRight, HelpCircle, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

function ChefSetupContent() {
  const [, navigate] = useLocation();
  const { t } = useTranslation("chef");
  const { user, logout } = useFirebaseAuth();
  const { openChat } = useTidioChat();
  const {
    currentStepData,
    currentStepIndex,
    isFirstStep,
    isLastStep,
    handleNext,
    handleBack,
    visibleSteps,
    selectedPaths,
    togglePath,
    hasSellerApplication,
    hasKitchenApplications,
    kitchenApplicationsCount,
    hasCompletedTraining,
    finishOnboarding,
  } = useChefOnboarding();

  const currentStepId = String(visibleSteps[currentStepIndex]?.id ?? "");
  const currentMeta = visibleSteps[currentStepIndex]?.metadata;
  const stepCount = visibleSteps.length;
  const isLastContentStep = currentStepId === "completion";

  const footer = useMemo(() => {
    const skipLabel = currentMeta?.skipLabel ?? t("chefSetupContinueForNow");

    switch (currentStepId) {
      case "welcome":
        return {
          primaryLabel: currentMeta?.ctaLabel ?? t("chefSetupGetStarted"),
          onPrimary: handleNext,
          disabled: false,
          showSkip: false,
          skipLabel,
          hint: null as string | null,
        };
      case "path-selection":
        return {
          primaryLabel: currentMeta?.ctaLabel ?? t("chefSetupSaveAndContinue"),
          onPrimary: handleNext,
          disabled: selectedPaths.length === 0,
          showSkip: false,
          skipLabel,
          hint: selectedPaths.length === 0 ? t("chefSetupSelectAtLeastOneOption") : null,
        };
      case "localcooks-application":
        if (hasSellerApplication) {
          return {
            primaryLabel: t("chefSetupSaveAndContinue"),
            onPrimary: handleNext,
            disabled: false,
            showSkip: false,
            skipLabel,
            hint: null,
          };
        }
        return {
          primaryLabel: currentMeta?.ctaLabel ?? t("chefSetupStartApplication"),
          onPrimary: () => navigate("/dashboard?view=applications&action=new"),
          disabled: false,
          showSkip: true,
          skipLabel,
          hint: t("chefSetupFinishApplicationLater"),
        };
      case "food-safety-training":
        if (hasCompletedTraining) {
          return {
            primaryLabel: t("chefSetupSaveAndContinue"),
            onPrimary: handleNext,
            disabled: false,
            showSkip: false,
            skipLabel,
            hint: null,
          };
        }
        return {
          primaryLabel: currentMeta?.ctaLabel ?? t("chefSetupStartTraining"),
          onPrimary: () => navigate("/dashboard?view=training"),
          disabled: false,
          showSkip: true,
          skipLabel,
          hint: t("chefSetupWatchVideosLater"),
        };
      case "browse-kitchens":
        if (hasKitchenApplications) {
          return {
            primaryLabel: t("chefSetupSaveAndContinue"),
            onPrimary: handleNext,
            disabled: false,
            showSkip: false,
            skipLabel,
            hint: null,
          };
        }
        return {
          primaryLabel: currentMeta?.ctaLabel ?? t("chefSetupBrowseKitchens"),
          onPrimary: () => navigate("/compare-kitchens"),
          disabled: false,
          showSkip: true,
          skipLabel,
          hint: t("chefSetupBrowseKitchensLater"),
        };
      case "summary":
        return {
          primaryLabel: currentMeta?.ctaLabel ?? t("chefSetupFinishSetup"),
          onPrimary: handleNext,
          disabled: false,
          showSkip: false,
          skipLabel,
          hint: null,
        };
      case "completion":
        return {
          primaryLabel: currentMeta?.ctaLabel ?? t("chefSetupGoToDashboard"),
          onPrimary: async () => {
            try {
              await finishOnboarding();
            } finally {
              navigate("/dashboard");
            }
          },
          disabled: false,
          showSkip: false,
          skipLabel,
          hint: null,
        };
      default:
        return {
          primaryLabel: t("chefSetupSaveAndContinue"),
          onPrimary: handleNext,
          disabled: false,
          showSkip: false,
          skipLabel,
          hint: null,
        };
    }
  }, [
    currentStepId,
    currentMeta,
    handleNext,
    selectedPaths.length,
    hasSellerApplication,
    hasCompletedTraining,
    hasKitchenApplications,
    finishOnboarding,
    navigate,
  ]);

  const renderStepContent = () => {
    switch (currentStepId) {
      case "welcome":
        return <WelcomeStep />;
      case "path-selection":
        return (
          <PathSelectionStep
            selectedPaths={selectedPaths}
            togglePath={togglePath}
          />
        );
      case "localcooks-application":
        return <LocalCooksApplicationStep hasApplication={hasSellerApplication} />;
      case "food-safety-training":
        return <TrainingStep hasCompleted={hasCompletedTraining} />;
      case "summary":
        return <SummaryStep />;
      case "browse-kitchens":
        return (
          <BrowseKitchensStep
            hasApplications={hasKitchenApplications}
            applicationsCount={kitchenApplicationsCount}
          />
        );
      case "completion":
        return <CompletionStep selectedPaths={selectedPaths} />;
      default:
        return (
          <div className="py-12">
            <p className="text-muted-foreground">{t("chefSetupLoadingStep")}</p>
          </div>
        );
    }
  };

  const stepEyebrow = isLastContentStep
    ? t("chefSetupLastStep")
    : t("chefSetupStepProgress", { current: currentStepIndex + 1, total: stepCount });

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <TidioController
        userEmail={user?.email || undefined}
        userName={user?.displayName || undefined}
        userId={user?.uid}
      />
      <header className="h-14 shrink-0 border-b bg-background flex items-center justify-between px-4 lg:px-8">
        <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <Logo variant="white" className="w-5 h-5" />
          </div>
          <BrandName className="text-lg leading-none text-primary hidden sm:inline" />
        </Link>

        <div className="flex items-center gap-1 sm:gap-3 text-sm">
          <button
            type="button"
            onClick={openChat}
            aria-label={t("chefSetupHelpAssistance")}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <HelpCircle className="h-4 w-4" />
            <span className="hidden sm:inline">{t("chefSetupHelpAssistance")}</span>
          </button>
          {user?.email && (
            <span className="hidden md:inline text-muted-foreground truncate max-w-[220px]">
              {user.email}
            </span>
          )}
          <button
            type="button"
            onClick={() => logout()}
            aria-label={t("logout", { ns: "common" })}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">{t("logout", { ns: "common" })}</span>
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="hidden lg:flex w-[340px] xl:w-[380px] flex-col border-r bg-[#F7F7F8]">
          <div className="flex-1 overflow-auto pt-10">
            <ChefStepper />
          </div>
          <div className="p-6">
            <Button variant="ghost" className="w-full justify-start text-muted-foreground" asChild>
              <Link href="/dashboard">{t("chefSetupBackToDashboard")}</Link>
            </Button>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0 bg-background">
          <header className="lg:hidden border-b">
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-primary">
                {stepEyebrow}
              </p>
              <span className="text-sm text-muted-foreground">
                {currentMeta?.label}
              </span>
            </div>
            <div className="h-1 bg-muted">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${stepCount ? ((currentStepIndex + 1) / stepCount) * 100 : 0}%` }}
              />
            </div>
          </header>

          <main className="flex-1 overflow-auto">
            <div className="max-w-[640px] mx-auto px-5 py-8 lg:px-12 lg:py-12">
              <div className="mb-8">
                <p className="hidden lg:block text-xs font-semibold uppercase tracking-[0.16em] text-primary mb-3">
                  {stepEyebrow}
                </p>
                <h1 className="text-[32px] lg:text-[36px] font-semibold tracking-tight leading-tight text-foreground">
                  {currentStepData?.title
                    ? withBrandName(currentStepData.title, "text-primary")
                    : t("chefSetupSetup")}
                </h1>
                {currentStepData?.description && (
                  <p className="text-[15px] text-muted-foreground mt-3 leading-relaxed max-w-[540px]">
                    {withBrandName(currentStepData.description, "text-primary")}
                  </p>
                )}
              </div>

              <div className="animate-in fade-in slide-in-from-right-3 duration-300">
                {renderStepContent()}
              </div>
            </div>
          </main>

          <footer className="shrink-0 border-t bg-background px-5 py-4 lg:px-12 lg:py-5">
            <div className="max-w-[640px] mx-auto flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
              {!isFirstStep ? (
                <Button
                  variant="ghost"
                  onClick={handleBack}
                  className="text-muted-foreground"
                >
                  Back
                </Button>
              ) : (
                <div className="hidden sm:block" />
              )}

              <div className="flex flex-col items-stretch sm:items-end gap-2">
                {footer.hint && (
                  <p className="text-xs text-muted-foreground sm:text-right max-w-sm">
                    {footer.hint}
                  </p>
                )}
                <div className="flex items-center justify-end gap-2">
                  {footer.showSkip && !isLastStep && (
                    <Button variant="ghost" onClick={handleNext} className="text-muted-foreground">
                      {footer.skipLabel}
                    </Button>
                  )}
                  <Button
                    onClick={footer.onPrimary}
                    disabled={footer.disabled}
                    size="lg"
                    className={cn(
                      "h-11 px-6 font-semibold shadow-md shadow-primary/20",
                      "disabled:shadow-none"
                    )}
                  >
                    {footer.primaryLabel}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

export default function ChefSetupPage() {
  return (
    <OnboardingProvider steps={chefOnboardingSteps as any}>
      <ChefOnboardingProvider>
        <ChefSetupContent />
      </ChefOnboardingProvider>
    </OnboardingProvider>
  );
}
