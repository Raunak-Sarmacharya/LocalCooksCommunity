import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { useApplicationForm } from "./ApplicationFormContext";
import { Icon } from "@iconify/react";

interface ApplicationStepFooterProps {
  continueLabel: ReactNode;
  continueTestId?: string;
  continueDisabled?: boolean;
  showPrevious?: boolean;
  showContinueArrow?: boolean;
}

/** Cancel belongs in the application header, not beside form actions. */
export function ApplicationStepFooter({
  continueLabel,
  continueTestId,
  continueDisabled,
  showPrevious = false,
  showContinueArrow = true,
}: ApplicationStepFooterProps) {
  const { t } = useTranslation("chef");
  const { goToPreviousStep, isBusy } = useApplicationForm();

  return (
    <div className="flex items-center justify-between gap-2 border-t pt-5">
      {showPrevious ? (
        <Button type="button" variant="ghost" className="shrink-0 rounded-xl" disabled={isBusy || continueDisabled} onClick={goToPreviousStep}>
          <Icon icon="mdi:arrow-left" className="size-4" aria-hidden />
          {t("sellerApp_back")}
        </Button>
      ) : <span />}
      <Button type="submit" className="min-w-[8rem] rounded-xl" disabled={isBusy || continueDisabled} data-testid={continueTestId}>
        {continueLabel}
        {showContinueArrow ? <Icon icon="mdi:arrow-right" className="size-4" aria-hidden /> : null}
      </Button>
    </div>
  );
}
