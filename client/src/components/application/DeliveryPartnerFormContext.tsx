import { InsertDeliveryPartnerApplication } from '@shared/schema';
import { createContext, ReactNode, useContext, useState } from 'react';

interface DeliveryPartnerFormContextType {
  currentStep: number;
  formData: Partial<InsertDeliveryPartnerApplication>;
  goToNextStep: () => void;
  goToPreviousStep: () => void;
  goToStep: (step: number) => void;
  updateFormData: (data: Partial<InsertDeliveryPartnerApplication>) => void;
  resetForm: () => void;
  canGoToNextStep: () => boolean;
}

const DeliveryPartnerFormContext = createContext<DeliveryPartnerFormContextType | undefined>(undefined);

interface DeliveryPartnerFormProviderProps {
  children: ReactNode;
}

export function DeliveryPartnerFormProvider({ children }: DeliveryPartnerFormProviderProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<Partial<InsertDeliveryPartnerApplication>>({});

  const updateFormData = (data: Partial<InsertDeliveryPartnerApplication>) => {
    setFormData(prev => ({ ...prev, ...data }));
  };

  const goToNextStep = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    }
  };

  const goToPreviousStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const goToStep = (step: number) => {
    if (step >= 1 && step <= 4) {
      setCurrentStep(step);
    }
  };

  const resetForm = () => {
    setFormData({});
    setCurrentStep(1);
  };

  const canGoToNextStep = (): boolean => {
    switch (currentStep) {
      case 1: // Personal Info
        return !!(formData.fullName && formData.email && formData.phone);
      case 2: // Address
        return !!(formData.address && formData.city && formData.province && formData.postalCode);
      case 3: // Vehicle Details
        return !!(formData.vehicleType && formData.vehicleMake && formData.vehicleModel && formData.licensePlate);
      case 4: // Documents
        return true; // Documents are optional during initial submission
      default:
        return false;
    }
  };

  const value: DeliveryPartnerFormContextType = {
    currentStep,
    formData,
    goToNextStep,
    goToPreviousStep,
    goToStep,
    updateFormData,
    resetForm,
    canGoToNextStep,
  };

  return (
    <DeliveryPartnerFormContext.Provider value={value}>
      {children}
    </DeliveryPartnerFormContext.Provider>
  );
}

export function useDeliveryPartnerForm() {
  const context = useContext(DeliveryPartnerFormContext);
  if (context === undefined) {
    throw new Error('useDeliveryPartnerForm must be used within a DeliveryPartnerFormProvider');
  }
  return context;
}
