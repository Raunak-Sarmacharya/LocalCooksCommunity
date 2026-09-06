import { useEffect, useRef } from "react";
import { ApplicationFormProvider, useApplicationForm } from "./ApplicationFormContext";
import CertificationsForm from "./CertificationsForm";
import KitchenPreferenceForm from "./KitchenPreferenceForm";
import PersonalInfoForm from "./PersonalInfoForm";
import ProgressIndicator from "./ProgressIndicator";
import { Icon } from "@iconify/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChefPageHeader, InfoHint } from "@/components/chef/ui";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";

interface ApplicationFormPanelProps {
  onBack?: () => void;
  className?: string;
  onBusyChange?: (busy: boolean) => void;
}

function FormStepContent() {
  const { currentStep, onCancel, isBusy } = useApplicationForm();
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation("chef");

  const STEP_COPY = [
    {
      title: t("sellerApp_step1_title"),
      description: t("sellerApp_step1_desc"),
      tips: [
        { title: t("sellerApp_step1_whyFirstTitle"), body: t("sellerApp_step1_whyFirstBody") },
        { title: t("sellerApp_step1_nextTitle"), body: t("sellerApp_step1_nextBody") },
      ],
    },
    {
      title: t("sellerApp_step2_title"),
      description: t("sellerApp_step2_desc"),
      tips: [
        { title: t("sellerApp_step2_noWrongAnswerTitle"), body: t("sellerApp_step2_noWrongAnswerBody") },
        { title: t("sellerApp_step2_nextTitle"), body: t("sellerApp_step2_nextBody") },
      ],
    },
    {
      title: t("sellerApp_step3_title"),
      description: t("sellerApp_step3_desc"),
      tips: [
        { title: t("sellerApp_step3_optionalStartTitle"), body: t("sellerApp_step3_optionalStartBody") },
        { title: t("sellerApp_step3_afterSubmitTitle"), body: t("sellerApp_step3_afterSubmitBody") },
        { title: t("sellerApp_certHelpTitle"), body: t("sellerApp_certHelpBody") },
      ],
    },
  ] as const;

  const copy = STEP_COPY[currentStep - 1];

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentStep]);

  return (
    <div ref={containerRef} className="mx-auto max-w-3xl space-y-4 relative">
      <ChefPageHeader
        title={copy.title}
        description={t("sellerApp_stepOf3", { step: currentStep, desc: copy.description })}
        titleAccessory={
          <InfoHint title={t("sellerApp_goodToKnow")}>
            {currentStep === 3 ? (
              <>
                <p>{t("sellerApp_step3_optionalStartBody")} {t("sellerApp_step3_afterSubmitBody")}</p>
                <a href="https://www.gov.nl.ca/dgsnl/licences/env-health/food/" target="_blank" rel="noopener noreferrer" className="inline-flex rounded-md text-primary hover:underline">Visit Gov.nl.ca Food Safety</a>
              </>
            ) : copy.tips.map((tip) => (
              <div key={tip.title}>
                <p className="font-medium text-foreground">{tip.title}</p>
                <p>{tip.body}</p>
              </div>
            ))}
          </InfoHint>
        }
        actions={
          onCancel ? (
            <Button
              type="button"
              className="rounded-xl shadow-md font-medium"
              size="sm"
              disabled={isBusy}
              onClick={onCancel}
              data-testid="seller-application-cancel"
            >
              <Icon icon="mdi:close" className="mr-1.5 size-4" aria-hidden />
              {t("apCancelBtn")}
            </Button>
          ) : undefined
        }
      />

      <ProgressIndicator step={currentStep} />

      <Card className="shadow-none rounded-xl">
        <CardContent className="p-4 sm:p-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              {currentStep === 1 && <PersonalInfoForm />}
              {currentStep === 2 && <KitchenPreferenceForm />}
              {currentStep === 3 && <CertificationsForm />}
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>
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
