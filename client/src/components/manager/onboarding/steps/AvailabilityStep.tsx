import React, { useRef, useState } from 'react';
import { mt } from "@/i18n/manager";
import { CheckCircle, Calendar } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import KitchenAvailabilityManagement, { type KitchenAvailabilityManagementHandle } from '@/pages/KitchenAvailabilityManagement';
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
        hasAvailability
    } = useManagerOnboarding();
    const availabilityRef = useRef<KitchenAvailabilityManagementHandle>(null);
    const [isSavingAvailability, setIsSavingAvailability] = useState(false);

    const handleSaveAndContinue = async () => {
        setIsSavingAvailability(true);

        try {
            const saved = await availabilityRef.current?.saveWeeklySchedule();
            if (!saved) return;

            handleNext();
        } finally {
            setIsSavingAvailability(false);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Status Alert */}
            {hasAvailability ? (
                <Alert className="border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-900/50">
                    <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <AlertDescription className="text-sm text-emerald-700 dark:text-emerald-300">
                        <span className="font-medium">{mt("availabilitySaved")}</span> — {mt("modifyBelowOrContinue")}
                    </AlertDescription>
                </Alert>
            ) : (
                <Alert className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900/50">
                    <Calendar className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <AlertDescription className="text-sm text-amber-700 dark:text-amber-300">
                        <span className="font-medium">{mt("setYourAvailability")}</span> — {mt("saveScheduleToContinue")}
                    </AlertDescription>
                </Alert>
            )}

            {/* Availability Management */}
            <Card className="border-slate-200/60 dark:border-slate-700/60 shadow-sm">
                <CardContent className="pt-6">
                    {selectedLocationId ? (
                        <KitchenAvailabilityManagement
                            ref={availabilityRef}
                            embedded={true}
                            initialLocationId={selectedLocationId}
                            initialKitchenId={selectedKitchenId || undefined}
                            onSaveSuccess={refreshAvailability}
                            hideWeeklyScheduleSaveButton={true}
                        />
                    ) : (
                        <div className="text-center py-8 text-slate-500 dark:text-slate-400">{mt("pleaseCreateALocationFirst")}</div>
                    )}
                </CardContent>
            </Card>

            <OnboardingNavigationFooter
                onNext={handleSaveAndContinue}
                onBack={handleBack}
                showBack={!isFirstStep}
                nextLabel={mt("saveAndContinue")}
                isNextDisabled={!selectedKitchenId || isSavingAvailability}
                isLoading={isSavingAvailability}
            />
        </div>
    );
};

export default AvailabilityStep;
