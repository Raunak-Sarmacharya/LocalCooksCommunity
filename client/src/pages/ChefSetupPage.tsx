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
      case "profile-setup":
        return <ProfileSetupStep user={user} />;
      case "seller-application":
        return <SellerApplicationStep hasApplication={hasSellerApplication} />;
      case "food-safety-training":
        return <TrainingStep hasCompleted={hasCompletedTraining} />;
      case "document-verification":
        return <DocumentVerificationStep />;
      case "kitchen-discovery":
        return <KitchenDiscoveryStep />;
      case "kitchen-application":
        return <KitchenApplicationStep hasApplications={hasKitchenApplications} />;
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
                <span className="font-bold text-lg text-primary">LocalCooks</span>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Chef Setup
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
              <span className="font-bold text-primary">LocalCooks</span>
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
                <Button onClick={handleNext} className="gap-2">
                  {isLastStep ? "Complete Setup" : "Continue"}
                  {!isLastStep && <ArrowRight className="h-4 w-4" />}
                </Button>
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
  togglePath: (path: 'seller' | 'kitchen') => void;
}) {
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        Choose what you'd like to do with LocalCooks. You can select one or both options.
      </p>

      <div className="grid gap-4">
        {/* Sell on LocalCooks */}
        <button
          onClick={() => togglePath('seller')}
          className={cn(
            "p-6 rounded-xl border-2 text-left transition-all",
            selectedPaths.includes('seller')
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/50"
          )}
        >
          <div className="flex items-start gap-4">
            <div
              className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center",
                selectedPaths.includes('seller')
                  ? "bg-primary text-primary-foreground"
                  : "bg-primary/10 text-primary"
              )}
            >
              <Store className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">Sell on LocalCooks</h3>
                {selectedPaths.includes('seller') && (
                  <Check className="h-5 w-5 text-primary" />
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Become a verified seller and sell your homemade food to customers. We handle delivery, payments, and customer support.
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

function ProfileSetupStep({ user }: { user: any }) {
  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle>Your Profile</CardTitle>
        <CardDescription>Review your profile information</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4 p-4 bg-muted/30 rounded-lg">
          {user?.photoURL ? (
            <img
              src={user.photoURL}
              alt={user.displayName || "Profile"}
              className="w-16 h-16 rounded-full"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <ChefHat className="h-8 w-8 text-primary" />
            </div>
          )}
          <div>
            <p className="font-bold text-lg">{user?.displayName || "Chef"}</p>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Your profile is linked to your Google account. You can update your display name in your account settings.
        </p>
      </CardContent>
    </Card>
  );
}

function SellerApplicationStep({ hasApplication }: { hasApplication: boolean }) {
  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle>Seller Application</CardTitle>
        <CardDescription>Apply to sell on LocalCooks</CardDescription>
      </CardHeader>
      <CardContent>
        {hasApplication ? (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-3">
              <Check className="h-5 w-5 text-green-600" />
              <div>
                <p className="font-medium text-green-800">Application Submitted</p>
                <p className="text-sm text-green-600">
                  Your seller application is being reviewed.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Submit your application to become a verified LocalCooks seller.
            </p>
            <Button asChild className="w-full">
              <Link href="/apply">Start Application</Link>
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
        <CardDescription>Complete required training modules</CardDescription>
      </CardHeader>
      <CardContent>
        {hasCompleted ? (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-3">
              <Check className="h-5 w-5 text-green-600" />
              <div>
                <p className="font-medium text-green-800">Training Completed</p>
                <p className="text-sm text-green-600">
                  You've completed all required training modules.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Complete our food safety training to ensure you meet all requirements.
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

function DocumentVerificationStep() {
  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle>Document Verification</CardTitle>
        <CardDescription>Upload required certifications</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground">
          Upload your food safety license and any other required documents for verification.
        </p>
        <Button asChild className="w-full">
          <Link href="/document-verification">Upload Documents</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function KitchenDiscoveryStep() {
  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle>Discover Kitchens</CardTitle>
        <CardDescription>Browse available commercial kitchens</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground">
          Explore our network of commercial kitchens and find the perfect space for your needs.
        </p>
        <Button asChild className="w-full bg-blue-600 hover:bg-blue-700">
          <Link href="/compare-kitchens">Browse Kitchens</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function KitchenApplicationStep({ hasApplications }: { hasApplications: boolean }) {
  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle>Kitchen Applications</CardTitle>
        <CardDescription>Apply to access commercial kitchens</CardDescription>
      </CardHeader>
      <CardContent>
        {hasApplications ? (
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
        ) : (
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Browse kitchens and submit applications to gain access.
            </p>
            <Button asChild className="w-full bg-blue-600 hover:bg-blue-700">
              <Link href="/compare-kitchens">Find Kitchens</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CompletionStep({ selectedPaths }: { selectedPaths: string[] }) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
          <Check className="h-10 w-10 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold mb-4">Setup Complete!</h2>
        <p className="text-muted-foreground max-w-md mx-auto mb-6">
          You're all set to start your journey with LocalCooks.
          {selectedPaths.includes('seller') && " Your seller application is being processed."}
          {selectedPaths.includes('kitchen') && " Explore kitchens and book your first session."}
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
