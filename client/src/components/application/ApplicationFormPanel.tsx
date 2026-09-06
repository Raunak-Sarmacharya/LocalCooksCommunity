import { useEffect, useRef } from "react";
import { ApplicationFormProvider, useApplicationForm } from "./ApplicationFormContext";
import CertificationsForm from "./CertificationsForm";
import KitchenPreferenceForm from "./KitchenPreferenceForm";
import PersonalInfoForm from "./PersonalInfoForm";
import ProgressIndicator from "./ProgressIndicator";
import { Card, CardContent } from "@/components/ui/card";
import { ChefPageHeader, InfoHint } from "@/components/chef/ui";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";

interface ApplicationFormPanelProps {
  onBack?: () => void;
  className?: string;
}

function FormStepContent() {
  const { currentStep } = useApplicationForm();
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
    <div ref={containerRef} className="space-y-8">
      <ChefPageHeader
        title={copy.title}
        description={t("sellerApp_stepOf3", { step: currentStep, desc: copy.description })}
        titleAccessory={
          <InfoHint title={t("sellerApp_goodToKnow")}>
            {copy.tips.map((tip) => (
              <div key={tip.title}>
                <p className="font-medium text-foreground">{tip.title}</p>
                <p>{tip.body}</p>
              </div>
            ))}
          </InfoHint>
        }
      />

      <ProgressIndicator step={currentStep} />

      <Card className="shadow-none">
        <CardContent className="p-6">
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

export default function ApplicationFormPanel({ onBack, className }: ApplicationFormPanelProps) {
  return (
    <ApplicationFormProvider onCancel={onBack}>
      <div className={cn("w-full", className)}>
        <FormStepContent />
      </div>
    </ApplicationFormProvider>
  );
}
