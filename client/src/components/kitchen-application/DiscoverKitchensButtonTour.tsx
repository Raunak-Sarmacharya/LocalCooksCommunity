import { SpotlightWalkthrough, walkthroughStorageKey, type SpotlightWalkthroughStep } from "@/components/ui/spotlight-walkthrough";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";

const START_TOUR_KEY = "lc.discoverKitchens.startTour";

export function requestDiscoverKitchensWalkthrough() {
  try {
    sessionStorage.setItem(START_TOUR_KEY, "1");
  } catch {
    // ignore
  }
}

export function peekDiscoverKitchensWalkthroughRequest() {
  try {
    return sessionStorage.getItem(START_TOUR_KEY) === "1";
  } catch {
    return false;
  }
}

export function consumeDiscoverKitchensWalkthroughRequest() {
  try {
    if (sessionStorage.getItem(START_TOUR_KEY) !== "1") return false;
    sessionStorage.removeItem(START_TOUR_KEY);
    return true;
  } catch {
    return false;
  }
}

export function DiscoverKitchensButtonTour({
  enabled,
  replayToken = 0,
}: {
  enabled: boolean;
  replayToken?: number;
}) {
  const { t } = useTranslation("kitchen");
  const { user } = useFirebaseAuth();

  const STEPS: SpotlightWalkthroughStep[] = [
    {
      id: "tab-discover",
      title: t("applyFlowTourDiscoverTab", "Discover"),
      body: t("applyFlowTourDiscoverTabDesc", "Browse partner kitchens and compare what each space offers."),
    },
    {
      id: "details",
      title: t("applyFlowTourDetails", "View details"),
      body: t("applyFlowTourDetailsDesc", "Open a kitchen to see photos, equipment, storage, and rates before you apply."),
    },
  ];

  return (
    <SpotlightWalkthrough
      storageKey={walkthroughStorageKey("lc.discoverKitchens.buttonTour.v6", user?.uid)}
      attr="data-kitchen-tour"
      steps={STEPS}
      enabled={enabled}
      replayToken={replayToken}
      readyWhen={(ids) => ids.includes("tab-discover") && ids.includes("details")}
    />
  );
}
