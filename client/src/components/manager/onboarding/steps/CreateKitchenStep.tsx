import React, { useState, useEffect, useRef } from "react";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import {
  Plus,
  Image as ImageIcon,
} from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CARD_RADIUS, Card, CardContent } from "@/components/ui/card";
import { SettingsRow } from "@/components/manager/settings/SettingsRow";
import { CurrencyInput } from "@/components/ui/currency-input";
import { NumericInput } from "@/components/ui/numeric-input";
import { KitchenPhotoPlaceholder } from "@/components/kitchen/KitchenPhotoPlaceholder";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";
import { StepSummary } from "../StepSummary";
import { useStepParts } from "../use-step-parts";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import {
  ACCEPTED_IMAGE_TYPES,
  CoverPhotoField,
} from "@/components/manager/kitchen/KitchenPhotoFields";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { SmartImage } from "@/components/ui/smart-image";
import { FormLegend } from "@/components/ui/form-legend";
// The dashboard's own inventory surfaces. Parts 2 and 3 render them with `embedded`,
// which drops their duplicate heading and un-pins their commit bar — one implementation
// in two placements, so the wizard cannot drift from My Kitchens.
import { EquipmentListingContent } from "@/pages/EquipmentListingManagement";
import { StorageListingContent } from "@/pages/StorageListingManagement";
import { useScrollToTopOnChange } from "@/hooks/use-scroll-to-top-on-change";


/**
 * The step, in three parts that save as they go.
 *
 * Part 1 is the kitchen itself and is what the step exists for. Parts 2 and 3 are
 * equipment and storage — both OPTIONAL, and both things a manager can add later from
 * My Kitchens. They live here because a manager is already thinking about the space they
 * just described, and because two optional steps of their own made the wizard nine
 * screens long for something most managers skip.
 */
const PART_COUNT = 3;

/**
 * The screen after the last part.
 *
 * Not a fourth PART — the dots stay at three, because the work is three things — but a
 * separate screen rather than a card hanging off the bottom of the storage inventory. The
 * manager finished the parts; the review is where they see what they finished before
 * moving on to Availability.
 */
const SUMMARY_PART = PART_COUNT;

/** How many names the summary lists per section before it stops and counts the rest. */
const RECAP_CAP = 4;

/**
 * What the three parts produced, shown at the end of the last one.
 *
 * Read-only on purpose. It is a report of the step, so each section offers Edit — which
 * goes back to the part that owns the thing — rather than an expander holding a second
 * copy of every form. Two editors for one record is how a page ends up disagreeing with
 * itself, and the manager already has one place per field.
 *
 * Lists are capped: someone with forty equipment listings needs the shape of what they
 * set up, not the inventory, which is what My Kitchens is for.
 */
function ListingSummary({
  kitchen,
  equipment,
  storage,
  onEdit,
}: {
  kitchen: any;
  equipment: string[];
  storage: string[];
  onEdit: (part: number) => void;
}) {
  const hourly = formatCentsAsDollars(kitchen?.hourlyRate);
  const daily = formatCentsAsDollars(kitchen?.dailyRate);
  const photos = kitchen ? collectKitchenPhotos(kitchen) : [];

  const cap = (items: string[]) =>
    `${items.slice(0, RECAP_CAP).join(", ")}${
      items.length > RECAP_CAP ? ` +${items.length - RECAP_CAP}` : ""
    }`;

  const rowValue = (items: string[]) =>
    items.length === 0 ? mt("kitchenRecapSkipped") : cap(items);

  return (
    <StepSummary
      media={<KitchenListingGallery photos={photos} kitchenName={kitchen?.name ?? ""} />}
      heading={{
        title: kitchen?.name ?? "",
        part: 0,
        meta: (
          <>
            <span className={cn("tabular-nums font-bold", hourly ? "text-[#F51042]" : "text-muted-foreground")}>
              {hourly ? `${hourly}/hr` : mt("notSet")}
            </span>
            {daily ? (
              <>
                <span className="text-muted-foreground/50" aria-hidden>·</span>
                <span className="tabular-nums font-medium text-foreground">{daily}/day</span>
              </>
            ) : null}
            <span className="text-muted-foreground/50" aria-hidden>·</span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <ImageIcon className="h-3.5 w-3.5" />
              {photos.length > 0 ? mt("photoCount", { count: photos.length }) : mt("notSet")}
            </span>
          </>
        ),
      }}
      sections={[
        {
          key: "equipment",
          title: mt("kitchenPartEquipmentTitle"),
          part: 1,
          // The group's title is the row's label — no need to say it twice.
          rows: [{ key: "items", value: rowValue(equipment) }],
        },
        {
          key: "storage",
          title: mt("kitchenPartStorageTitle"),
          part: 2,
          rows: [{ key: "items", value: rowValue(storage) }],
        },
      ]}
      onEdit={onEdit}
      noteTitle={mt("kitchenRecapTitle")}
      noteBody={mt("kitchenRecapBody")}
    />
  );
}


/** Cover first, then gallery — same order chefs see on the listing page. */
function collectKitchenPhotos(kitchen: any, coverOverride?: string): string[] {
  const cover = (coverOverride !== undefined ? coverOverride : kitchen.imageUrl) || "";
  const gallery: string[] = (kitchen.galleryImages || []).filter(Boolean);
  const ordered: string[] = [];
  if (cover) ordered.push(cover);
  for (const url of gallery) {
    if (url !== cover) ordered.push(url);
  }
  return ordered;
}

function formatCentsAsDollars(cents: string | number | null | undefined): string | null {
  if (cents === null || cents === undefined || cents === "") return null;
  const n = typeof cents === "number" ? cents : parseFloat(String(cents));
  if (!Number.isFinite(n) || n <= 0) return null;
  return `$${(n / 100).toFixed(2)}`;
}

/**
 * Airbnb-style photo collage: hero on the left, up to four tiles on the right.
 * Matches KitchenPreviewPage's collage grid so onboarding previews the real listing.
 * Mobile collapses to a single cover — tiny multi-tiles read as noise under ~640px.
 */
function KitchenListingGallery({
  photos,
  kitchenName,
  badge,
}: {
  photos: string[];
  kitchenName: string;
  badge?: React.ReactNode;
}) {
  const PREVIEW_COUNT = 5;
  const preview = photos.slice(0, PREVIEW_COUNT);
  const count = preview.length;
  const extra = Math.max(0, photos.length - PREVIEW_COUNT);
  // Hero + 2-col tail: even totals (4 photos) leave one empty cell — fill it
  // the same way KitchenPreviewPage does with a "see all" tile.
  const showSeeAllTile = count >= 4 && count % 2 === 0;
  const lastPreview = preview[preview.length - 1];

  if (count === 0) {
    return (
      <div className="relative h-[180px] overflow-hidden bg-[#F3F1EF] sm:h-[220px]">
        <KitchenPhotoPlaceholder />
        {badge ? <div className="absolute left-3 top-3 z-10">{badge}</div> : null}
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Mobile: one cover, booking-site standard */}
      <div className="relative h-[200px] overflow-hidden bg-[#F3F1EF] sm:hidden">
        <SmartImage
          src={getR2ProxyUrl(preview[0])}
          alt={kitchenName}
          className="h-full w-full object-cover"
          hideOnError
        />
        {photos.length > 1 ? (
          <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
            {mt("photoCount", { count: photos.length })}
          </span>
        ) : null}
      </div>

      {/* Desktop: hero + side grid */}
      <div
        className={cn(
          "relative hidden overflow-hidden bg-[#F3F1EF] sm:grid sm:h-[240px] sm:gap-1",
          count === 1 && "sm:grid-cols-1",
          count === 2 && "sm:grid-cols-2",
          count === 3 && "sm:grid-cols-2 sm:grid-rows-2",
          count >= 4 && "sm:grid-cols-4 sm:grid-rows-2",
        )}
      >
        {preview.map((url, index) => {
          const isHero = count >= 3 && index === 0;
          // When the see-all tile owns the spare cell, don't also overlay "+N" on the last photo.
          const showExtra = extra > 0 && !showSeeAllTile && index === preview.length - 1;
          return (
            <div
              key={`${url}-${index}`}
              className={cn(
                "relative min-h-0 overflow-hidden bg-muted",
                isHero && count === 3 && "sm:row-span-2",
                isHero && count >= 4 && "sm:col-span-2 sm:row-span-2",
              )}
            >
              <SmartImage
                src={getR2ProxyUrl(url)}
                alt={index === 0 ? kitchenName : ""}
                className="h-full w-full object-cover"
                hideOnError
              />
              {showExtra ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-semibold text-white">
                  +{extra}
                </span>
              ) : null}
            </div>
          );
        })}
        {showSeeAllTile ? (
          <div
            className="relative min-h-0 overflow-hidden bg-[#1A1A1A]"
            aria-label={mt("photoCount", { count: photos.length })}
          >
            {lastPreview ? (
              <SmartImage
                src={getR2ProxyUrl(lastPreview)}
                alt=""
                className="absolute inset-0 h-full w-full scale-125 object-cover opacity-50 blur-sm"
                hideOnError
              />
            ) : null}
            <span className="absolute inset-0 bg-black/55" aria-hidden />
            <span className="relative z-10 flex h-full flex-col items-center justify-center gap-1 p-3 text-center text-white">
              <ImageIcon className="mb-0.5 h-5 w-5" />
              <span className="text-sm font-bold leading-tight">
                {mt("photoCount", { count: photos.length })}
              </span>
            </span>
          </div>
        ) : null}
      </div>

      {badge ? <div className="absolute left-3 top-3 z-10">{badge}</div> : null}
    </div>
  );
}
export default function CreateKitchenStep() {
  
  const {
    kitchens,
    kitchenForm,
    createKitchen,
    updateKitchen,
    handleNext,
    handleBack,
    isFirstStep,
    selectedLocationId,
    selectedKitchenId,
    equipmentForm,
    storageForm,
    setUnsavedChanges,
    registerStepSave,
    saveAndExit,
    isSubmitting,
  } = useManagerOnboarding();

  const { data: ctxData, setData, showCreate, setShowCreate, isCreating } = kitchenForm;
  const { toast } = useToast();
  // Cover upload for the form below — the field itself is the shared Photos-tab one.
  const { uploadFile: uploadCoverFile } = useSessionFileUpload({
    allowedTypes: ACCEPTED_IMAGE_TYPES,
    onError: (message) => toast({ title: mt("uploadFailed2"), description: message, variant: "destructive" }),
  });
  const uploadCover = async (file: File) => {
    const result = await uploadCoverFile(file, "kitchen-covers");
    if (result?.url) setLocalImageUrl(result.url);
  };
  // Which kitchen the form is editing; null means the form is creating a new one.
  const [editingKitchenId, setEditingKitchenId] = useState<number | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  /**
   * The kitchen's values at the moment the edit form opened, serialised. The
   * Save button compares the live fields against this so it only appears once
   * something actually changed — opening a kitchen and closing it again is not
   * unsaved work.
   */
  const [editSnapshot, setEditSnapshot] = useState<string | null>(null);
  /** Which of the three parts is showing. Part 0 owns the kitchen itself. */
  const { activePart, isSummary, editPart, goToPart, goNext, goBack } = useStepParts({
    // `kitchens.length > 0` is both the completeness signal and the readiness one: it only
    // becomes true once the fetch has landed, so there is nothing to wait for separately.
    isComplete: kitchens.length > 0,
    isReady: kitchens.length > 0,
    partCount: PART_COUNT,
  });
  // Continuing to a shorter part used to leave you mid-page.
  const scrollRef = useScrollToTopOnChange(activePart);


  // LOCAL state for form fields — prevents context re-renders causing focus loss on every keystroke.
  // We sync FROM context when the form opens, and sync TO context just before submit.
  const [localName, setLocalName] = useState(ctxData.name);
  const [localDescription, setLocalDescription] = useState(ctxData.description);
  const [localHourlyRate, setLocalHourlyRate] = useState(ctxData.hourlyRate);
  const [localDailyRate, setLocalDailyRate] = useState(ctxData.dailyRate ?? '');
  const [localMinHours, setLocalMinHours] = useState(ctxData.minimumBookingHours);
  const [localImageUrl, setLocalImageUrl] = useState(ctxData.imageUrl);
  const [localFeatures, setLocalFeatures] = useState<string[]>(ctxData.features || []);

  // Sync local state from context whenever the form is opened (showCreate flips to true).
  // Only the *create* form mirrors the context draft — opening for an edit seeds the
  // fields from the kitchen itself, and this effect would otherwise wipe them.
  const prevShowCreate = useRef(showCreate);
  useEffect(() => {
    if (showCreate && !prevShowCreate.current && editingKitchenId === null) {
      setLocalName(ctxData.name);
      setLocalDescription(ctxData.description);
      setLocalHourlyRate(ctxData.hourlyRate);
      setLocalDailyRate(ctxData.dailyRate ?? '');
      setLocalMinHours(ctxData.minimumBookingHours);
      setLocalImageUrl(ctxData.imageUrl);
      setLocalFeatures(ctxData.features || []);
    }
    prevShowCreate.current = showCreate;
  }, [showCreate]);

  // Ref to signal that we want to create the kitchen after syncing local → context
  const pendingCreateRef = useRef(false);

  /**
   * Load an existing kitchen into the form and start tracking it for changes.
   *
   * This is what makes part 0 an EDITOR rather than a one-shot create form: the summary's
   * Edit action, and simply arriving on the part with a kitchen already there, both land
   * here. The snapshot is what the footer's Save compares against.
   */
  const handleStartEdit = (kitchen: any) => {
    // Seed from one object so the snapshot and the form fields can never drift:
    // both are built from `seed`, in the same key order.
    const seed = {
      name: kitchen.name ?? '',
      description: kitchen.description ?? '',
      hourlyRate: kitchen.hourlyRate ? (Number(kitchen.hourlyRate) / 100).toFixed(2) : '',
      dailyRate: kitchen.dailyRate ? (Number(kitchen.dailyRate) / 100).toFixed(2) : '',
      minimumBookingHours: String(kitchen.minimumBookingHours ?? 1),
      imageUrl: kitchen.imageUrl ?? '',
      features: kitchen.amenities ?? kitchen.features ?? [],
    };
    setEditingKitchenId(kitchen.id);
    setLocalName(seed.name);
    setLocalDescription(seed.description);
    setLocalHourlyRate(seed.hourlyRate);
    setLocalDailyRate(seed.dailyRate);
    setLocalMinHours(seed.minimumBookingHours);
    setLocalImageUrl(seed.imageUrl);
    setLocalFeatures(seed.features);
    setEditSnapshot(JSON.stringify(seed));
  };

  /** Leave the editor without saving. */
  const handleCancelEdit = () => {
    setEditingKitchenId(null);
    setEditSnapshot(null);
  };

  /**
   * Part 0 shows a kitchen's details as an editable form, so load the kitchen in.
   *
   * Runs ONCE per kitchen, keyed on its id: re-running on every render would overwrite
   * whatever the manager is typing, and re-running whenever `kitchens` changes identity
   * would do the same immediately after a save.
   */
  const seededKitchenId = useRef<number | null>(null);
  useEffect(() => {
    const kitchen = kitchens[0];
    if (activePart !== 0 || !kitchen || seededKitchenId.current === kitchen.id) return;
    seededKitchenId.current = kitchen.id;
    // The kitchen exists now, so the form is driven by that rather than by the create
    // flag — and leaving the flag set would make `formHasContent` report unsaved work for
    // ever, since a create form with anything in it counts as dirty.
    setShowCreate(false);
    handleStartEdit(kitchen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePart, kitchens]);

  const closeForm = () => {
    setEditingKitchenId(null);
    setEditSnapshot(null);
    setShowCreate(false);
  };

  // Flush local state to context and then create. Create-only: edits are saved
  // from inside the card, never from this form.
  const handleCreate = () => {
    pendingCreateRef.current = true;
    setData({
      name: localName,
      description: localDescription,
      hourlyRate: localHourlyRate,
      dailyRate: localDailyRate,
      currency: ctxData.currency,
      minimumBookingHours: localMinHours,
      imageUrl: localImageUrl,
      features: localFeatures,
    });
  };

  /**
   * The edit form's rules are the CREATE form's rules.
   *
   * Create mode refuses to submit without a name, description, cover photo, hourly rate and a
   * minimum of at least one hour. Edit mode then rendered no gate at all — `handleSaveEdit` sent
   * whatever the form held — so a kitchen that was already set up could have its price blanked and
   * saved, which is how a completed step was allowed to become invalid. One rule set for both
   * modes; the create button carries the same expression inline.
   */
  const editIsValid =
    Boolean(localName.trim()) &&
    Boolean(localDescription.trim()) &&
    Boolean(localImageUrl) &&
    Boolean(localHourlyRate) &&
    parseInt(localMinHours, 10) >= 1;

  /** Save edits to a kitchen created earlier in this flow — no dashboard hop. */
  const handleSaveEdit = async (): Promise<boolean> => {
    if (editingKitchenId === null) return false;
    if (!editIsValid) {
      toast({
        title: mt("stepNeedsAttentionTitle"),
        description: mt("kitchenPartListingIncomplete"),
        variant: "destructive",
      });
      return false;
    }
    setIsSavingEdit(true);
    try {
      await updateKitchen(editingKitchenId, {
        name: localName,
        description: localDescription,
        hourlyRate: localHourlyRate,
        dailyRate: localDailyRate,
        minimumBookingHours: localMinHours,
        imageUrl: localImageUrl,
      });
      toast({ title: mt("success"), description: mt("kitchenDetailsUpdated") });
      // Leave the editor but keep the card open — the manager can carry on with
      // its photos straight away.
      handleCancelEdit();
      return true;
    } catch (error: any) {
      toast({ title: mt("error"), description: error.message, variant: "destructive" });
      return false;
    } finally {
      setIsSavingEdit(false);
    }
  };

  /**
   * True once an edit form's fields differ from the snapshot taken when it
   * opened. Key order matches `seed` in `handleStartEdit` so the two strings are
   * comparable. Always false for the create form, which has no baseline.
   */
  const isEditDirty = editingKitchenId !== null && editSnapshot !== null && editSnapshot !== JSON.stringify({
    name: localName,
    description: localDescription,
    hourlyRate: localHourlyRate,
    dailyRate: localDailyRate,
    minimumBookingHours: localMinHours,
    imageUrl: localImageUrl,
    features: localFeatures,
  });

  /**
   * Continue, part by part.
   *
   * Part 0 owns the inline editor, so the button saves it before moving — advancing used
   * to call `handleNext` directly, which left the edit behind. Parts 1 and 2 have nothing
   * to save of their own: their content is the dashboard inventory, which writes as it
   * goes. Only the LAST part advances the wizard.
   */
  const handlePartContinue = async () => {
    if (activePart === 0 && editingKitchenId !== null && isEditDirty) {
      const saved = await handleSaveEdit();
      if (!saved) return;
    }
    // The review screen is last; only IT moves the wizard on.
    if (isSummary) {
      await handleNext();
      return;
    }
    goNext();
  };

  /**
   * Leaving a part is a commit boundary, exactly like Continue — see `LocationStep` for the full
   * reasoning. Back saves a changed part when it is valid and refuses to leave one that is not,
   * so the review (which reads the saved record) can never describe a state the record does not
   * hold, and a completed step cannot be stripped of a required field on the way out.
   */
  const handlePartBack = async () => {
    if (activePart === 0 && editingKitchenId !== null && isEditDirty) {
      const saved = await handleSaveEdit();
      if (!saved) return;
    }
    if (goBack()) return;
    handleBack();
  };

  /** Whether the kitchen this step is about exists yet. Part 0 is the only part that cares. */
  const hasKitchen = kitchens.length > 0;

  /**
   * The kitchen parts 2 and 3 hang their listings on. The wizard creates one kitchen and
   * the context auto-selects the first, so this is normally the one just created; the
   * fallback covers the frame before that selection lands.
   */
  const listingKitchenId = selectedKitchenId ?? (kitchens[0]?.id ?? null);

  /** Names for the recap, capped there. Both listing shapes are tolerated. */
  const equipmentNames = (equipmentForm?.listings ?? []).map(
    (l: any) => l.equipmentType || l.name || mt("untitledItem"),
  );
  const storageNames = (storageForm?.listings ?? []).map(
    (l: any) => l.name || mt("untitledItem"),
  );

  const partHeading = [
    { title: mt("kitchenPartListingTitle"), description: mt("kitchenPartListingDesc") },
    { title: mt("kitchenPartEquipmentTitle"), description: mt("kitchenPartEquipmentDesc") },
    { title: mt("kitchenPartStorageTitle"), description: mt("kitchenPartStorageDesc") },
    { title: mt("kitchenSummaryTitle"), description: mt("kitchenSummaryDesc") },
  ][activePart];

  /**
   * Unsaved work in this step, from either surface:
   * - the inline editor counts only once a field actually changed (opening it is
   *   not unsaved work);
   * - the create form counts as soon as it holds anything, since it has no
   *   baseline to compare against.
   */
  const formHasContent =
    (editingKitchenId !== null && isEditDirty) ||
    (showCreate && Boolean(
      localName.trim() ||
      localDescription.trim() ||
      localHourlyRate ||
      localDailyRate ||
      localImageUrl ||
      localMinHours !== '1'
    ));

  useEffect(() => {
    setUnsavedChanges(formHasContent);
  }, [formHasContent, setUnsavedChanges]);

  useEffect(() => {
    // Only an existing kitchen can be saved from here; a half-filled create form
    // is discarded, not saved, so the dialog offers Cancel / Discard for it.
    registerStepSave(async () => {
      if (editingKitchenId === null) return false;
      return handleSaveEdit();
    });
    return () => registerStepSave(null);
    // The field values are deps on purpose: `handleSaveEdit` reads them from the
    // closure, so without them a re-registration would only happen when the
    // *kitchen* changes — and a save triggered from the leave-dialog would write
    // whatever was in the fields when editing began.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    registerStepSave,
    editingKitchenId,
    localName,
    localDescription,
    localHourlyRate,
    localDailyRate,
    localMinHours,
    localImageUrl,
  ]);

  // After ctxData updates from handleCreate, fire createKitchen once, then move on.
  //
  // Create AND continue. Staying on the form with a Continue button made the button's job
  // ambiguous — the kitchen was already made, so "Continue" read as "did that work?" — and
  // it left the manager staring at a form they had finished. Creating it is the answer, so
  // the step moves to what goes in the kitchen.
  useEffect(() => {
    if (!pendingCreateRef.current) return;
    pendingCreateRef.current = false;
    void (async () => {
      try {
        await createKitchen();
        // Clear the create flag: a create form holding anything counts as unsaved work, so
        // leaving it set would report changes that no longer exist.
        setShowCreate(false);
        goToPart(1);
      } catch {
        // `createKitchen` raises its own toast; staying on the form is the honest response.
      }
    })();
  }, [ctxData]);

  // Expose a data object matching the old shape for the JSX below
  const data = {
    name: localName,
    description: localDescription,
    hourlyRate: localHourlyRate,
    dailyRate: localDailyRate,
    currency: ctxData.currency,
    minimumBookingHours: localMinHours,
    imageUrl: localImageUrl,
    features: localFeatures,
  };

  return (
    <div ref={scrollRef} className="space-y-6 animate-in fade-in duration-500">
      {/* Part progress — three dots, so the manager always knows how much is left. */}
      <div className="flex items-center gap-3">
        <div
          className="flex items-center gap-1.5"
          role="group"
          aria-label={mt("businessStepProgress", { current: Math.min(activePart + 1, PART_COUNT), total: PART_COUNT })}
        >
          {Array.from({ length: PART_COUNT }, (_, index) => (
            <span
              key={index}
              aria-hidden
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                index === activePart
                  ? "w-6 bg-primary"
                  : index < activePart
                    ? "w-1.5 bg-primary/50"
                    : "w-1.5 bg-muted-foreground/25",
              )}
            />
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {mt("businessStepProgress", { current: Math.min(activePart + 1, PART_COUNT), total: PART_COUNT })}
        </span>
      </div>

      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{partHeading.title}</h2>
        <p className="text-sm text-muted-foreground">{partHeading.description}</p>
      </div>

      {activePart === 0 && (
        <>
      {/*
       * No finished-kitchen card here. The collage used to appear the moment the kitchen
       * was created, which put the step's most elaborate surface in the middle of the flow
       * and then repeated it. It now appears once, at the end, alongside what parts 2 and 3
       * added — and the form below is what this part is: the fields, editable, with the
       * footer's Save & continue when anything changed.
       */}
      {/* Empty State - Enterprise Design */}
      {kitchens.length === 0 && !showCreate && (
        <Card className={cn(
          "border-2 border-dashed border-border bg-muted/20",
          CARD_RADIUS,
        )}>
          <CardContent className="py-14 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F3F1EF] ring-1 ring-[#2C2C2C]/[0.06]">
              <ImageIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-bold text-[#1A1A1A]">{mt("createYourKitchenSpace")}</h3>
            <p className="mx-auto mb-6 max-w-sm text-sm leading-relaxed text-muted-foreground">{mt("setUpYourFirstKitchenToStartReceivingBookingRequestsFromChef")}</p>
            <Button onClick={() => setShowCreate(true)} size="lg">
              <Plus className="mr-2 h-4 w-4" />{mt("createKitchenSpace")}</Button>
          </CardContent>
        </Card>
      )}

      {/*
       * The form is this part, open either because the manager asked to create one or
       * because a kitchen already exists and this is where its details live. Coming back
       * to it from the summary's Edit lands here, pre-filled, with the footer offering
       * "Save & continue" the moment anything changes.
       */}
      {(showCreate || hasKitchen) && (
        <Card className={cn(
          "animate-in fade-in zoom-in-95 border-0 duration-200 shadow-[0_8px_30px_rgba(44,44,44,0.07)] ring-1 ring-[#2C2C2C]/[0.05]",
          CARD_RADIUS,
        )}>
          <CardContent className="divide-y divide-border p-0">
            <div className="px-4 pt-3">
              <FormLegend />
            </div>

            <SettingsRow id="kitchen-name" label={mt("kitchenName")} required>
              <Input
                id="kitchen-name"
                value={data.name}
                onChange={(e) => setLocalName(e.target.value)}
                placeholder={mt("eGMainKitchenPrepAreaBakeryStation")}
                className="w-64"
              />
            </SettingsRow>

            <SettingsRow
              id="kitchen-description"
              label={mt("description")}
              required
              layout="stacked"
              hint={mt("describeYourKitchenSpaceEquipmentAndWhatMakesItSpecialForChe")}
            >
              <Textarea
                id="kitchen-description"
                value={data.description}
                onChange={(e) => setLocalDescription(e.target.value)}
                rows={3}
                className="max-w-lg resize-none"
              />
            </SettingsRow>

            <SettingsRow
              label={mt("coverPhoto")}
              required
              layout="stacked"
              hint={mt("aGreatCoverPhotoHelpsAttractMoreChefsToYourSpace")}
            >
              {/*
                * A field, not a gallery. At `max-w-md` the 16:9 preview stood 252px tall —
                * taller than the five rows around it put together, which is why this row
                * read as a section of its own. `max-w-xs` keeps a real preview of the crop
                * at 180px and lets the form read as one column.
                */}
              <div>
                <CoverPhotoField
                  value={data.imageUrl}
                  onSelectFile={(file) => void uploadCover(file)}
                  onRemove={() => setLocalImageUrl('')}
                  disabled={isCreating}
                  className="w-full max-w-xs"
                />
                {/*
                  * The cover is the one photo onboarding asks for: it is what search
                  * results show, and a listing cannot go live without it. The gallery is
                  * real work with no gate on it, so it belongs where a manager has time
                  * for it rather than in the middle of setup.
                  */}
                <p className="mt-2 text-xs text-muted-foreground">{mt("addMorePhotosFromMyKitchens")}</p>
              </div>
            </SettingsRow>

            <SettingsRow id="kitchen-rate" label={mt("hourlyRateCAD")} required>
              <CurrencyInput
                id="kitchen-rate"
                value={data.hourlyRate}
                onValueChange={setLocalHourlyRate}
                placeholder="25.00"
                className="w-32"
              />
            </SettingsRow>

            <SettingsRow id="kitchen-daily-rate" label={mt("dailyRateCAD")}>
              <CurrencyInput
                id="kitchen-daily-rate"
                value={data.dailyRate}
                onValueChange={setLocalDailyRate}
                placeholder="150.00"
                className="w-32"
              />
            </SettingsRow>

            {/*
              * Required, and one hour is the floor. Zero is not a minimum booking — it is
              * the absence of one, and it reached the database as a real value because the
              * blank field was sent as `parseInt('') || 0`. A booking with no minimum is a
              * booking the manager never agreed to.
              */}
            <SettingsRow id="kitchen-minimum" label={mt("minimumBooking")} required>
              <NumericInput
                id="kitchen-minimum"
                value={data.minimumBookingHours}
                onValueChange={(val) => {
                  if (val === '') {
                    setLocalMinHours('');
                    return;
                  }
                  const parsed = parseInt(val, 10);
                  if (!isNaN(parsed) && parsed >= 1 && parsed <= 24) {
                    setLocalMinHours(String(parsed));
                  }
                }}
                placeholder="1"
                suffix={mt("hoursSuffix")}
                className="w-32"
              />
            </SettingsRow>
          </CardContent>

            {/*
              * Create-mode actions only. Once the kitchen exists this form is an editor,
             * and the footer owns the save — one action surface, and it already reads
             * "Save & continue" the moment anything changed.
             */}
            {!hasKitchen && (
              <div className="flex gap-3 border-t border-border p-4">
                <StatusButton
                  status={isCreating ? "loading" : "idle"}
                  onClick={handleCreate}
                  disabled={
                    !data.name.trim() ||
                    !data.description.trim() ||
                    !data.imageUrl ||
                    !data.hourlyRate ||
                    // 1 is the floor — see the field above.
                    !(parseInt(data.minimumBookingHours, 10) >= 1)
                  }
                  className="flex-1"
                  labels={{ idle: mt("createKitchenAndContinue"), loading: mt("creating"), success: mt("created") }}
                />
                <Button
                  variant="outline"
                  onClick={closeForm}
                  disabled={isCreating}
                  className="text-muted-foreground"
                >{mt("cancel")}</Button>
              </div>
            )}
        </Card>
      )}

        </>
      )}

      {/*
       * Parts 2 and 3 are the dashboard's own inventory surfaces, rendered `embedded` so
       * they drop their duplicate heading and un-pin their commit bar. The part heading
       * above is what names them, and its description carries the two things a manager
       * needs to hear when they have nothing to add: this is optional, and My Kitchens
       * will still be there later.
       */}
      {activePart === 1 && (
        <EquipmentListingContent
          embedded
          selectedLocationId={selectedLocationId}
          selectedKitchenId={listingKitchenId}
        />
      )}

      {activePart === 2 && (
        <StorageListingContent
          embedded
          selectedLocationId={selectedLocationId}
          selectedKitchenId={listingKitchenId}
        />
      )}

      {/*
       * The review, on its own screen after the three parts. It used to hang off the bottom
       * of the storage inventory, which buried it: the manager finished the work and the
       * step's closing statement was below the fold of an inventory they had just edited.
       */}
      {isSummary && (
        <ListingSummary
          kitchen={kitchens[0]}
          equipment={equipmentNames}
          storage={storageNames}
          onEdit={editPart}
        />
      )}

      {/*
       * Navigation Footer. Hidden only while part 0's create form is open — that form
       * has its own Create / Cancel pair, and two footers would compete.
       */}
      {!(activePart === 0 && showCreate) && (
        <OnboardingNavigationFooter
          onNext={() => void handlePartContinue()}
          onBack={() => void handlePartBack()}
          onSaveAndExit={() => void saveAndExit()}
          /* No Back on the review: each group's Edit already opens the part it names, and
             the kitchen's own heading Edit opens part 1. */
          showBack={!isSummary && (!isFirstStep || activePart > 0)}
          // The label has to match what the button does — part 0 saves the editor first.
          nextLabel={activePart === 0 && isEditDirty ? mt("saveAndContinue") : tt("continue")}
          // The exit action only promises a save when there is one to make.
          hasUnsavedWork={formHasContent}
          // Only part 0 can block: parts 2 and 3 are optional by design, so an empty
          // inventory is a valid answer rather than an unfinished one.
          isNextDisabled={
            isSavingEdit ||
            (activePart === 0 && kitchens.length === 0) ||
            // Only a form the manager has CHANGED into an invalid state blocks. A gap that was
            // already there when the editor opened has nothing to save, so it blocks nothing.
            (activePart === 0 && isEditDirty && !editIsValid)
          }
          incompleteReason={
            activePart === 0 && isEditDirty && !editIsValid ? mt("kitchenPartListingIncomplete") : undefined
          }
          isLoading={isSavingEdit}
          isSavingAndExiting={isSubmitting}
        />
      )}
    </div>
  );
}
