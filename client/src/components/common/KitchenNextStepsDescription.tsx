import { useTranslation } from "react-i18next";
import {
  KitchenApplicationJourneySteps,
  type KitchenJourneyPhase,
} from "./KitchenApplicationJourneySteps";

export function KitchenNextStepsDescription({
  type = "book",
  phase,
}: {
  type?: "book" | "tour" | "apply";
  /** Highlights the current step on the journey sidebar. */
  phase?: KitchenJourneyPhase;
}) {
  const { t } = useTranslation("kitchen");
  const isTour = type === "tour";
  const journeyPhase: KitchenJourneyPhase =
    phase ?? (isTour ? "tour_schedule" : "apply");

  return (
    <div className="space-y-6 mt-4">
      <p className="text-gray-600 text-[15px]">
        {t(
          "authModalNextStepsFriendly",
          "We just need a few quick details to share with our kitchen partners so they can best accommodate your request. Here's a look at what happens next:"
        )}
      </p>
      <KitchenApplicationJourneySteps
        variant={isTour ? "tour" : "book"}
        phase={journeyPhase}
        compact
      />
    </div>
  );
}
