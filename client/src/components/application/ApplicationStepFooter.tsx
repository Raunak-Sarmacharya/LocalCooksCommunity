import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApplicationForm } from "./ApplicationFormContext";

interface ApplicationStepFooterProps {
  continueLabel: ReactNode;
  continueTestId?: string;
  continueDisabled?: boolean;
  showPrevious?: boolean;
  showContinueArrow?: boolean;
}

/** Matches booking flow actions: Cancel | Back? | primary flex-1 */
export function ApplicationStepFooter({
  continueLabel,
  continueTestId,
  continueDisabled,
  showPrevious = false,
  showContinueArrow = true,
}: ApplicationStepFooterProps) {
  const { t } = useTranslation("chef");
  const { goToPreviousStep, onCancel } = useApplicationForm();

  return (
    <div className="flex flex-wrap items-center gap-3 border-t pt-6">
      {onCancel ? (
        <Button
          type="button"
          variant="ghost"
          className="min-h-[44px] shrink-0 text-muted-foreground"
          onClick={onCancel}
          data-testid="seller-application-cancel"
        >
          {t("apCancelBtn")}
        </Button>
      ) : null}
      {showPrevious ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px] shrink-0"
          onClick={goToPreviousStep}
        >
          <ArrowLeft className="h-4 w-4" />
          {t("sellerApp_back")}
        </Button>
      ) : null}
      <Button
        type="submit"
        className="min-h-[44px] min-w-[8rem] flex-1"
        disabled={continueDisabled}
        data-testid={continueTestId}
      >
        {continueLabel}
        {showContinueArrow ? <ArrowRight className="h-4 w-4" /> : null}
      </Button>
    </div>
  );
}
