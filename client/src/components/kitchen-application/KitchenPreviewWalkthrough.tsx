import { useEffect, useState } from "react";
import { SpotlightWalkthrough, walkthroughStorageKey } from "@/components/ui/spotlight-walkthrough";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useFirebaseAuth } from "@/hooks/use-auth";

import { useTranslation } from "react-i18next";

const PREVIEW_WALKTHROUGH_BASE = "lc.kitchenPreview.walkthrough.v3";

export function KitchenPreviewWalkthrough({
  enabled,
  replayToken = 0,
}: {
  enabled: boolean;
  replayToken?: number;
}) {
  const { t } = useTranslation("kitchen");
  const { user } = useFirebaseAuth();
  const { isOpen } = useAuthModal();
  const [hasOpenDialog, setHasOpenDialog] = useState(false);

  useEffect(() => {
    // Check for real application/auth/dialogs that should suppress the tour,
    // excluding the Spotlight walkthrough overlay itself (which mounts with
    // role="dialog" and caused an infinite enable/unmount flicker loop).
    const compute = () => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      for (let i = 0; i < dialogs.length; i++) {
        const el = dialogs[i];
        // SpotlightWalkthrough renders with aria-labelledby="spotlight-walkthrough-title"
        if (el.getAttribute("aria-labelledby") === "spotlight-walkthrough-title") continue;
        setHasOpenDialog(true);
        return;
      }
      setHasOpenDialog(false);
    };

    compute();

    const observer = new MutationObserver(compute);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const STEPS = [
    {
      id: "schedule",
      title: t("tourSchedule", "Request a tour"),
      body: t("tourScheduleDesc", "Kitchen tour. You still need to apply."),
    },
    {
      id: "kitchen-picker",
      title: t("tourKitchenPicker", "Choose a kitchen"),
      body: t("tourKitchenPickerDesc", "This location has more than one. Pick the space you want."),
    },
    {
      id: "photos",
      title: t("tourPhotos", "Photos"),
      body: t("tourPhotosDesc", "See the space. Tap a photo to zoom."),
    },
    {
      id: "tab-overview",
      title: t("tourTabOverview", "Overview"),
      body: t("tourTabOverviewDesc", "Hours, amenities, and where it is."),
    },
    {
      id: "tab-equipment",
      title: t("equipment", "Equipment"),
      body: t("tourTabEquipmentDesc", "What's included and available to rent."),
    },
    {
      id: "tab-storage",
      title: t("storage", "Storage"),
      body: t("tourTabStorageDesc", "Cold, dry, and other storage on site."),
    },
    {
      id: "hours",
      title: t("tourHours", "Hours"),
      body: t("tourHoursDesc", "When you can cook. Book exact times after approval."),
    },
    {
      id: "cta",
      title: t("tourCta", "Your next step"),
      body: t("tourCtaDesc", "Apply, continue, or book from here."),
    },
    {
      id: "equipment",
      title: t("equipment", "Equipment"),
      body: t("tourTabEquipmentDesc", "What's included and available to rent."),
    },
    {
      id: "storage",
      title: t("storage", "Storage"),
      body: t("tourTabStorageDesc", "Cold, dry, and other storage on site."),
    },
  ];

  return (
    <SpotlightWalkthrough
      storageKey={walkthroughStorageKey(PREVIEW_WALKTHROUGH_BASE, user?.uid)}
      attr="data-preview-tour"
      steps={STEPS}
      enabled={enabled && !isOpen && !hasOpenDialog}
      replayToken={replayToken}
      readyWhen={(ids) => ids.includes("photos") && ids.includes("hours")}
    />
  );
}
