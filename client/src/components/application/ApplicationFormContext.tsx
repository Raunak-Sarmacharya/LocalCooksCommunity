import React, { createContext, useState, useContext } from "react";
import { ApplicationFormData } from "@/lib/applicationSchema";

type FormStep = 1 | 2 | 3;

interface ApplicationFormContextProps {
  currentStep: FormStep;
  formData: Partial<ApplicationFormData>;
  setCurrentStep: (step: FormStep) => void;
  updateFormData: (data: Partial<ApplicationFormData>) => void;
  goToNextStep: () => void;
  goToPreviousStep: () => void;
}

const ApplicationFormContext = createContext<ApplicationFormContextProps | undefined>(undefined);

export const ApplicationFormProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentStep, setCurrentStep] = useState<FormStep>(1);
  const [formData, setFormData] = useState<Partial<ApplicationFormData>>({
    fullName: "",
    email: "",
    phone: "",
    foodSafetyLicense: undefined,
    foodEstablishmentCert: undefined,
    kitchenPreference: undefined,
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