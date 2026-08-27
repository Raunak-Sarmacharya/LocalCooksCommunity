import { useEffect, useRef } from "react";
import { ApplicationFormProvider, useApplicationForm } from "./ApplicationFormContext";
import CertificationsForm from "./CertificationsForm";
import KitchenPreferenceForm from "./KitchenPreferenceForm";
import PersonalInfoForm from "./PersonalInfoForm";
import ProgressIndicator from "./ProgressIndicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChefPageHeader, QuietNotice } from "@/components/chef/ui";
import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ApplicationFormPanelProps {
  onBack?: () => void;
  className?: string;
}

import { useTranslation } from "react-i18next";

function FormStepContent({ onBack }: { onBack?: () => void }) {
  const { currentStep, goToPreviousStep } = useApplicationForm();
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation("chef");

  const STEP_COPY = [
    {
      title: t("sellerApp_step1_title"),
      description: t("sellerApp_step1_desc"),
      guidance: [
        {
          title: t("sellerApp_step1_whyFirstTitle"),
          body: t("sellerApp_step1_whyFirstBody"),
        },
        {
          title: t("sellerApp_step1_nextTitle"),
          body: t("sellerApp_step1_nextBody"),
        },
      ],
    },
    {
      title: t("sellerApp_step2_title"),
      description: t("sellerApp_step2_desc"),
      guidance: [
        {
          title: t("sellerApp_step2_noWrongAnswerTitle"),
          body: t("sellerApp_step2_noWrongAnswerBody"),
        },
        {
          title: t("sellerApp_step2_nextTitle"),
          body: t("sellerApp_step2_nextBody"),
        },
      ],
    },
    {
      title: t("sellerApp_step3_title"),
      description: t("sellerApp_step3_desc"),
      guidance: [
        {
          title: t("sellerApp_step3_optionalStartTitle"),
          body: t("sellerApp_step3_optionalStartBody"),
        },
        {
          title: t("sellerApp_step3_afterSubmitTitle"),
          body: t("sellerApp_step3_afterSubmitBody"),
        },
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

  const wideStep = currentStep === 3;
  const formCard = (
    <Card className={cn("shadow-none", !wideStep && "lg:col-span-2")}>
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
  );
  const guidance = (
    <div className={cn(wideStep ? "grid gap-3 sm:grid-cols-2" : "space-y-3")}>
      {copy.guidance.map((item) => (
        <QuietNotice key={item.title} title={item.title}>
          {item.body}
        </QuietNotice>
      ))}
    </div>
  );

  return (
    <div ref={containerRef} className="space-y-8">
      <div>
        <ChefPageHeader
          title={copy.title}
          description={t("sellerApp_stepOf3", { step: currentStep, desc: copy.description })}
        />
      </div>

      <ProgressIndicator step={currentStep} />

      <div className={cn("grid items-start gap-4", !wideStep && "lg:grid-cols-3")}>
        {wideStep ? (
          <>
            {guidance}
            {formCard}
          </>
        ) : (
          <>
            {formCard}
            {guidance}
          </>
        )}
      </div>
    </div>
  );
}

export default function ApplicationFormPanel({ onBack, className }: ApplicationFormPanelProps) {
  return (
    <ApplicationFormProvider>
      <div className={cn("w-full", className)}>
        <FormStepContent onBack={onBack} />
      </div>
    </ApplicationFormProvider>
  );
}
