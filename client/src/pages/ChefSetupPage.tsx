import { useEffect } from "react";
import { useLocation } from "wouter";
import { OnboardingProvider } from "@onboardjs/react";
import { ChefOnboardingProvider, useChefOnboarding } from "@/components/chef/onboarding/ChefOnboardingContext";
import { ChefStepper } from "@/components/chef/onboarding/ChefStepper";
import { chefOnboardingSteps } from "@/config/chef-onboarding-steps";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import Logo from "@/components/ui/logo";
import { ArrowLeft, ArrowRight, Store, Building, Check, ChefHat, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

function ChefSetupContent() {
  const [, navigate] = useLocation();
  const { user } = useFirebaseAuth();
  const {
    currentStepData,
    currentStepIndex,
    isFirstStep,
    isLastStep,
    handleNext,
    handleBack,
    handleSkip,
    visibleSteps,
    selectedPaths,
    togglePath,
    isLoading,
    hasSellerApplication,
    hasKitchenApplications,
    hasCompletedTraining,
  } = useChefOnboarding();

  // Redirect if not authenticated
  useEffect(() => {
    if (!user) {
      navigate("/auth");
    }
  }, [user, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading your setup...</p>
        </div>
      </div>
    );
  }

  // Render step content based on current step
  const renderStepContent = () => {
    const stepId = visibleSteps[currentStepIndex]?.id;

    switch (stepId) {
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
        return <BrowseKitchensStep hasApplications={hasKitchenApplications} />;
      case "completion":
        return <CompletionStep selectedPaths={selectedPaths} />;
      default:
        return (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Step content loading...</p>
          </div>
        );
    }
  };

  const currentStepMeta = visibleSteps[currentStepIndex]?.metadata;
  const canSkip = currentStepMeta?.canSkip ?? false;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <div className="flex h-screen">
        {/* Left Sidebar - Stepper */}
        <div className="hidden lg:flex w-80 flex-col border-r bg-card/50 backdrop-blur">
          <div className="p-6 border-b">
            <Link href="/dashboard" className="flex items-center gap-3 group">
              <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
                <Logo variant="white" className="w-6 h-6" />
              </div>
              <div>
                <span className="font-lobster text-xl text-primary">LocalCooks</span>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Chef Onboarding
                </p>
              </div>
            </Link>
          </div>
          <div className="flex-1 p-6 overflow-auto">
            <ChefStepper />
          </div>
          <div className="p-6 border-t">
            <Button variant="ghost" className="w-full justify-start" asChild>
              <Link href="/dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Dashboard
              </Link>
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Mobile Header */}
          <header className="lg:hidden flex items-center justify-between p-4 border-b bg-background/95 backdrop-blur">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Logo variant="white" className="w-5 h-5" />
              </div>
              <span className="font-lobster text-lg text-primary">LocalCooks</span>
            </Link>
            <span className="text-sm text-muted-foreground">
              Step {currentStepIndex + 1} of {visibleSteps.length}
            </span>
          </header>

          {/* Step Content */}
          <main className="flex-1 overflow-auto p-6 lg:p-12">
            <div className="max-w-2xl mx-auto">
              {/* Step Header */}
              <div className="mb-8">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                  <span>Step {currentStepIndex + 1}</span>
                  <span>•</span>
                  <span>{visibleSteps.length} total</span>
                </div>
                <h1 className="text-3xl font-bold tracking-tight">
                  {currentStepData?.title || "Setup"}
                </h1>
                <p className="text-muted-foreground mt-2">
                  {currentStepData?.description || "Complete this step to continue"}
                </p>
              </div>

              {/* Step Content */}
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                {renderStepContent()}
              </div>
            </div>
          </main>

          {/* Footer Navigation */}
          <footer className="border-t bg-background/95 backdrop-blur p-4 lg:p-6">
            <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={isFirstStep}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>

              <div className="flex items-center gap-3">
                {canSkip && !isLastStep && (
                  <Button variant="ghost" onClick={handleSkip}>
                    Skip for now
                  </Button>
                )}
                {isLastStep ? (
                  <Button onClick={() => navigate('/dashboard')} className="gap-2">
                    Complete Onboarding
                  </Button>
                ) : (
                  <Button onClick={handleNext} className="gap-2">
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

// Step Components
function WelcomeStep() {
  return (
    <Card className="border-border/50">
      <CardContent className="p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
          <ChefHat className="h-10 w-10 text-primary" />
        </div>
        <h2 className="text-2xl font-bold mb-4">Welcome to LocalCooks!</h2>
        <p className="text-muted-foreground max-w-md mx-auto mb-6">
          We're excited to have you join our community of talented chefs. This setup will help you get started with selling your food or accessing commercial kitchens.
        </p>
        <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto">
          <div className="p-4 bg-primary/5 rounded-lg border border-primary/10">
            <Store className="h-6 w-6 text-primary mx-auto mb-2" />
            <p className="text-sm font-medium">Sell Food</p>
          </div>
          <div className="p-4 bg-blue-500/5 rounded-lg border border-blue-500/10">
            <Building className="h-6 w-6 text-blue-600 mx-auto mb-2" />
            <p className="text-sm font-medium">Book Kitchens</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PathSelectionStep({
  selectedPaths,
  togglePath,
}: {
  selectedPaths: string[];
  togglePath: (path: 'localcooks' | 'kitchen') => void;
}) {
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        Choose what you'd like to do with LocalCooks. You can select one or both options.
      </p>

      <div className="grid gap-4">
        {/* Start Selling on Local Cooks */}
        <button
          onClick={() => togglePath('localcooks')}
          className={cn(
            "p-6 rounded-xl border-2 text-left transition-all",
            selectedPaths.includes('localcooks')
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/50"
          )}
        >
          <div className="flex items-start gap-4">
            <div
              className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center",
                selectedPaths.includes('localcooks')
                  ? "bg-primary text-primary-foreground"
                  : "bg-primary/10 text-primary"
              )}
            >
              <Store className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">Start Selling on Local Cooks</h3>
                {selectedPaths.includes('localcooks') && (
                  <Check className="h-5 w-5 text-primary" />
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Apply to sell your homemade food to customers. We handle delivery, payments, and customer support.
              </p>
            </div>
          </div>
        </button>

        {/* Kitchen Access */}
        <button
          onClick={() => togglePath('kitchen')}
          className={cn(
            "p-6 rounded-xl border-2 text-left transition-all",
            selectedPaths.includes('kitchen')
              ? "border-blue-600 bg-blue-500/5"
              : "border-border hover:border-blue-500/50 hover:bg-muted/50"
          )}
        >
          <div className="flex items-start gap-4">
            <div
              className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center",
                selectedPaths.includes('kitchen')
                  ? "bg-blue-600 text-white"
                  : "bg-blue-500/10 text-blue-600"
              )}
            >
              <Building className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">Access Commercial Kitchens</h3>
                {selectedPaths.includes('kitchen') && (
                  <Check className="h-5 w-5 text-blue-600" />
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Browse and book time at commercial kitchens in your area. Perfect for scaling your food business.
              </p>
            </div>
          </div>
        </button>
      </div>

      {selectedPaths.length === 0 && (
        <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg">
          Please select at least one option to continue.
        </p>
      )}
    </div>
  );
}

function LocalCooksApplicationStep({ hasApplication }: { hasApplication: boolean }) {
  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle>Start Selling on Local Cooks</CardTitle>
        <CardDescription>Submit your application to start selling</CardDescription>
      </CardHeader>
      <CardContent>
        {hasApplication ? (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-3">
              <Check className="h-5 w-5 text-green-600" />
              <div>
                <p className="font-medium text-green-800">Application Submitted</p>
                <p className="text-sm text-green-600">
                  Your application is being reviewed. This includes your documents and certifications.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Submit your application to start selling on Local Cooks. The application includes your personal information, kitchen preferences, and required certifications.
            </p>
            <Button asChild className="w-full">
              <Link href="/dashboard?view=applications&action=new">Start Application</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TrainingStep({ hasCompleted }: { hasCompleted: boolean }) {
  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle>Food Safety Training</CardTitle>
        <CardDescription>Learn about food safety best practices</CardDescription>
      </CardHeader>
      <CardContent>
        {hasCompleted ? (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-3">
              <Check className="h-5 w-5 text-green-600" />
              <div>
                <p className="font-medium text-green-800">Training Completed</p>
                <p className="text-sm text-green-600">
                  You've completed the food safety training modules.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Learn about food safety best practices. This training helps you understand important guidelines for preparing and handling food safely.
            </p>
            <Button asChild className="w-full">
              <Link href="/microlearning/overview">Start Training</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryStep() {
  const {
    selectedPaths,
    hasSellerApplication,
    hasKitchenApplications,
    hasCompletedTraining,
    sellerApplicationStatus,
  } = useChefOnboarding();

  // Build summary items based on selected paths
  // NOTE: This is an INFORMATIVE summary - no items are "required" to complete onboarding
  const summaryItems = [];

  if (selectedPaths.includes('localcooks')) {
    summaryItems.push({
      id: 'application',
      label: 'Seller Application',
      status: hasSellerApplication ? (sellerApplicationStatus === 'approved' ? 'done' : 'in_progress') : 'not_started',
      description: hasSellerApplication 
        ? `Status: ${sellerApplicationStatus === 'approved' ? 'Approved' : sellerApplicationStatus === 'rejected' ? 'Rejected' : 'Under Review'}` 
        : 'You can submit your application anytime from the dashboard',
      actionLabel: hasSellerApplication ? 'View Application' : 'Start Application',
      actionHref: hasSellerApplication ? '/dashboard?view=applications' : '/dashboard?view=applications&action=new',
    });

    summaryItems.push({
      id: 'training',
      label: 'Food Safety Training',
      status: hasCompletedTraining ? 'done' : 'not_started',
      description: hasCompletedTraining 
        ? 'Training completed' 
        : 'Learn food safety best practices at your own pace',
      actionLabel: hasCompletedTraining ? 'Review Training' : 'Start Training',
      actionHref: '/microlearning/overview',
    });
  }

  if (selectedPaths.includes('kitchen')) {
    summaryItems.push({
      id: 'kitchen-access',
      label: 'Kitchen Access',
      status: hasKitchenApplications ? 'done' : 'not_started',
      description: hasKitchenApplications 
        ? `${hasKitchenApplications} kitchen application(s) submitted` 
        : 'Browse and apply to commercial kitchens anytime',
      actionLabel: 'Browse Kitchens',
      actionHref: '/compare-kitchens',
    });
  }

  const completedCount = summaryItems.filter(item => item.status === 'done' || item.status === 'in_progress').length;
  const totalCount = summaryItems.length;

  return (
    <div className="space-y-6">
      {/* Informative Header */}
      <Card className="border-border/50 bg-gradient-to-br from-primary/5 to-transparent">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <ChefHat className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-lg mb-1">You're Ready to Go!</h3>
              <p className="text-muted-foreground text-sm">
                This onboarding is complete. You now have full access to your dashboard. 
                The items below can be completed at any time from your dashboard.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Progress Summary */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Your Progress</CardTitle>
          <CardDescription>
            {completedCount === totalCount 
              ? "Great job! You've completed all the steps."
              : `${completedCount} of ${totalCount} items completed`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-0 divide-y">
          {summaryItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
              <div className="flex items-center gap-3">
                {item.status === 'done' && (
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                    <Check className="h-4 w-4 text-green-600" />
                  </div>
                )}
                {item.status === 'in_progress' && (
                  <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                    <Loader2 className="h-4 w-4 text-amber-600 animate-spin" />
                  </div>
                )}
                {item.status === 'not_started' && (
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-muted-foreground/50" />
                  </div>
                )}
                <div>
                  <p className="font-medium">{item.label}</p>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
              </div>
              {item.actionHref && (
                <Button variant="ghost" size="sm" asChild className="shrink-0">
                  <Link href={item.actionHref}>{item.actionLabel}</Link>
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function BrowseKitchensStep({ hasApplications }: { hasApplications: boolean }) {
  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle>Browse & Apply to Kitchens</CardTitle>
        <CardDescription>Find commercial kitchens and submit applications</CardDescription>
      </CardHeader>
      <CardContent>
        {hasApplications ? (
          <div className="space-y-4">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-3">
                <Check className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="font-medium text-blue-800">Applications Submitted</p>
                  <p className="text-sm text-blue-600">
                    You have pending kitchen access applications.
                  </p>
                </div>
              </div>
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link href="/compare-kitchens">Browse More Kitchens</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Explore our network of commercial kitchens and apply for access. Find the perfect space for your culinary needs.
            </p>
            <Button asChild variant="secondary" className="w-full">
              <Link href="/compare-kitchens">Browse Kitchens</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CompletionStep({ selectedPaths }: { selectedPaths: string[] }) {
  const { hasSellerApplication, hasKitchenApplications } = useChefOnboarding();

  // Build personalized message based on what they've done
  const getCompletionMessage = () => {
    const messages: string[] = [];
    
    if (selectedPaths.includes('localcooks')) {
      if (hasSellerApplication) {
        messages.push("Your seller application is being reviewed.");
      } else {
        messages.push("You can submit your seller application anytime from the dashboard.");
      }
    }
    
    if (selectedPaths.includes('kitchen')) {
      if (hasKitchenApplications) {
        messages.push("Your kitchen applications are being processed.");
      } else {
        messages.push("Browse and apply to commercial kitchens whenever you're ready.");
      }
    }
    
    return messages.join(" ");
  };

  return (
    <Card className="border-border/50">
      <CardContent className="p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
          <Check className="h-10 w-10 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold mb-4">Onboarding Complete!</h2>
        <p className="text-muted-foreground max-w-md mx-auto mb-2">
          Welcome to Local Cooks! You now have full access to your dashboard.
        </p>
        <p className="text-muted-foreground max-w-md mx-auto mb-6 text-sm">
          {getCompletionMessage()}
        </p>
        <Button asChild size="lg" className="px-8">
          <Link href="/dashboard">Go to Dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// Main Page Component with Providers
export default function ChefSetupPage() {
  return (
    <OnboardingProvider steps={chefOnboardingSteps as any}>
      <ChefOnboardingProvider>
        <ChefSetupContent />
      </ChefOnboardingProvider>
    </OnboardingProvider>
  );
}
