import React from 'react';
import KitchenAvailabilityManagement from '@/pages/KitchenAvailabilityManagement';
import { useManagerOnboarding } from '../ManagerOnboardingContext';
import { OnboardingNavigationFooter } from '../OnboardingNavigationFooter';

const AvailabilityStep = () => {
    const {
        selectedLocationId,
        selectedKitchenId,
        handleNext,
        handleBack,
        isFirstStep
    } = useManagerOnboarding();

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="mb-6">
                <h2 className="text-xl font-semibold tracking-tight">Set your Availability</h2>
                <p className="text-muted-foreground">Define when your kitchen is open for bookings.</p>
            </div>

            <div className="border rounded-md p-4 bg-background">
                {selectedLocationId ? (
                    <KitchenAvailabilityManagement
                        embedded={true}
                        initialLocationId={selectedLocationId}
                        initialKitchenId={selectedKitchenId || undefined}
                    />
                ) : (
                    <div className="text-center p-4 text-muted-foreground">Please create a location first.</div>
                )}
            </div>

            <OnboardingNavigationFooter
                onNext={handleNext}
                onBack={handleBack}
                showBack={!isFirstStep}
            />
        </div>
    );
};

export default AvailabilityStep;
