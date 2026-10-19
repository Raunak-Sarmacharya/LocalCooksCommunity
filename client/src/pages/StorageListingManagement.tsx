import { useQuery } from "@tanstack/react-query";
import { storageListingReadiness, type StorageInstructions } from "@shared/storage-listing-readiness";
import { unitRows, type StorageRental } from "@/lib/storage-board";
import { StoragePhoto } from "@/components/storage/StoragePhoto";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { StorageIcon as Package } from "@/components/ui/inventory-icons";
import { StorageTrackingSetup } from "@/components/manager/settings/StorageTrackingSetup";
import { mt } from "@/i18n/manager";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import { ACCEPTED_IMAGE_TYPES, GalleryPhotoField } from "@/components/manager/kitchen/KitchenPhotoFields";
import { Plus, Pencil, Trash2, Thermometer, Snowflake, ChevronLeft, ClipboardCheck } from "@/components/ui/manager-icons";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { NeedsKitchen } from "@/components/manager/locations/NeedsPrerequisite";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { NumericInput } from "@/components/ui/numeric-input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ManagerPageLayout } from "@/components/layout/ManagerPageLayout";
import { KitchenScopeField } from "@/components/manager/listings/KitchenScopeField";
import { SuggestionList, type AddSuggestion } from "@/components/manager/listings/SuggestionList";
import { UndoBar, UNDO_WINDOW_MS } from "@/components/manager/shared/UndoBar";
import { SettingsRow } from "@/components/manager/settings/SettingsRow";
import { FormLegend } from "@/components/ui/form-legend";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { STORAGE_CATEGORIES, StorageTemplate, StorageTypeId, getDefaultTemperatureRange } from "@/lib/storage-templates";
import { PLATFORM_MAX_TERM_DAYS } from "@shared/storage-rental";
import { cn } from "@/lib/utils";

interface Kitchen {
  id: number;
  name: string;
  description?: string;
  locationId: number;
}

interface StorageListing {
  id?: number;
  kitchenId: number;
  storageType: 'dry' | 'cold' | 'freezer';
  name: string;
  description?: string;
  basePrice: number; // Daily rate in dollars (converted from cents)
  /** Free text such as "One shelf, 36 in wide" (migration 0095). */
  sizeLabel?: string | null;
  accessType?: string;
  temperatureRange?: string;
  photos?: string[] | null;
  isActive?: boolean;
  status?: string;
  /** Identical units of this listing a chef can rent (migration 0093). */
  unitCount?: number;
  /** Effective longest term, clamped to the platform maximum on read. */
  maxTermDays?: number | null;
  /** What the kitchen set; higher than `maxTermDays` when the platform maximum was lowered. */
  storedMaxTermDays?: number | null;
  /** The platform maximum, sent with every listing so the form can bound the term. */
  platformMaxTermDays?: number;
}

/** Exactly the fields the form edits — shared by the create and edit paths. */
interface StorageFormValues {
  name: string;
  storageType: StorageTypeId;
  accessType: string;
  sizeLabel: string;
  temperatureRange: string;
  photos: string[];
  basePrice: number;
  unitCount: number;
  maxTermDays: number;
  description: string;
}

/**
 * A storage listing in *another* kitchen that looks like the one being edited.
 *
 * There is no group/link column in the schema, so copies are matched by name +
 * type. That is deliberately loose: renaming one copy detaches it, which is the
 * honest behaviour for a model where each kitchen owns its own row.
 */
interface StorageMatch {
  kitchenId: number;
  kitchenName: string;
  listingId: number;
}

const STORAGE_ACCESS_VALUES = ['kitchen_hours', 'anytime', 'by_arrangement'];
const PHOTOS_MAX = 10;

/**
 * The storage form. Declared at module scope on purpose: a component defined
 * inside the page would be a new type on every render, remounting the inputs and
 * dropping focus on each keystroke.
 */
function StorageFields({
  values,
  onChange,
  platformMaxTermDays,
  maxTermNote,
}: {
  values: StorageFormValues;
  onChange: (updates: Partial<StorageFormValues>) => void;
  /** The platform maximum; the term field never goes above it. */
  platformMaxTermDays: number;
  /** Shown when the platform maximum was lowered below what the kitchen set. */
  maxTermNote?: string;
}) {
  const { toast } = useToast();
  const { uploadFile, isUploading } = useSessionFileUpload({
    allowedTypes: ACCEPTED_IMAGE_TYPES,
    onError: (message) => toast({ title: mt("uploadFailed2"), description: message, variant: "destructive" }),
  });
  // Reads the latest photos through a ref so several files picked at once all land.
  const photosRef = useRef(values.photos);
  photosRef.current = values.photos;
  const setPhotos = (photos: string[]) => { photosRef.current = photos; onChange({ photos }); };
  const addPhotos = async (files: File[]) => {
    for (const file of files.slice(0, PHOTOS_MAX - photosRef.current.length)) {
      const result = await uploadFile(file, "storage-photos");
      if (result?.url) setPhotos([...photosRef.current, result.url]);
    }
  };

  /** Mirrors the server's own rule (`name: z.string().min(3)`), surfaced inline. */
  const nameTooShort = values.name.length > 0 && values.name.trim().length < 3;
  const isCold = values.storageType === 'cold' || values.storageType === 'freezer';

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      {/* Same convention as every other form in the app. */}
      <FormLegend className="mb-0 border-b px-4 py-2" />
      <div className="divide-y">
        <h3 className="px-4 py-3 text-sm font-medium">{mt("slGroupBasics")}</h3>
        <SettingsRow id="sf-type" label={mt("slKind")} required>
          <Select
            value={values.storageType}
            onValueChange={(v: StorageTypeId) => onChange({
              storageType: v,
              temperatureRange: getDefaultTemperatureRange(v) || '',
            })}
          >
            <SelectTrigger id="sf-type" className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="dry">{mt("slKindDry")}</SelectItem>
              <SelectItem value="cold">{mt("slKindCooler")}</SelectItem>
              <SelectItem value="freezer">{mt("slKindFreezer")}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow layout="stacked" id="sf-name" label={mt("slName")} required>
          <Input
            id="sf-name"
            value={values.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={mt("eGWalkInCoolerA")}
            aria-invalid={nameTooShort || undefined}
          />
          {nameTooShort && (
            <p className="mt-1 text-xs text-destructive">{mt("storageNameMinLength")}</p>
          )}
        </SettingsRow>

        <h3 className="px-4 py-3 text-sm font-medium">{mt("slGroupPricing")}</h3>
        <SettingsRow id="sf-units" label={mt("storageUnitCount")} help={mt("storageUnitCountHelp")}>
          <NumericInput
            id="sf-units"
            className="w-28"
            suffix={mt("unitsUnit")}
            value={String(values.unitCount || 1)}
            onValueChange={(v) => onChange({ unitCount: parseInt(v) || 1 })}
          />
        </SettingsRow>

        <SettingsRow id="sf-rate" label={mt("storagePricePerDay")} hint={mt("currencyCadHint")} required>
          <NumericInput
            id="sf-rate"
            className="w-32"
            suffix={mt("perDay")}
            allowDecimals
            value={values.basePrice ? String(values.basePrice) : ''}
            onValueChange={(v) => onChange({ basePrice: parseFloat(v) || 0 })}
          />
        </SettingsRow>

            <SettingsRow id="sf-term" label={mt("slMaxTerm", { max: platformMaxTermDays })} help={maxTermNote ?? mt("storageMaxTermDaysHelp")}>
              <NumericInput
                id="sf-term"
                className="w-28"
                suffix={mt("daysUnit")}
                value={String(values.maxTermDays || platformMaxTermDays)}
                onValueChange={(v) => onChange({ maxTermDays: Math.min(parseInt(v) || platformMaxTermDays, platformMaxTermDays) })}
              />
            </SettingsRow>

        <h3 className="px-4 py-3 text-sm font-medium">{mt("slGroupPhotos")}</h3>
        <SettingsRow layout="stacked" id="sf-photos" label={mt("slPhotos")} help={mt("slPhotosHelp", { max: PHOTOS_MAX })}>
          <GalleryPhotoField
            images={values.photos}
            disabled={isUploading || values.photos.length >= PHOTOS_MAX}
            onSelectFiles={(files) => void addPhotos(files)}
            onReplace={(oldUrl, file) => void uploadFile(file, "storage-photos").then((r) => {
              if (r?.url) setPhotos(photosRef.current.map((u) => (u === oldUrl ? r.url : u)));
            })}
            onRemove={(url) => setPhotos(photosRef.current.filter((u) => u !== url))}
            className="grid grid-cols-2 gap-3 sm:grid-cols-3"
          />
        </SettingsRow>

        <h3 className="px-4 py-3 text-sm font-medium">{mt("slGroupDetails")}</h3>
        <SettingsRow layout="stacked" id="sf-size" label={mt("slSize")}>
          <Input
            id="sf-size"
            value={values.sizeLabel}
            maxLength={120}
            onChange={(e) => onChange({ sizeLabel: e.target.value })}
            placeholder={mt("slSizePlaceholder")}
          />
        </SettingsRow>

        <SettingsRow layout="stacked" id="sf-access" label={mt("slAccess")}>
          <Select value={values.accessType} onValueChange={(accessType) => onChange({ accessType })}>
            <SelectTrigger id="sf-access" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="kitchen_hours">{mt("slAccessKitchenHours")}</SelectItem>
              <SelectItem value="anytime">{mt("slAccessAnytime")}</SelectItem>
              <SelectItem value="by_arrangement">{mt("slAccessArrangement")}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        {isCold && (
          <SettingsRow id="sf-temp" label={mt("slTemperature")} help={mt("helpTemperature")}>
            <Input
              id="sf-temp"
              className="w-40"
              value={values.temperatureRange}
              onChange={(e) => onChange({ temperatureRange: e.target.value })}
              placeholder={mt("eG3540F")}
            />
          </SettingsRow>
        )}

        <SettingsRow layout="stacked" id="sf-desc" label={mt("slNotes")}>
          <Textarea
            id="sf-desc"
            value={values.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder={mt("slNotesPlaceholder")}
            rows={3}
          />
        </SettingsRow>



        <p className="px-4 py-3 text-sm text-muted-foreground">{mt("slRulesNote")}</p>
      </div>
    </div>
  );
}

export default function StorageListingManagement() {
  return (
    <ManagerPageLayout
      title={mt("storageManagement")}
      description={mt("manageYourKitchenStorageListings")}
      showKitchenSelector={true}
    >
      {({ selectedLocationId, selectedKitchenId, isLoading }) => {
        if (isLoading) {
          return (
            <div className="space-y-6">
              <Skeleton className="h-[200px] w-full" />
              <Skeleton className="h-[400px] w-full" />
            </div>
          );
        }
        return (
          <StorageListingContent
            selectedLocationId={selectedLocationId}
            selectedKitchenId={selectedKitchenId}
          />
        );
      }}
    </ManagerPageLayout>
  );
}

export function StorageListingContent({
  selectedLocationId,
  selectedKitchenId,
  embedded = false,
  onConfigureInspections,
  onListingsChanged
}: {
  selectedLocationId: number | null,
  selectedKitchenId: number | null,
  /**
   * Rendered INSIDE another surface that already supplies the page furniture — the
   * onboarding wizard's kitchen-listing step, whose part heading already says what this
   * is. Drops the duplicate heading and un-pins the commit bar, because the wizard has
   * its own footer directly below it. Everything else is the same component: one
   * implementation, two placements, so the wizard cannot drift from My Kitchens.
   */
  embedded?: boolean,
  onConfigureInspections?: () => void,
  /**
   * Called after this page's own list has been re-read following a successful write.
   *
   * The page keeps its rows in local state, so it repaints itself the moment you add
   * something — but anything ELSE reading the same listings from a different owner does
   * not. The onboarding step is exactly that: its review and the completion summary read
   * `storageForm.listings` from the onboarding context, which holds its own copy of these
   * rows. Without this the review showed an empty storage group until the whole provider
   * remounted. See the same prop on `EquipmentListingContent`.
   *
   * Optional, so the dashboard's own usage is unaffected.
   */
  onListingsChanged?: () => void
}) {
  const { toast } = useToast();
  const instructionsQuery = useQuery<StorageInstructions>({
    queryKey: ["checkin-checkout-settings", selectedLocationId], enabled: !!selectedLocationId,
    queryFn: () => apiGet(`/manager/locations/${selectedLocationId}/checkin-checkout-settings`),
  });
  const rentalsQuery = useQuery<StorageRental[]>({
    queryKey: ["/api/manager/storage-rentals"],
    queryFn: () => apiGet("/manager/storage-rentals"), refetchInterval: 30_000,
  });


  /** Adding stays a page; editing opens beside the listing rows. */
  const [view, setView] = useState<'list' | 'add' | 'edit'>('list');

  const [kitchens, setKitchens] = useState<Kitchen[]>([]);
  const [, navigate] = useLocation();
  const [listings, setListings] = useState<StorageListing[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Storage listings for every kitchen at this location, keyed by kitchen id.
   * Only used to answer "does another kitchen already have this shelf?" — the list
   * view and every write still go through `listings` / the single-kitchen
   * endpoints, so nothing downstream changes shape.
   */
  const [allKitchenListings, setAllKitchenListings] = useState<Record<number, StorageListing[]>>({});

  // ── Add page ──────────────────────────────────────────────────────────────
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [form, setForm] = useState<StorageFormValues | null>(null);
  const [targetKitchenIds, setTargetKitchenIds] = useState<number[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  /** What the form held when it was opened or last re-previewed. */
  const addBaselineRef = useRef<string>("");

  // ── Edit page ─────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState<StorageListing | null>(null);
  const [editMatches, setEditMatches] = useState<StorageMatch[]>([]);
  const [applyToKitchenIds, setApplyToKitchenIds] = useState<number[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingExit, setPendingExit] = useState<(() => void) | null>(null);

  // ── Delete (instant, with an undo window) ─────────────────────────────────
  const [pendingDelete, setPendingDelete] = useState<{ id: number; name: string } | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isToggling, setIsToggling] = useState(false);

  const originalListing = useMemo(
    () => (draft?.id == null ? null : listings.find((l) => l.id === draft.id) ?? null),
    [draft, listings],
  );

  const editDirty = useMemo(() => {
    if (!draft || !originalListing) return false;
    return JSON.stringify(draft) !== JSON.stringify(originalListing);
  }, [draft, originalListing]);

  /** Typing in the add form counts as unsaved work too. */
  const addDirty = Boolean(form) && JSON.stringify(form) !== addBaselineRef.current;

  const hasUnsavedWork = view === 'add' ? addDirty : view === 'edit' ? editDirty : false;

  useEffect(() => {
    if (selectedLocationId) {
      loadKitchens();
    } else {
      setKitchens([]);
    }
  }, [selectedLocationId]);

  useEffect(() => {
    if (selectedKitchenId) loadListings();
    else setListings([]);
  }, [selectedKitchenId]);

  // Switching kitchen or location unmounts the page, so leave the editor first.
  useEffect(() => {
    setView('list');
    setForm(null);
    setDraft(null);
    setPendingExit(null);
  }, [selectedKitchenId]);

  // Cover browser refresh / tab close, which the in-app guard cannot intercept.
  useEffect(() => {
    if (!hasUnsavedWork) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedWork]);

  const loadKitchens = async () => {
    if (!selectedLocationId) return;
    try {
      const data = await apiGet(`/manager/kitchens/${selectedLocationId}`);
      setKitchens(data);
      loadAllKitchenListings(data);
    } catch (error: any) {
      toast({ title: mt("error"), description: error.message || "Failed to load kitchens", variant: "destructive" });
    }
  };

  /**
   * Fetch every kitchen's storage listings so the page can tell which other
   * kitchens already carry a given shelf. Failures are swallowed per kitchen —
   * this is advisory data, and one failure must not blank the page.
   */
  const loadAllKitchenListings = async (kitchenList: Kitchen[]) => {
    const entries = await Promise.all(
      kitchenList.map(async (k) => {
        try {
          const rows = await apiGet(`/manager/kitchens/${k.id}/storage-listings`);
          return [k.id, Array.isArray(rows) ? rows : []] as const;
        } catch {
          return [k.id, []] as const;
        }
      }),
    );
    setAllKitchenListings(Object.fromEntries(entries));
  };

  /** Fetch and map the current kitchen's listings. Returns them for callers that need the fresh rows. */
  const fetchListings = async (): Promise<StorageListing[] | null> => {
    if (!selectedKitchenId) return null;
    try {
      const data = await apiGet(`/manager/kitchens/${selectedKitchenId}/storage-listings`);
      return Array.isArray(data) ? data.map((item: any) => ({
        ...item,
        basePrice: item.basePrice ? item.basePrice / 100 : 0,
      })) : [];
    } catch {
      return null;
    }
  };

  const loadListings = async () => {
    if (!selectedKitchenId) return;
    setIsLoading(true);
    const mapped = await fetchListings();
    if (mapped) setListings(mapped);
    else toast({ title: mt("error"), description: "Failed to load storage listings", variant: "destructive" });
    setIsLoading(false);
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  /** Loose identity for "the same shelf in another kitchen": name + type. */
  const matchKey = (name: string, type: string) => `${name.trim().toLowerCase()}|${type}`;

  /** Names of the other kitchens at this location that already carry this listing. */
  const kitchensAlsoHaving = (listing: StorageListing) => {
    const key = matchKey(listing.name, listing.storageType);
    return kitchens
      .filter((k) => k.id !== listing.kitchenId)
      .filter((k) =>
        (allKitchenListings[k.id] || []).some((l) => matchKey(l.name, l.storageType) === key),
      )
      .map((k) => k.name);
  };

  const countListedHere = (name: string) =>
    listings.filter((l) => l.name.trim().toLowerCase() === name.trim().toLowerCase()).length;

  const storageTypeLabel = (type: StorageTypeId) =>
    type === 'cold' ? mt("coldStorage") : type === 'freezer' ? mt("freezer") : mt("dryStorage");

  /**
   * Every kitchen's listings, flattened and de-duped by id.
   *
   * Cross-kitchen matching has to see the *other* kitchens' rows. `listings` only
   * holds the current kitchen's, so passing it as the match source made every
   * "also update" lookup fail silently and the control rendered nothing at all.
   * The current kitchen's rows win on conflict because they are the freshest.
   */
  const matchSource = useMemo(() => {
    const byId = new Map<number, StorageListing>();
    for (const rows of Object.values(allKitchenListings)) {
      for (const row of rows) if (row.id != null) byId.set(row.id, row);
    }
    for (const row of listings) if (row.id != null) byId.set(row.id, row);
    // `Array.from`, not a spread: `tsconfig.json` sets no `target`, so iterating a MapIterator
    // with `[...]` needs `--downlevelIteration`. Same pattern as `server/storage.ts`.
    return Array.from(byId.values());
  }, [allKitchenListings, listings]);

  /** The row being deleted is hidden straight away; the API call waits for the undo window. */
  const visibleListings = useMemo(
    () => (pendingDelete ? listings.filter((l) => l.id !== pendingDelete.id) : listings),
    [listings, pendingDelete],
  );

  const groupedListings = useMemo(() => {
    const order: StorageTypeId[] = ['dry', 'cold', 'freezer'];
    return order
      .map((type) => ({ type, items: visibleListings.filter((l) => l.storageType === type) }))
      .filter((group) => group.items.length > 0);
  }, [visibleListings]);

  /**
   * The suggestion list. Nothing is disabled: a kitchen can legitimately hold two
   * of the same thing, so "already listed" is shown as a note, never a block.
   */
  const suggestions: AddSuggestion[] = useMemo(
    () => STORAGE_CATEGORIES.flatMap((cat) =>
      cat.items.map((template) => {
        const here = countListedHere(template.name);
        return {
          id: template.id,
          name: template.name,
          group: cat.name,
          meta: `$${template.suggestedDailyRate}${mt("perDay")}`,
          note: here > 0 ? mt("alreadyListedCount", { count: here }) : undefined,
        };
      }),
    ),
    [listings],
  );

  /**
   * The platform maximum term (days), read from the listings the API clamps. Falls back to the shipped
   * default when this kitchen has no listings yet, so the form still has an upper bound.
   */
  const platformMaxTermDays = useMemo(
    () => listings.reduce((max, listing) => Math.max(max, listing.platformMaxTermDays ?? 0), 0) || PLATFORM_MAX_TERM_DAYS,
    [listings],
  );

  /** Sensible starting values. */
  const blankEntry = (overrides: Partial<StorageFormValues> = {}): StorageFormValues => ({
    name: '',
    storageType: 'dry',
    accessType: 'kitchen_hours',
    sizeLabel: '',
    temperatureRange: '',
    photos: [],
    basePrice: 0,
    unitCount: 1,
    maxTermDays: platformMaxTermDays,
    description: '',
    ...overrides,
  });

  const templateToEntry = (template: StorageTemplate): StorageFormValues =>
    blankEntry({
      name: template.name,
      storageType: template.storageType,
      description: template.description,
      basePrice: template.suggestedDailyRate,
      temperatureRange: template.temperatureRange || getDefaultTemperatureRange(template.storageType) || '',
    });

  /** Project a stored listing onto the form's shape. */
  const toFormValues = (listing: StorageListing): StorageFormValues => ({
    name: listing.name,
    storageType: listing.storageType,
    // Legacy values ("walk-in", free text) are not accepted on write, so they show as the default.
    accessType: STORAGE_ACCESS_VALUES.includes(listing.accessType ?? '') ? listing.accessType! : 'kitchen_hours',
    sizeLabel: listing.sizeLabel ?? '',
    temperatureRange: listing.temperatureRange || '',
    photos: Array.isArray(listing.photos) ? listing.photos : [],
    basePrice: listing.basePrice || 0,
    unitCount: listing.unitCount ?? 1,
    maxTermDays: listing.maxTermDays ?? platformMaxTermDays,
    description: listing.description || '',
  });

  /** Current kitchen plus any ticked others — de-duped, order irrelevant. */
  const targetKitchens = () =>
    Array.from(new Set(selectedKitchenId ? [selectedKitchenId, ...targetKitchenIds] : targetKitchenIds));

  // ── Navigation between the list and the two pages ─────────────────────────

  const openAdd = () => {
    const blank = blankEntry();
    addBaselineRef.current = JSON.stringify(blank);
    setPreviewId(null);
    setForm(blank);
    setTargetKitchenIds([]);
    setView('add');
  };

  const openEdit = useCallback((listing: StorageListing, source: StorageListing[]) => {
    setDraft({ ...listing });
    const key = matchKey(listing.name, listing.storageType);
    const matches: StorageMatch[] = kitchens
      .filter((k) => k.id !== listing.kitchenId)
      .flatMap((k) => {
        const hit = source.find(
          (l) => l.kitchenId === k.id && matchKey(l.name, l.storageType) === key,
        );
        return hit?.id != null
          ? [{ kitchenId: k.id, kitchenName: k.name, listingId: hit.id }]
          : [];
      });
    setEditMatches(matches);
    setApplyToKitchenIds([]); // opt-in — never write to another kitchen unasked
    setView('edit');
  }, [kitchens]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const itemId = Number(url.searchParams.get("itemId"));
    if (!Number.isSafeInteger(itemId) || itemId <= 0) return;
    const match = listings.find((listing) => listing.id === itemId);
    if (!match) return;
    openEdit(match, matchSource);
    url.searchParams.delete("itemId");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [listings, matchSource, openEdit]);

  const closePage = useCallback(() => {
    setView('list');
    setForm(null);
    setDraft(null);
    setEditMatches([]);
    setApplyToKitchenIds([]);
  }, []);

  /**
   * Leaving the page. PatternFly's rule for an inline editor: closing with no
   * changes is silent, but once there are changes the user is asked rather than
   * having the work vanish.
   */
  const requestExit = useCallback((after?: () => void) => {
    if (!hasUnsavedWork) {
      closePage();
      after?.();
      return;
    }
    setPendingExit(() => () => {
      closePage();
      after?.();
    });
  }, [hasUnsavedWork, closePage]);

  /**
   * Escape leaves the page, with the same unsaved-changes guard.
   *
   * Guarded against an open Radix dropdown: the select renders into a popper and
   * Escape belongs to it first. Without this the one keypress closed the menu AND
   * left the page, and with a dirty draft it opened the unsaved-changes dialog
   * behind the closing menu.
   */
  useEffect(() => {
    if (view === 'list') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector("[data-radix-popper-content-wrapper]")) return;
      event.preventDefault();
      requestExit();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view, requestExit]);

  // ── Add ───────────────────────────────────────────────────────────────────

  /** Previewing only — nothing is written until Add is pressed. */
  const selectSuggestion = (id: string | null) => {
    setPreviewId(id);
    const next = id === null
      ? blankEntry()
      : (() => {
          const template = STORAGE_CATEGORIES.flatMap((c) => c.items).find((t) => t.id === id);
          return template ? templateToEntry(template) : blankEntry();
        })();
    addBaselineRef.current = JSON.stringify(next);
    setForm(next);
  };

  const updateForm = (updates: Partial<StorageFormValues>) => {
    setForm((prev) => (prev ? { ...prev, ...updates } : prev));
  };

  /** Mirrors the server's own rules so the button can be disabled rather than failing. */
  const canSubmitAdd = Boolean(form && form.name.trim().length >= 3 && form.basePrice > 0
    && form.unitCount >= 1 && form.unitCount <= 200 && form.maxTermDays >= 1 && form.maxTermDays <= platformMaxTermDays);

  /** Same rules for the edit page, used to explain a save that cannot succeed. */
  const editIncomplete = Boolean(
    draft && (draft.name.trim().length < 3 || !draft.basePrice
      || (draft.unitCount ?? 1) < 1 || (draft.unitCount ?? 1) > 200
      || (draft.maxTermDays ?? platformMaxTermDays) < 1 || (draft.maxTermDays ?? platformMaxTermDays) > platformMaxTermDays),
  );

  /** Fields the server accepts for a new listing. `kitchenId` is added per target. */
  const storagePayload = (storage: StorageFormValues) => ({
    name: storage.name.trim(),
    storageType: storage.storageType,
    description: storage.description || undefined,
    dailyPriceCents: Math.round(storage.basePrice * 100), // Daily price in cents
    sizeLabel: storage.sizeLabel.trim() || null,
    accessType: storage.accessType,
    temperatureRange: storage.storageType === 'dry' ? undefined : storage.temperatureRange || undefined,
    photos: storage.photos,
    unitCount: storage.unitCount || 1,
    maxTermDays: storage.maxTermDays || null,
    currency: 'CAD',
    isActive: false,
  });

  /**
   * Create one listing per target kitchen.
   *
   * Reuses the single-kitchen endpoint in parallel rather than adding a bulk route:
   * per-kitchen access checks and overstay-default resolution keep running exactly
   * as they do today, so there is no new server surface to get wrong.
   */
  const createForKitchens = async (storage: StorageFormValues, kitchenIds: number[]) => {
    const results = await Promise.allSettled(
      kitchenIds.map((kitchenId) =>
        apiPost('/manager/storage-listings', { kitchenId, ...storagePayload(storage) }),
      ),
    );
    return results.filter((r) => r.status === 'fulfilled').length;
  };

  const submitAdd = async () => {
    if (!form || !selectedKitchenId || isCreating || !canSubmitAdd) return;
    const targets = targetKitchens();
    setIsCreating(true);
    try {
      const created = await createForKitchens(form, targets);
      if (created === 0) throw new Error(mt("failedToAddStorageListings"));
      toast({
        title: mt("storageAdded"),
        description:
          created > 1
            ? mt("addToKitchensCount", { count: created })
            : `${form.name.trim()} · $${form.basePrice}${mt("perDay")}`,
      });
      closePage();
      const fresh = await fetchListings();
      if (fresh) setListings(fresh);
      loadAllKitchenListings(kitchens);
      onListingsChanged?.();
    } catch (error: any) {
      toast({ title: mt("error"), description: error.message || mt("failedToAddStorageListings"), variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  // ── Edit ──────────────────────────────────────────────────────────────────

  const updateDraft = (updates: Partial<StorageListing>) => {
    setDraft((prev) => (prev ? { ...prev, ...updates } : prev));
  };

  /**
   * Body for a copy living in another kitchen.
   *
   * Deliberately a whitelist of the fields this form exposes, not a spread of the
   * whole row: a spread would also push `availability_calendar`, `status` and
   * `photos`, silently wiping the other kitchen's blocked dates. `kitchenId` is
   * omitted for the same class of reason — the repository applies the body straight
   * to the UPDATE, so forwarding it would move the other kitchen's listing here.
   */
  const extraKitchenPayload = (listing: StorageListing) => {
    const f = toFormValues(listing);
    return {
      name: f.name,
      storageType: f.storageType,
      description: f.description || undefined,
      dailyPriceCents: Math.round(f.basePrice * 100), // Daily price in cents
      sizeLabel: f.sizeLabel.trim() || null,
      accessType: f.accessType,
      temperatureRange: f.storageType === 'dry' ? undefined : f.temperatureRange || undefined,
      photos: f.photos,
      unitCount: f.unitCount,
      maxTermDays: listing.maxTermDays ?? null,
    };
  };

  /** Returns true when the listing saved, so the unsaved-changes dialog can stay open on failure. */
  const saveDraft = async (): Promise<boolean> => {
    if (!draft?.id) return false;
    if (!draft.name.trim()) {
      toast({ title: mt("error"), description: mt("pleaseEnterAStorageName"), variant: "destructive" });
      return false;
    }
    setIsSaving(true);
    try {
      await apiPut(`/manager/storage-listings/${draft.id}`, {
        ...extraKitchenPayload(draft),
      });

      const extras = editMatches.filter((m) => applyToKitchenIds.includes(m.kitchenId));
      const results = extras.length
        ? await Promise.allSettled(
            extras.map((m) =>
              apiPut(`/manager/storage-listings/${m.listingId}`, extraKitchenPayload(draft)),
            ),
          )
        : [];
      const extraOk = results.filter((r) => r.status === 'fulfilled').length;
      const extraFailed = extras.length - extraOk;

      toast({
        title: mt("success"),
        description: extraFailed
          ? `${mt("storageListingUpdatedSuccessfully")} ${extraFailed} failed.`
          : extraOk > 0
            ? mt("updatedInKitchens", { count: extraOk + 1 })
            : mt("storageListingUpdatedSuccessfully"),
      });
      closePage();
      loadListings();
      loadAllKitchenListings(kitchens);
      onListingsChanged?.();
      return true;
    } catch (error: any) {
      toast({ title: mt("error"), description: error.message || "Failed to update listing", variant: "destructive" });
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  /**
   * Deletes are instant with a six-second undo, matching the check-in /
   * check-out page. The API call is held back until the window closes, so an undo
   * never has to re-create the row — which would mint a new id and drop the
   * bookings that point at it. Starting a second delete commits the first.
   */
  const commitDelete = async (id: number) => {
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    setPendingDelete(null);
    try {
      await apiDelete(`/manager/storage-listings/${id}`);
      toast({ title: mt("success"), description: mt("storageListingDeletedSuccessfully") });
      loadAllKitchenListings(kitchens);
    } catch (error: any) {
      toast({ title: mt("error"), description: error.message || "Failed to delete listing", variant: "destructive" });
    } finally {
      // The refetch is awaited before notifying so any other reader (the onboarding
      // review) sees the row gone, not the previous list.
      await loadListings();
      onListingsChanged?.();
    }
  };

  const requestDelete = (listing: StorageListing) => {
    if (listing.id == null) return;
    if (pendingDelete) void commitDelete(pendingDelete.id);
    setPendingDelete({ id: listing.id, name: listing.name });
    deleteTimerRef.current = setTimeout(() => void commitDelete(listing.id!), UNDO_WINDOW_MS);
  };

  const undoDelete = () => {
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    setPendingDelete(null);
  };

  const handleToggleActive = async (listing: StorageListing) => {
    if (listing.id == null) return;
    const next = !listing.isActive || !storageListingReadiness(listing, instructionsQuery.data).visible;
    setIsToggling(true);
    try {
      await apiPut(`/manager/storage-listings/${listing.id}`, { isActive: next });
      await loadListings();
      onListingsChanged?.();
      toast({ title: mt("statusUpdated"), description: next ? mt("slListed") : mt("slPaused") });
    } catch (error: any) {
      toast({ title: mt("error"), description: error.message || "Failed to update status", variant: "destructive" });
    } finally {
      setIsToggling(false);
    }
  };

  const selectedKitchen = kitchens.find(k => k.id === selectedKitchenId);

  if (!selectedKitchenId) {
    /*
     * No kitchen to attach a listing to.
     *
     * The copy here used to be "select a location and kitchen from the sidebar" - an action the
     * sidebar cannot perform, since it holds no location or kitchen picker. `ManagerPageLayout`
     * now selects the first kitchen as soon as one exists, so reaching here means there genuinely
     * is none, and the manager needs a way to MAKE one rather than an instruction.
     */
    return (
      <NeedsKitchen
        hasKitchen={kitchens.length > 0}
        onGoToKitchens={() => navigate("/manager/dashboard?view=kitchens")}
      />
    );
  }

  const unsavedDialog = (
    <AlertDialog open={pendingExit !== null} onOpenChange={(open) => !open && setPendingExit(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{mt("unsavedChanges")}</AlertDialogTitle>
          <AlertDialogDescription>{mt("storageUnsavedChangesDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{mt("cancel")}</AlertDialogCancel>
          <Button
            variant="outline"
            onClick={() => {
              const action = pendingExit;
              setPendingExit(null);
              action?.();
            }}
          >
            {mt("discardChanges")}
          </Button>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void (async () => {
                if (view === 'edit') {
                  if (await saveDraft()) setPendingExit(null);
                } else {
                  // "Save" on the add page means "create it now".
                  setPendingExit(null);
                  await submitAdd();
                }
              })();
            }}
          >
            {mt("saveChanges")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  // ── Add / Edit page ───────────────────────────────────────────────────────

  const editor = (() => {
    if (view === 'list') return null;
    const isAdd = view === 'add';

    /**
     * The page's actions, rendered twice on purpose: in the header, where the eye
     * lands when the page opens, and again in the sticky bar, so they are still
     * there after scrolling a long form. Both drive the same handlers.
     */
    const pageActions = (
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" onClick={() => requestExit()} disabled={isSaving || isCreating}>
          {mt("cancel")}
        </Button>
        {isAdd ? (
          <Button onClick={() => void submitAdd()} disabled={!canSubmitAdd || isCreating}>
            <Plus className="mr-2 h-4 w-4" />
            {mt("slSaveDraft")}
          </Button>
        ) : (
          editDirty && (
            <StatusButton
              onClick={() => void saveDraft()}
              status={isSaving ? "loading" : "idle"}
              labels={{ idle: mt("saveChanges"), loading: mt("saving"), success: mt("saved") }}
            />
          )
        )}
      </div>
    );

    return (
      <div className="space-y-4">
        <div className="rounded-lg border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b p-4">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="!h-8 !w-8 !min-h-0 shrink-0"
                onClick={() => requestExit()}
                title={mt("back")}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <h2 className="truncate text-base font-medium">
                  {isAdd ? mt("addStorage") : mt("editStorageListing")}
                </h2>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {isAdd
                    ? mt("addStorageDialogHint")
                    : `${draft?.name?.trim() || mt("untitledItem")}${selectedKitchen ? ` · ${selectedKitchen.name}` : ''}`}
                </p>
              </div>
            </div>
            {pageActions}
          </div>

          {isAdd ? (
            <div className="grid grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)]">
              <div className="border-b p-4 lg:border-b-0 lg:border-r">
                <SuggestionList
                  title={mt("commonStorage")}
                  hint={mt("suggestionsHint")}
                  searchPlaceholder={mt("searchStorageTypes")}
                  items={suggestions}
                  selectedId={previewId}
                  onSelect={selectSuggestion}
                  createOwnLabel={mt("createYourOwn")}
                  createOwnHint={mt("createYourOwnHint")}
                  emptyLabel={mt("noMatchingStorageFound")}
                />
              </div>
              <div className="p-4 lg:p-6">
                {form && <StorageFields values={form} onChange={updateForm} platformMaxTermDays={platformMaxTermDays} />}
              </div>
            </div>
          ) : (
            <div className="p-4 lg:p-6">
              {draft && <StorageFields values={toFormValues(draft)} onChange={updateDraft} platformMaxTermDays={platformMaxTermDays}
                maxTermNote={draft.storedMaxTermDays != null && draft.storedMaxTermDays > (draft.maxTermDays ?? platformMaxTermDays)
                  ? mt("storageMaxTermDaysCapped", { max: platformMaxTermDays }) : undefined} />}
            </div>
          )}
        </div>

        {/* Sticky bar: the scope and the commit action never scroll away. */}
        <div className={cn(
          "z-10 space-y-3 rounded-lg border bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80",
          // Two bars pinned to the bottom of one scroll area read as a stack, so inside
          // a host surface this one is static and the host's footer owns the bottom.
          !embedded && "sticky bottom-0",
        )}>
          {isAdd ? (
            <KitchenScopeField
              kitchens={kitchens}
              selectedKitchenId={selectedKitchenId}
              value={targetKitchenIds}
              onChange={setTargetKitchenIds}
              disabled={isCreating}
            />
          ) : (
            <KitchenScopeField
              mode="edit"
              kitchens={editMatches.map((m) => ({ id: m.kitchenId, name: m.kitchenName }))}
              selectedKitchenId={draft?.kitchenId ?? selectedKitchenId}
              value={applyToKitchenIds}
              onChange={setApplyToKitchenIds}
              disabled={isSaving}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Explains a blocked submit rather than leaving it a dead end. */}
            <p className="text-xs text-muted-foreground">
              {(isAdd ? !canSubmitAdd : editIncomplete) ? mt("storageIncompleteHint") : null}
            </p>
            {pageActions}
          </div>
        </div>

        {isAdd && unsavedDialog}
      </div>
    );
  })();
  if (view === "add") return editor;

  // ── List page ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="mt-0 space-y-4">
      {selectedLocationId && <StorageTrackingSetup locationId={selectedLocationId} onConfigure={onConfigureInspections ?? (() => navigate("/manager/dashboard?view=settings-storage-checkin-checkout"))} />}
      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Package className="size-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {/* The host's heading already names this, so only the count and the
                    kitchen it belongs to survive — the two things it does not say. */}
                {!embedded && <h2 className="text-base font-medium">{mt("storageInventory")}</h2>}
                {visibleListings.length > 0 && <Badge variant="count">{visibleListings.length}</Badge>}
                {selectedKitchen && (
                  <span className="text-xs text-muted-foreground">{selectedKitchen.name}</span>
                )}
              </div>
              {!embedded && <p className="mt-0.5 text-xs text-muted-foreground">{mt("storageTabHint")}</p>}
            </div>
          </div>
          {/*
            * One "Add" affordance at a time, and never a second brand CTA beside the
            * host's own. Inside the wizard: when the inventory is empty the empty state
            * below already offers the action, and when it is not, this one steps back to
            * an outline so the step's Continue stays the only filled button.
            */}
          {(!embedded || visibleListings.length > 0) && (
            <Button variant={embedded ? "outline" : "default"} onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" />
              {mt("addStorage")}
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : visibleListings.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Package className="mx-auto h-10 w-10 opacity-20" />
            <h3 className="mt-3 text-sm font-medium">{mt("noStorageListedYet")}</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{mt("storageEmptyBody")}</p>
            {embedded && (
              <Button className="mt-4" variant="outline" onClick={openAdd}>
                <Plus className="mr-2 h-4 w-4" />
                {mt("addStorage")}
              </Button>
            )}
          </div>
        ) : (
          <div>
            {groupedListings.map((group) => (
              <section key={group.type}>
                <div className="flex items-center gap-2 bg-muted/40 px-4 py-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {storageTypeLabel(group.type)}
                  </h3>
                  <Badge variant="count">{group.items.length}</Badge>
                </div>
                <div className="divide-y">
                  {group.items.map((listing) => {
                    const alsoIn = kitchensAlsoHaving(listing);
                    const readiness = storageListingReadiness(listing, instructionsQuery.data);
                    const units = unitRows(rentalsQuery.data ?? [], [{ ...listing, id: listing.id!, unitCount: listing.unitCount ?? 1 }]);
                    const inUse = units.filter(row => row.rental !== null).length;
                    const requests = (rentalsQuery.data ?? []).filter(rental => rental.state === "requested" && rental.listing.id === listing.id).length;
                    return (
                      <div
                        key={listing.id}
                        className={cn(
                          "flex flex-wrap items-start gap-3 px-4 py-3 sm:flex-nowrap",
                          listing.isActive === false && "opacity-60",
                        )}
                      >
                        <StoragePhoto storageType={listing.storageType} photos={listing.photos} className="h-12 w-12" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="truncate text-sm font-medium">{listing.name}</span>
                            <Badge variant={readiness.visible ? "success" : "outline"} className="text-xs">
                              {mt(readiness.status === "draft" ? "slDraft" : readiness.status === "listed" ? "slListed" : "slPaused")}
                            </Badge>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                              ${(listing.basePrice || 0).toFixed(2)}{mt("perDay")}
                            </span>
                            <span>{storageTypeLabel(listing.storageType)}</span>
                            <span>{mt("storageMaxTermShort", { max: listing.maxTermDays ?? platformMaxTermDays })}</span>
                            {listing.sizeLabel ? <span>{listing.sizeLabel}</span> : null}
                          </div>
                          {!readiness.ready && <p className="mt-1 text-xs text-amber-800">{mt("slFinishSetup", { items: readiness.missing.map(item => mt(`slMissing_${item}`)).join(", ") })}</p>}
                          {rentalsQuery.isError ? <Button variant="link" size="sm" onClick={() => void rentalsQuery.refetch()}>{mt("retry")}</Button>
                            : rentalsQuery.isLoading ? <Skeleton className="mt-2 h-4 w-48" /> : <div className="mt-2 max-w-xs space-y-1">
                              <p className="text-xs text-muted-foreground">{mt("slOccupancy", { units: units.length, inUse, requests })}</p>
                              <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${units.length ? inUse / units.length * 100 : 0}%` }} /></div>
                            </div>}
                          {alsoIn.length > 0 && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {mt("listingsAlsoIn", { kitchens: alsoIn.join(", ") })}
                            </p>
                          )}
                        </div>
                        <div className="flex w-full shrink-0 flex-wrap items-center gap-1 sm:w-auto">
                          {readiness.status === "draft" ? <Button size="sm" variant="outline" disabled={isToggling || !readiness.ready || instructionsQuery.isFetching} onClick={() => void handleToggleActive(listing)}>{mt("slList")}</Button>
                            : <div className="flex items-center gap-2"><span className="text-xs">{mt(listing.isActive ? "slListed" : "slPaused")}</span><Switch
                              aria-label={mt("slListed")}
                              checked={readiness.visible} onCheckedChange={() => void handleToggleActive(listing)} disabled={isToggling || instructionsQuery.isFetching} /></div>}
                          <Button size="sm" variant="outline" onClick={() => navigate(`/manager/dashboard?view=storage-bookings&listingId=${listing.id}`)}>{mt("slViewUnits")}</Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(listing, matchSource)}
                            title={mt("editStorageDetails")}
                          >
                            <Pencil className="mr-1 h-4 w-4" />{mt("edit")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => requestDelete(listing)}
                            title={mt("deleteStorage")}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {pendingDelete && (
        <UndoBar
          label={mt("listingRemoved", { name: pendingDelete.name })}
          seconds={Math.round(UNDO_WINDOW_MS / 1000)}
          onUndo={undoDelete}
        />
      )}

      <Sheet open={view === "edit"} onOpenChange={open => { if (!open) requestExit(); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader className="sr-only"><SheetTitle>{mt("editStorageListing")}</SheetTitle><SheetDescription>{draft?.name}</SheetDescription></SheetHeader>
          {editor}
        </SheetContent>
      </Sheet>
      {unsavedDialog}
      </div>
    </div>
  );
}
