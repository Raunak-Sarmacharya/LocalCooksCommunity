import { useEffect, useState } from "react";
import { SpotlightWalkthrough, walkthroughStorageKey } from "@/components/ui/spotlight-walkthrough";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";

/**
 * Recovery revision for completion values written by the former first-frame bug.
 * Keep this stable: dismissals recorded with this key are authoritative.
 */
const PREVIEW_WALKTHROUGH_COMPLETED = "lc.kitchenPreview.walkthrough.completed.v2";

export function previewWalkthroughCompletionKey(uid: string) {
  return walkthroughStorageKey(PREVIEW_WALKTHROUGH_COMPLETED, uid);
}

export function KitchenPreviewWalkthrough({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation("kitchen");
  const { user } = useFirebaseAuth();
  const { isOpen } = useAuthModal();
  const [hasOpenDialog, setHasOpenDialog] = useState(false);

  useEffect(() => {
    // Suppress while another dialog is open. Ignore the spotlight overlay itself
    // (role="dialog") so enable/unmount doesn't flicker.
    const compute = () => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      for (let i = 0; i < dialogs.length; i++) {
        const el = dialogs[i];
        if (el.getAttribute("aria-labelledby") === "spotlight-walkthrough-title") continue;
        if (el.getAttribute("data-state") === "closed") continue;
        if (el.getAttribute("aria-hidden") === "true") continue;
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
      id: "hours",
      title: t("tourHours", "Hours & date"),
      body: t("tourHoursDesc", "Pick an available date. Book exact times after approval."),
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

  if (!user?.uid) return null;

  return (
    <SpotlightWalkthrough
      storageKey={previewWalkthroughCompletionKey(user.uid)}
      attr="data-preview-tour"
      steps={STEPS}
      enabled={enabled && !isOpen && !hasOpenDialog}
      readyWhen={(ids) => ids.includes("photos") && ids.includes("hours")}
    />
  );
}
