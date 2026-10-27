import { useEffect } from "react";
import { ApplicationFormProvider, useApplicationForm } from "./ApplicationFormContext";
import CertificationsForm from "./CertificationsForm";
import KitchenPreferenceForm from "./KitchenPreferenceForm";
import PersonalInfoForm from "./PersonalInfoForm";
import { Icon } from "@iconify/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface ApplicationFormPanelProps {
  onBack?: () => void;
  className?: string;
  onBusyChange?: (busy: boolean) => void;
}

/** Three short steps; the bar says where they are (owner mock, Oct 27). */
export function StepBar({ step }: { step: 1 | 2 | 3 }) {
  const { t } = useTranslation("chef");
  const labels = [t("sell_stepYou"), t("sell_stepKitchen"), t("sell_stepDocuments")];
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label={t("sell_stepsLabel")}>
      {labels.map((label, index) => (
        <li key={label} aria-current={step === index + 1 ? "step" : undefined}
          className={cn("border-t-[3px] pt-2 text-[13px]", step === index + 1 ? "border-primary font-semibold" : step > index + 1 ? "border-foreground" : "border-border text-muted-foreground")}>
          <span className="hidden sm:inline">{index + 1} · </span>{label}
        </li>
      ))}
    </ol>
  );
}

function FormStepContent() {
  const { currentStep, onCancel, isBusy } = useApplicationForm();
  const { t } = useTranslation("chef");
  const copy = [
    { title: t("sell_step1Title"), lede: t("sell_step1Lede") },
    { title: t("sell_step2Title"), lede: t("sell_step2Lede") },
    { title: t("sell_step3Title"), lede: t("sell_step3Lede") },
  ][currentStep - 1];

  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [currentStep]);

  return (
    <div className="mx-auto max-w-[640px] space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight tracking-[-0.02em] text-balance sm:text-[26px]">{copy.title}</h1>
          <p className="mt-1.5 text-muted-foreground text-pretty">{copy.lede}</p>
        </div>
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" className="shrink-0 rounded-full text-muted-foreground" disabled={isBusy} onClick={onCancel} data-testid="seller-application-cancel">
            <Icon icon="mdi:close" className="size-4" aria-hidden />
            {t("apCancelBtn")}
          </Button>
        ) : null}
      </div>
      <StepBar step={currentStep} />
      <div key={currentStep} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
        {currentStep === 1 && <PersonalInfoForm />}
        {currentStep === 2 && <KitchenPreferenceForm />}
        {currentStep === 3 && <CertificationsForm />}
      </div>
    </div>
  );
}

export default function ApplicationFormPanel({ onBack, className, onBusyChange }: ApplicationFormPanelProps) {
  return (
    <ApplicationFormProvider onCancel={onBack} onBusyChange={onBusyChange}>
      <div className={cn("w-full", className)}>
        <FormStepContent />
      </div>
    </ApplicationFormProvider>
  );
}
