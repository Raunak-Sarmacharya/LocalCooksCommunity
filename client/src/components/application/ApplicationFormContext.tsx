import React, { createContext, useState, useContext } from "react";
import { ApplicationFormData } from "@/lib/applicationSchema";

type FormStep = 1 | 2 | 3;

export function leaveSellerApplication(proceed?: () => void) {
  const url = new URL(window.location.href);
  url.searchParams.delete("action");
  window.history.replaceState({}, "", url);
  proceed?.();
}

interface ApplicationFormContextProps {
  currentStep: FormStep;
  formData: Partial<ApplicationFormData>;
  setCurrentStep: (step: FormStep) => void;
  updateFormData: (data: Partial<ApplicationFormData>) => void;
  goToNextStep: () => void;
  goToPreviousStep: () => void;
  /** Leave the whole application flow (parent should confirm). */
  onCancel?: () => void;
  isBusy: boolean;
  setIsBusy: (busy: boolean) => void;
}

const ApplicationFormContext = createContext<ApplicationFormContextProps | undefined>(undefined);

export const ApplicationFormProvider: React.FC<{
  children: React.ReactNode;
  onCancel?: () => void;
  onBusyChange?: (busy: boolean) => void;
}> = ({ children, onCancel, onBusyChange }) => {
  const [isBusy, setBusy] = useState(false);
  const setIsBusy = React.useCallback((busy: boolean) => {
    setBusy(busy);
    onBusyChange?.(busy);
  }, [onBusyChange]);
  const [currentStep, setCurrentStep] = useState<FormStep>(1);
  const [formData, setFormData] = useState<Partial<ApplicationFormData>>({
    fullName: "",
    email: "",
    phone: "",
    foodSafetyLicense: undefined,
    foodEstablishmentCert: undefined,
    kitchenPreference: undefined,
    feedback: "",
    foodSafetyLicenseUrl: "",
    foodEstablishmentCertUrl: "",
  });

  const updateFormData = (data: Partial<ApplicationFormData>) => {
    setFormData((prevData) => ({
      ...prevData,
      ...data,
    }));
  };

  const goToNextStep = () => {
    if (currentStep < 3) {
      setCurrentStep((prevStep) => (prevStep + 1) as FormStep);
    }
  };

  const goToPreviousStep = () => {
    if (currentStep > 1) {
      setCurrentStep((prevStep) => (prevStep - 1) as FormStep);
    }
  };

  return (
    <ApplicationFormContext.Provider
      value={{
        currentStep,
        formData,
        setCurrentStep,
        updateFormData,
        goToNextStep,
        goToPreviousStep,
        onCancel,
        isBusy,
        setIsBusy,
      }}
    >
      {children}
    </ApplicationFormContext.Provider>
  );
};

export const useApplicationForm = (): ApplicationFormContextProps => {
  const context = useContext(ApplicationFormContext);
  if (!context) {
    throw new Error("useApplicationForm must be used within an ApplicationFormProvider");
  }
  return context;
};
