import React from 'react';
import { CheckCircle, Calendar } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import KitchenAvailabilityManagement from '@/pages/KitchenAvailabilityManagement';
import { useManagerOnboarding } from '../ManagerOnboardingContext';
import { OnboardingNavigationFooter } from '../OnboardingNavigationFooter';

const AvailabilityStep = () => {
    const {
        selectedLocationId,
        selectedKitchenId,
        handleNext,
        handleBack,
        isFirstStep,
        refreshAvailability,
        hasAvailability,
        skipCurrentStep
    } = useManagerOnboarding();

    const handleSaveAndContinue = async () => {
        if (refreshAvailability) {
            await refreshAvailability();
        }
        setTimeout(() => {
            handleNext();
        }, 100);
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Status Alert */}
            {hasAvailability ? (
                <Alert className="border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-900/50">
                    <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <AlertDescription className="text-sm text-emerald-700 dark:text-emerald-300">
                        <span className="font-medium">Availability saved</span> — Modify below or continue to next step.
                    </AlertDescription>
                </Alert>
            ) : (
                <Alert className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900/50">
                    <Calendar className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <AlertDescription className="text-sm text-amber-700 dark:text-amber-300">
                        <span className="font-medium">Set your availability</span> — Save your schedule to continue.
                    </AlertDescription>
                </Alert>
            )}

            {/* Availability Management */}
            <Card className="border-slate-200/60 dark:border-slate-700/60 shadow-sm">
                <CardContent className="pt-6">
                    {selectedLocationId ? (
                        <KitchenAvailabilityManagement
                            embedded={true}
                            initialLocationId={selectedLocationId}
                            initialKitchenId={selectedKitchenId || undefined}
                            onSaveSuccess={refreshAvailability}
                        />
                    ) : (
                        <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                            Please create a location first.
                        </div>
                    )}
                </CardContent>
            </Card>

            <OnboardingNavigationFooter
                onNext={hasAvailability ? handleNext : handleSaveAndContinue}
                onBack={handleBack}
                onSkip={skipCurrentStep}
                showBack={!isFirstStep}
                showSkip={true}
                nextLabel={hasAvailability ? "Continue" : "Save & Continue"}
                isNextDisabled={!hasAvailability}
            />
        </div>
    );
};

export default AvailabilityStep;
