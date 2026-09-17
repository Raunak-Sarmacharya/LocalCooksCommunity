import React, { useState, useEffect, useRef } from "react";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import {
  CheckCircle,
  Plus,
  Edit2,
  ChevronDown,
  ChevronUp,
  Clock,
  Image as ImageIcon,
} from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CARD_RADIUS, Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { SettingsRow } from "@/components/manager/settings/SettingsRow";
import { CurrencyInput } from "@/components/ui/currency-input";
import { NumericInput } from "@/components/ui/numeric-input";
import { KitchenGalleryImages } from "@/components/manager/kitchen/KitchenGalleryImages";
import { KitchenPhotoPlaceholder } from "@/components/kitchen/KitchenPhotoPlaceholder";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";
import { UnsavedChangesDialog } from "@/components/manager/UnsavedChangesDialog";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import {
  ACCEPTED_IMAGE_TYPES,
  CoverPhotoField,
  CoverPhotoTile,
} from "@/components/manager/kitchen/KitchenPhotoFields";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { SmartImage } from "@/components/ui/smart-image";
import { FormLegend } from "@/components/ui/form-legend";


/** The fields the inline editor and the create form both own. */
interface KitchenDraft {
  name: string;
  description: string;
  hourlyRate: string;
  dailyRate: string;
  minimumBookingHours: string;
  imageUrl: string;
}

/**
 * Something the manager asked for that would hide the inline editor: collapsing
 * its card, editing another kitchen, or starting a new one.
 */
type PendingKitchenIntent =
  | { kind: 'collapse' }
  | { kind: 'edit'; kitchen: any }
  | { kind: 'create' };

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

// Enterprise-grade Kitchen Card Component
interface KitchenCardProps {
  kitchen: any;
  isExpanded: boolean;
  onToggle: () => void;
  /** This card is the one being edited. */
  isEditing: boolean;
  draft: KitchenDraft;
  onDraftChange: (patch: Partial<KitchenDraft>) => void;
  /** Edit draft differs from the values the card opened with. */
  isDirty: boolean;
  isSaving: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  /**
   * Called instead of collapsing when the editor holds unsaved changes, so the
   * manager is asked to save or discard them first.
   */
  onDirtyCollapseAttempt: () => void;
  onCoverSelect: (file: File) => void;
  locationId: number | null;
}

function KitchenCard({
  kitchen,
  isExpanded,
  onToggle,
  isEditing,
  draft,
  onDraftChange,
  isDirty,
  isSaving,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDirtyCollapseAttempt,
  onCoverSelect,
  locationId,
}: KitchenCardProps) {
  const photos = collectKitchenPhotos(
    kitchen,
    isEditing ? draft.imageUrl : undefined,
  );
  const hasImage = photos.length > 0;
  const hourly = formatCentsAsDollars(kitchen.hourlyRate);
  const daily = formatCentsAsDollars(kitchen.dailyRate);
  const photoCount = photos.length;

  /**
   * What the summary cannot show, so the card can say so without being opened.
   * Only the fields a listing genuinely needs — a missing daily rate is a
   * choice, not an omission.
   */
  const missingDetails = [
    !kitchen.description?.trim(),
    !hasImage,
    !kitchen.hourlyRate,
  ].filter(Boolean).length;

  const statusBadge = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur-sm",
        missingDetails > 0
          ? "bg-white/95 text-amber-800 ring-1 ring-amber-200/80"
          : "bg-white/95 text-emerald-800 ring-1 ring-emerald-200/80",
      )}
    >
      {missingDetails > 0 ? (
        mt("kitchenDetailsMissing", { count: missingDetails })
      ) : (
        <>
          <CheckCircle className="h-3.5 w-3.5" />
          {mt("kitchenListingComplete")}
        </>
      )}
    </span>
  );

  const handleToggle = () => {
    // Collapsing hides the editor, so unsaved changes need save-or-discard first.
    if (isEditing && isDirty) {
      onDirtyCollapseAttempt();
      return;
    }
    onToggle();
  };

  return (
    <Card
      className={cn(
        "overflow-hidden border-0 shadow-[0_8px_30px_rgba(44,44,44,0.07)] ring-1 ring-[#2C2C2C]/[0.05]",
        CARD_RADIUS,
      )}
    >
      <Collapsible open={isExpanded} onOpenChange={() => { if (!isEditing) onToggle(); }}>
        {/* Photos lead — same hierarchy as the public kitchen listing. */}
        <KitchenListingGallery
          photos={photos}
          kitchenName={isEditing ? draft.name || kitchen.name : kitchen.name}
          badge={statusBadge}
        />

        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {isEditing ? (
                <Input
                  value={draft.name}
                  onChange={(e) => onDraftChange({ name: e.target.value })}
                  aria-label={mt("kitchenName")}
                  placeholder={mt("eGMainKitchenPrepAreaBakeryStation")}
                  className="h-10 max-w-md text-lg font-semibold"
                />
              ) : (
                <h3 className="truncate text-lg font-bold tracking-tight text-[#1A1A1A] sm:text-xl">
                  {kitchen.name}
                </h3>
              )}

              {!isEditing && (
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
                  <span
                    className={cn(
                      "tabular-nums font-bold",
                      hourly ? "text-[#F51042]" : "text-muted-foreground",
                    )}
                  >
                    {hourly ? `${hourly}/hr` : mt("notSet")}
                  </span>
                  {daily ? (
                    <>
                      <span className="text-muted-foreground/50" aria-hidden>·</span>
                      <span className="tabular-nums font-medium text-foreground">
                        {daily}/day
                      </span>
                    </>
                  ) : null}
                  <span className="text-muted-foreground/50" aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    {kitchen.minimumBookingHours
                      ? `${kitchen.minimumBookingHours} ${mt("hoursSuffix")}`
                      : mt("notSet")}
                  </span>
                  <span className="text-muted-foreground/50" aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <ImageIcon className="h-3.5 w-3.5" />
                    {photoCount > 0
                      ? mt("photoCount", { count: photoCount })
                      : mt("notSet")}
                  </span>
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {isEditing ? (
                isDirty ? (
                  <>
                    <StatusButton
                      status={isSaving ? "loading" : "idle"}
                      onClick={onSaveEdit}
                      disabled={!draft.name.trim() || !draft.description.trim()}
                      labels={{ idle: mt("saveChanges"), loading: mt("savingShort"), success: mt("saved") }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onCancelEdit}
                      disabled={isSaving}
                      className="text-muted-foreground"
                    >{mt("cancel")}</Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onCancelEdit}
                    disabled={isSaving}
                    className="text-muted-foreground hover:bg-muted hover:text-foreground"
                  >{mt("close")}</Button>
                )
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-border bg-white text-foreground shadow-sm hover:bg-muted"
                  onClick={onStartEdit}
                >
                  <Edit2 className="h-3.5 w-3.5" />
                  {mt("editDetails")}
                </Button>
              )}
              <button
                type="button"
                aria-label={isExpanded ? mt("collapseCard") : mt("expandCard")}
                onClick={handleToggle}
                className={cn(
                  "flex h-9 w-9 !min-h-0 !min-w-0 items-center justify-center rounded-full border border-border bg-white shadow-sm transition-colors hover:bg-muted",
                  isExpanded && "bg-muted",
                )}
              >
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            </div>
          </div>
        </div>

        <CollapsibleContent>
          <div className="border-t border-border">
            {isEditing ? (
              <div className="divide-y divide-border">
                <SettingsRow
                  id={`kitchen-edit-description-${kitchen.id}`}
                  label={mt("description")}
                  required
                  layout="stacked"
                  hint={mt("describeYourKitchenSpaceEquipmentAndWhatMakesItSpecialForChe")}
                >
                  <Textarea
                    id={`kitchen-edit-description-${kitchen.id}`}
                    value={draft.description}
                    onChange={(e) => onDraftChange({ description: e.target.value })}
                    rows={3}
                    className="max-w-lg resize-none"
                  />
                </SettingsRow>

                <SettingsRow id={`kitchen-edit-rate-${kitchen.id}`} label={mt("hourlyRateCAD")} required>
                  <CurrencyInput
                    id={`kitchen-edit-rate-${kitchen.id}`}
                    value={draft.hourlyRate}
                    onValueChange={(value) => onDraftChange({ hourlyRate: value })}
                    placeholder="25.00"
                    className="w-32"
                  />
                </SettingsRow>

                <SettingsRow id={`kitchen-edit-daily-${kitchen.id}`} label={mt("dailyRateCAD")}>
                  <CurrencyInput
                    id={`kitchen-edit-daily-${kitchen.id}`}
                    value={draft.dailyRate}
                    onValueChange={(value) => onDraftChange({ dailyRate: value })}
                    placeholder="150.00"
                    className="w-32"
                  />
                </SettingsRow>

                <SettingsRow id={`kitchen-edit-minimum-${kitchen.id}`} label={mt("minimumBooking")}>
                  <NumericInput
                    id={`kitchen-edit-minimum-${kitchen.id}`}
                    value={draft.minimumBookingHours}
                    onValueChange={(value) => onDraftChange({ minimumBookingHours: value })}
                    placeholder="1"
                    suffix={mt("hoursSuffix")}
                    className="w-32"
                  />
                </SettingsRow>
              </div>
            ) : (
              <div className="px-4 py-4 sm:px-5">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{mt("description")}</Label>
                <p className="mt-1.5 text-sm leading-relaxed text-foreground">
                  {kitchen.description || mt("noDescriptionProvidedYet")}
                </p>
              </div>
            )}

            {isEditing && (
              <div className="border-t border-border p-4 sm:p-5">
                <Label className="mb-3 block text-xs font-medium uppercase tracking-wide text-muted-foreground">{mt("photos")}</Label>
                <KitchenGalleryImages
                  kitchenId={kitchen.id}
                  galleryImages={kitchen.galleryImages || []}
                  locationId={locationId as number}
                  coverSlot={
                    <CoverPhotoTile
                      value={draft.imageUrl}
                      onSelectFile={onCoverSelect}
                      onRemove={() => onDraftChange({ imageUrl: '' })}
                      className="sm:col-span-2"
                    />
                  }
                />
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
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
  const [expandedKitchenId, setExpandedKitchenId] = useState<number | null>(null);
  /**
   * The kitchen's values at the moment the edit form opened, serialised. The
   * Save button compares the live fields against this so it only appears once
   * something actually changed — opening a kitchen and closing it again is not
   * unsaved work.
   */
  const [editSnapshot, setEditSnapshot] = useState<string | null>(null);
  /**
   * Something the manager asked for that would hide the inline editor. Held here
   * while the editor has unsaved changes, so the dialog can offer save or
   * discard first. Without it, collapsing, switching cards or starting a new
   * kitchen would silently drop the edits.
   */
  const [pendingIntent, setPendingIntent] = useState<PendingKitchenIntent | null>(null);


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

  /** Load an existing kitchen into the inline editor and open its card. */
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
    // Editing happens inside this card, so make sure it is open. The separate
    // form below is create-only now.
    setExpandedKitchenId(kitchen.id);
  };

  /** Leave the inline editor without saving. */
  const handleCancelEdit = () => {
    setEditingKitchenId(null);
    setEditSnapshot(null);
  };

  const closeForm = () => {
    setEditingKitchenId(null);
    setEditSnapshot(null);
    setShowCreate(false);
  };

  /** One setter for the inline editor's six fields. */
  const handleDraftChange = (patch: Partial<KitchenDraft>) => {
    if (patch.name !== undefined) setLocalName(patch.name);
    if (patch.description !== undefined) setLocalDescription(patch.description);
    if (patch.hourlyRate !== undefined) setLocalHourlyRate(patch.hourlyRate);
    if (patch.dailyRate !== undefined) setLocalDailyRate(patch.dailyRate);
    if (patch.minimumBookingHours !== undefined) setLocalMinHours(patch.minimumBookingHours);
    if (patch.imageUrl !== undefined) setLocalImageUrl(patch.imageUrl);
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

  /** Save edits to a kitchen created earlier in this flow — no dashboard hop. */
  const handleSaveEdit = async (): Promise<boolean> => {
    if (editingKitchenId === null) return false;
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

  /** Carry out an intent that hides the editor. */
  const applyIntent = (intent: PendingKitchenIntent) => {
    setPendingIntent(null);
    if (intent.kind === 'collapse') {
      setExpandedKitchenId(null);
      return;
    }
    if (intent.kind === 'edit') {
      handleStartEdit(intent.kitchen);
      return;
    }
    handleCancelEdit();
    setShowCreate(true);
  };

  /**
   * Run an intent now, or park it behind the unsaved-changes dialog when the
   * editor holds edits. Every route that would hide the editor goes through
   * here, so none of them can drop the draft on the floor.
   */
  const requestIntent = (intent: PendingKitchenIntent) => {
    if (editingKitchenId !== null && isEditDirty) {
      setPendingIntent(intent);
      return;
    }
    applyIntent(intent);
  };

  /**
   * Continue is "Save & continue" while the inline editor holds changes.
   *
   * Advancing used to call `handleNext` directly, which left the edit behind —
   * the button promised to save and didn't. On failure we stay put rather than
   * advancing, because moving on would strand the edits on a card the manager
   * has already left; the toast explains what went wrong.
   */
  const handleContinue = async () => {
    if (editingKitchenId !== null && isEditDirty) {
      const saved = await handleSaveEdit();
      if (!saved) return;
    }
    await handleNext();
  };

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

  // After ctxData updates from handleCreate, fire createKitchen once
  useEffect(() => {
    if (pendingCreateRef.current) {
      pendingCreateRef.current = false;
      createKitchen();
    }
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

  const handleToggleExpand = (kitchenId: number) => {
    setExpandedKitchenId(prev => prev === kitchenId ? null : kitchenId);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Existing Kitchens - Success State */}
      {kitchens.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-border/80 bg-muted/30 px-4 py-3.5">
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {kitchens.length} kitchen{kitchens.length > 1 ? 's' : ''} configured
              </span>
              {' '}— This is how chefs will see your space. Edit details anytime, or expand for the full description.
            </p>
          </div>

          {/* Kitchen Cards */}
          <div className="space-y-4">
            {kitchens.map((kitchen: any) => (
              <KitchenCard
                key={kitchen.id}
                kitchen={kitchen}
                isExpanded={expandedKitchenId === kitchen.id}
                onToggle={() => handleToggleExpand(kitchen.id)}
                isEditing={editingKitchenId === kitchen.id}
                draft={{
                  name: localName,
                  description: localDescription,
                  hourlyRate: localHourlyRate,
                  dailyRate: localDailyRate,
                  minimumBookingHours: localMinHours,
                  imageUrl: localImageUrl,
                }}
                onDraftChange={handleDraftChange}
                isDirty={isEditDirty}
                isSaving={isSavingEdit}
                onStartEdit={() => requestIntent({ kind: 'edit', kitchen })}
                onCancelEdit={handleCancelEdit}
                onSaveEdit={() => void handleSaveEdit()}
                onDirtyCollapseAttempt={() => requestIntent({ kind: 'collapse' })}
                onCoverSelect={(file) => void uploadCover(file)}
                locationId={selectedLocationId as number}
              />
            ))}
          </div>

          {/*
           * No "add another" here. Onboarding sets up one kitchen to get the
           * manager live; further kitchens are created from My Kitchens on the
           * dashboard, which is where they are managed anyway.
           */}
        </div>
      )}

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
            <Button onClick={() => requestIntent({ kind: 'create' })} size="lg">
              <Plus className="mr-2 h-4 w-4" />{mt("createKitchenSpace")}</Button>
          </CardContent>
        </Card>
      )}

      {/* Create Kitchen Form - Enterprise Design */}
      {showCreate && (
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
              <CoverPhotoField
                value={data.imageUrl}
                onSelectFile={(file) => void uploadCover(file)}
                onRemove={() => setLocalImageUrl('')}
                disabled={isCreating}
                className="w-full max-w-md"
              />
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

            <SettingsRow id="kitchen-minimum" label={mt("minimumBooking")}>
              <NumericInput
                id="kitchen-minimum"
                value={data.minimumBookingHours}
                onValueChange={(val) => {
                  if (val === '') {
                    setLocalMinHours('');
                    return;
                  }
                  const parsed = parseInt(val, 10);
                  if (!isNaN(parsed) && parsed >= 0 && parsed <= 24) {
                    setLocalMinHours(String(parsed));
                  }
                }}
                placeholder="1"
                suffix={mt("hoursSuffix")}
                className="w-32"
              />
            </SettingsRow>
          </CardContent>

            {/* Action Buttons — this form only ever creates. */}
            <div className="flex gap-3 border-t border-border p-4">
              <StatusButton
                status={isCreating ? "loading" : "idle"}
                onClick={handleCreate}
                disabled={!data.name.trim() || !data.description.trim() || !data.imageUrl || !data.hourlyRate}
                className="flex-1"
                labels={{ idle: mt("createKitchen"), loading: mt("creating"), success: mt("created") }}
              />
              <Button
                variant="outline"
                onClick={closeForm}
                disabled={isCreating}
                className="text-muted-foreground"
              >{mt("cancel")}</Button>
            </div>
        </Card>
      )}

      {/*
       * Collapsing a card is what hides its editor, so unsaved changes have to be
       * resolved first. Same three-way choice the wizard and the dashboard tabs
       * use, so the decision never depends on where the manager is.
       */}
      <UnsavedChangesDialog
        open={pendingIntent !== null}
        onOpenChange={(open) => { if (!open) setPendingIntent(null); }}
        description={mt("kitchenCardUnsavedChangesDescription")}
        isSaving={isSavingEdit}
        onDiscard={() => {
          const intent = pendingIntent;
          handleCancelEdit();
          setPendingIntent(null);
          if (intent) applyIntent(intent);
        }}
        onSave={async () => {
          const intent = pendingIntent;
          const saved = await handleSaveEdit();
          // On failure the dialog stays open — the toast already explains why.
          if (!saved) return;
          setPendingIntent(null);
          if (intent) applyIntent(intent);
        }}
      />

      {/* Navigation Footer */}
      {!showCreate && (
        <OnboardingNavigationFooter
          onNext={() => void handleContinue()}
          onBack={handleBack}
          onSaveAndExit={() => void saveAndExit()}
          showBack={!isFirstStep}
          // The label has to match what the button does — it saves first now.
          nextLabel={isEditDirty ? mt("saveAndContinue") : tt("continue")}
          isNextDisabled={kitchens.length === 0 || isSavingEdit}
          isLoading={isSavingEdit}
          isSavingAndExiting={isSubmitting}
        />
      )}
    </div>
  );
}
