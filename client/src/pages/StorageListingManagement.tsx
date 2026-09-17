import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { Package, Plus, Pencil, Trash2, Thermometer, Snowflake, AlertTriangle, ChevronLeft } from "@/components/ui/manager-icons";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { Card, CardContent } from "@/components/ui/card";
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
import { SectionBand } from "@/components/manager/listings/SectionBand";
import { UndoBar, UNDO_WINDOW_MS } from "@/components/manager/shared/UndoBar";
import { SettingsRow } from "@/components/manager/settings/SettingsRow";
import { FormLegend } from "@/components/ui/form-legend";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { STORAGE_CATEGORIES, StorageTemplate, StorageTypeId, ACCESS_TYPE_LABELS, getDefaultTemperatureRange } from "@/lib/storage-templates";
import { cn } from "@/lib/utils";

/**
 * Storage tab — "My Kitchens".
 *
 * Adding and editing are **pages**, not modals. The form has eleven fields, and a
 * modal cannot hold that without a height ceiling and its own scrollbar — which is
 * what made the earlier popover get clamped and cut off. A page has no ceiling, the
 * page's own scroll does the work, and it matches how listing setup works on the
 * platforms this is modelled on.
 *
 * Adding is master–detail: the platform's suggestions on the left, the listing's
 * own form on the right. Selecting a suggestion only *previews* it — nothing is
 * written until Add is pressed — so every detail can be read first, and the same
 * suggestion can be added twice if the kitchen genuinely has two of something.
 *
 * Field rows follow the Booking Policies page: `SettingsRow` with the label on the
 * left and a control sized to its content on the right, so a two-digit number never
 * gets a full-width input.
 */

const StorageTypeIcon = ({ type, className }: { type: string; className?: string }) => {
  switch (type) {
    case 'cold':
      return <Thermometer className={className} />;
    case 'freezer':
      return <Snowflake className={className} />;
    default:
      return <Package className={className} />;
  }
};

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
  totalVolume?: number; // Cubic feet
  accessType?: string;
  temperatureRange?: string;
  isActive?: boolean;
  minimumBookingDuration?: number;
  overstayGracePeriodDays?: number;
  overstayPenaltyRate?: string;
  overstayMaxPenaltyDays?: number;
  overstayPolicyText?: string;
}

/** Exactly the fields the form edits — shared by the create and edit paths. */
interface StorageFormValues {
  name: string;
  storageType: StorageTypeId;
  accessType: string;
  minimumBookingDuration: number;
  totalVolume: number;
  temperatureRange: string;
  basePrice: number;
  overstayGracePeriodDays: number;
  overstayPenaltyRate: string;
  overstayMaxPenaltyDays: number;
  description: string;
}

interface LocationDefaults {
  gracePeriodDays: number | null;
  penaltyRate: number | null;
  maxPenaltyDays: number | null;
  policyText: string | null;
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

/** Sentinel for the "Other…" entry in the access-type Select. */
const ACCESS_OTHER = "__other__";

/**
 * The storage form. Declared at module scope on purpose: a component defined
 * inside the page would be a new type on every render, remounting the inputs and
 * dropping focus on each keystroke.
 */
function StorageFields({
  values,
  onChange,
}: {
  values: StorageFormValues;
  onChange: (updates: Partial<StorageFormValues>) => void;
}) {
  /**
   * `access_type` is a plain text column and is never validated server-side, so a
   * manager may name their own. Anything not in the common list — including the
   * empty value "Other…" sets — counts as custom and gets a text field.
   */
  const accessIsCustom = !(values.accessType in ACCESS_TYPE_LABELS);

  /**
   * Set the moment "Other…" is picked, so the focus-restore suppression below
   * does not depend on a re-render landing before the menu finishes closing.
   */
  const keepFocusRef = useRef(false);

  /** Mirrors the server's own rule (`name: z.string().min(3)`), surfaced inline. */
  const nameTooShort = values.name.length > 0 && values.name.trim().length < 3;

  /**
   * React's `autoFocus` only sets the attribute — browsers honour it for elements
   * present at parse time, not for one mounted later, so the field has to be
   * focused explicitly. Suppressing Radix's focus restore above is what stops it
   * being stolen back once this has run.
   */
  const customAccessRef = useRef<HTMLInputElement>(null);
  const wasCustomRef = useRef(accessIsCustom);
  useEffect(() => {
    const justBecameCustom = accessIsCustom && !wasCustomRef.current;
    wasCustomRef.current = accessIsCustom;
    if (justBecameCustom) customAccessRef.current?.focus();
  }, [accessIsCustom]);

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      {/* Same convention as every other form in the app. */}
      <FormLegend className="mb-0 border-b px-4 py-2" />
      <div className="divide-y">
        <SectionBand label={mt("groupDetails")} />

        <SettingsRow layout="stacked" id="sf-name" label={mt("storageName")} required>
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

        <SettingsRow id="sf-type" label={mt("storageType")} required>
          <Select
            value={values.storageType}
            onValueChange={(v: StorageTypeId) => onChange({
              storageType: v,
              temperatureRange: getDefaultTemperatureRange(v) || '',
            })}
          >
            <SelectTrigger id="sf-type" className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="dry">{mt("dryStorage")}</SelectItem>
              <SelectItem value="cold">{mt("coldStorage")}</SelectItem>
              <SelectItem value="freezer">{mt("freezer")}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow id="sf-access" label={mt("accessType")} help={mt("helpAccessType")}>
          <div className="flex items-center gap-2">
            <Select
              value={accessIsCustom ? ACCESS_OTHER : values.accessType}
              onValueChange={(v) => {
                keepFocusRef.current = v === ACCESS_OTHER;
                onChange({ accessType: v === ACCESS_OTHER ? '' : v });
              }}
            >
              <SelectTrigger id="sf-access" className="w-48">
                <SelectValue placeholder={mt("selectAccessType")} />
              </SelectTrigger>
              {/*
                Radix restores focus to the trigger as the menu closes, which
                happens after the close animation and would steal it from the
                field that "Other…" just revealed. Suppressing the restore only
                in that case keeps normal keyboard flow intact for real options.
              */}
              <SelectContent onCloseAutoFocus={(event) => { if (keepFocusRef.current) event.preventDefault(); }}>
                {Object.entries(ACCESS_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
                <SelectItem value={ACCESS_OTHER}>{mt("accessTypeOther")}</SelectItem>
              </SelectContent>
            </Select>
            {accessIsCustom && (
              <Input
                ref={customAccessRef}
                className="w-44"
                value={values.accessType}
                onChange={(e) => onChange({ accessType: e.target.value })}
                placeholder={mt("accessTypeCustomPlaceholder")}
              />
            )}
          </div>
        </SettingsRow>

        <SettingsRow id="sf-min" label={mt("minimumBookingDays")} help={mt("helpMinBooking")}>
          <NumericInput
            id="sf-min"
            className="w-28"
            suffix={mt("daysUnit")}
            value={String(values.minimumBookingDuration || 1)}
            onValueChange={(v) => onChange({ minimumBookingDuration: parseInt(v) || 1 })}
          />
        </SettingsRow>

        <SettingsRow id="sf-size" label={mt("sizeCubicFeet")} help={mt("helpSize")}>
          <NumericInput
            id="sf-size"
            className="w-28"
            suffix="cu ft"
            value={values.totalVolume ? String(values.totalVolume) : ''}
            onValueChange={(v) => onChange({ totalVolume: parseFloat(v) || 0 })}
          />
        </SettingsRow>

        {(values.storageType === 'cold' || values.storageType === 'freezer') && (
          <SettingsRow id="sf-temp" label={mt("temperatureRange")} help={mt("helpTemperature")}>
            <Input
              id="sf-temp"
              className="w-40"
              value={values.temperatureRange}
              onChange={(e) => onChange({ temperatureRange: e.target.value })}
              placeholder={mt("eG3540F")}
            />
          </SettingsRow>
        )}

        <SectionBand label={mt("groupPricing")} />

        <SettingsRow id="sf-rate" label={mt("dailyRateDollars")} hint={mt("currencyCadHint")} required>
          <NumericInput
            id="sf-rate"
            className="w-32"
            suffix={mt("perDay")}
            allowDecimals
            value={values.basePrice ? String(values.basePrice) : ''}
            onValueChange={(v) => onChange({ basePrice: parseFloat(v) || 0 })}
          />
        </SettingsRow>

        <SectionBand label={mt("navOverstayPenalties")} hint={mt("penaltiesHint")} />

        <SettingsRow id="sf-grace" label={mt("gracePeriodDays2")} help={mt("helpGraceDays")}>
          <NumericInput
            id="sf-grace"
            className="w-24"
            suffix={mt("daysUnit")}
            value={String(values.overstayGracePeriodDays)}
            onValueChange={(v) => onChange({ overstayGracePeriodDays: parseInt(v) || 0 })}
          />
        </SettingsRow>

        <SettingsRow id="sf-pen" label={mt("penaltyRate2")} help={mt("helpPenaltyRate")}>
          <NumericInput
            id="sf-pen"
            className="w-24"
            suffix="%"
            value={String(Math.round(parseFloat(values.overstayPenaltyRate) * 100))}
            onValueChange={(v) => onChange({ overstayPenaltyRate: ((parseInt(v) || 0) / 100).toString() })}
          />
        </SettingsRow>

        <SettingsRow id="sf-max" label={mt("maxPenaltyDays")} help={mt("helpMaxPenaltyDays")}>
          <NumericInput
            id="sf-max"
            className="w-24"
            suffix={mt("daysUnit")}
            value={String(values.overstayMaxPenaltyDays)}
            onValueChange={(v) => onChange({ overstayMaxPenaltyDays: parseInt(v) || 1 })}
          />
        </SettingsRow>

        <SettingsRow layout="stacked" id="sf-desc" label={mt("description")}>
          <Textarea
            id="sf-desc"
            value={values.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder={mt("describeTheStorageSpace")}
            rows={2}
          />
        </SettingsRow>
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
  selectedKitchenId
}: {
  selectedLocationId: number | null,
  selectedKitchenId: number | null
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  /** The tab shows either the listings or a full page for one listing. */
  const [view, setView] = useState<'list' | 'add' | 'edit'>('list');

  const [kitchens, setKitchens] = useState<Kitchen[]>([]);
  const [listings, setListings] = useState<StorageListing[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [locationDefaults, setLocationDefaults] = useState<LocationDefaults | null>(null);

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
      loadLocationDefaults();
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

  const loadLocationDefaults = async () => {
    if (!selectedLocationId) return;
    try {
      const data = await apiGet(`/manager/locations/${selectedLocationId}/overstay-penalty-defaults`);
      setLocationDefaults(data.locationDefaults);
    } catch (error: any) {
      logger.error('Failed to load location defaults:', error);
    }
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
    return [...byId.values()];
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

  /** Sensible starting values, seeded from the location's overstay defaults. */
  const blankEntry = (overrides: Partial<StorageFormValues> = {}): StorageFormValues => ({
    name: '',
    storageType: 'dry',
    accessType: 'shelving-unit',
    minimumBookingDuration: 1,
    totalVolume: 0,
    temperatureRange: getDefaultTemperatureRange('dry') || '',
    basePrice: 0,
    overstayGracePeriodDays: locationDefaults?.gracePeriodDays ?? 3,
    overstayPenaltyRate: (locationDefaults?.penaltyRate ?? 0.10).toString(),
    overstayMaxPenaltyDays: locationDefaults?.maxPenaltyDays ?? 30,
    description: '',
    ...overrides,
  });

  const templateToEntry = (template: StorageTemplate): StorageFormValues =>
    blankEntry({
      name: template.name,
      storageType: template.storageType,
      description: template.description,
      basePrice: template.suggestedDailyRate,
      accessType: template.accessTypes[0] || 'walk-in',
      temperatureRange: template.temperatureRange || getDefaultTemperatureRange(template.storageType) || '',
    });

  /** Project a stored listing onto the form's shape. */
  const toFormValues = (listing: StorageListing): StorageFormValues => ({
    name: listing.name,
    storageType: listing.storageType,
    // `??`, not `||`: an empty access type is meaningful — it is what "Other…"
    // sets while the manager is typing their own label — and `||` would coerce it
    // straight back to a preset, making the custom field unreachable on edit.
    accessType: listing.accessType ?? 'shelving-unit',
    minimumBookingDuration: listing.minimumBookingDuration ?? 1,
    totalVolume: listing.totalVolume ?? 0,
    temperatureRange: listing.temperatureRange || '',
    basePrice: listing.basePrice || 0,
    overstayGracePeriodDays: listing.overstayGracePeriodDays ?? 3,
    overstayPenaltyRate: listing.overstayPenaltyRate || '0.10',
    overstayMaxPenaltyDays: listing.overstayMaxPenaltyDays ?? 30,
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
  const canSubmitAdd = Boolean(form && form.name.trim().length >= 3 && form.basePrice > 0);

  /** Same rules for the edit page, used to explain a save that cannot succeed. */
  const editIncomplete = Boolean(
    draft && (draft.name.trim().length < 3 || !draft.basePrice),
  );

  /** Fields the server accepts for a new listing. `kitchenId` is added per target. */
  const storagePayload = (storage: StorageFormValues) => ({
    name: storage.name.trim(),
    storageType: storage.storageType,
    description: storage.description || undefined,
    basePrice: Math.round(storage.basePrice * 100), // Convert to cents
    totalVolume: storage.totalVolume || undefined,
    accessType: storage.accessType || undefined,
    temperatureRange: storage.temperatureRange || undefined,
    pricingModel: 'daily',
    minimumBookingDuration: storage.minimumBookingDuration || 1,
    bookingDurationUnit: 'daily',
    currency: 'CAD',
    isActive: true,
    overstayGracePeriodDays: storage.overstayGracePeriodDays,
    overstayPenaltyRate: storage.overstayPenaltyRate,
    overstayMaxPenaltyDays: storage.overstayMaxPenaltyDays,
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
      queryClient.invalidateQueries({ queryKey: [`/api/manager/storage-listings`] });
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
  const extraKitchenPayload = (listing: StorageListing) => ({
    name: listing.name,
    storageType: listing.storageType,
    description: listing.description || undefined,
    basePrice: Math.round((listing.basePrice || 0) * 100), // Convert to cents
    totalVolume: listing.totalVolume || undefined,
    accessType: listing.accessType || undefined,
    temperatureRange: listing.temperatureRange || undefined,
    minimumBookingDuration: listing.minimumBookingDuration || 1,
    overstayGracePeriodDays: listing.overstayGracePeriodDays,
    overstayPenaltyRate: listing.overstayPenaltyRate,
    overstayMaxPenaltyDays: listing.overstayMaxPenaltyDays,
    overstayPolicyText: listing.overstayPolicyText,
  });

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
        ...draft,
        basePrice: Math.round((draft.basePrice || 0) * 100), // Convert to cents
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
      queryClient.invalidateQueries({ queryKey: [`/api/manager/storage-listings`] });
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
      loadListings();
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
    const next = listing.isActive === false;
    setIsToggling(true);
    try {
      await apiPut(`/manager/storage-listings/${listing.id}`, { isActive: next });
      loadListings();
      queryClient.invalidateQueries({ queryKey: [`/api/manager/storage-listings`] });
      toast({ title: mt("statusUpdated"), description: next ? mt("listingNowActive") : mt("listingNowInactive") });
    } catch (error: any) {
      toast({ title: mt("error"), description: error.message || "Failed to update status", variant: "destructive" });
    } finally {
      setIsToggling(false);
    }
  };

  const selectedKitchen = kitchens.find(k => k.id === selectedKitchenId);

  if (!selectedKitchenId) {
    return (
      <Card className="border-dashed h-full">
        <CardContent className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground h-full">
          <Package className="h-12 w-12 mb-4 opacity-20" />
          <h3 className="text-lg font-medium text-foreground mb-1">{mt("noKitchenSelected")}</h3>
          <p>{mt("selectALocationAndKitchenFromTheSidebarToManageStorage")}</p>
        </CardContent>
      </Card>
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

  if (view !== 'list') {
    const isAdd = view === 'add';

    /**
     * The page's actions, rendered twice on purpose: in the header, where the eye
     * lands when the page opens, and again in the sticky bar, so they are still
     * there after scrolling a long form. Both drive the same handlers.
     */
    const pageActions = (
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" onClick={() => requestExit()} disabled={isSaving || isCreating}>
          {mt("cancel")}
        </Button>
        {isAdd ? (
          <Button onClick={() => void submitAdd()} disabled={!canSubmitAdd || isCreating}>
            <Plus className="mr-2 h-4 w-4" />
            {mt("listThisStorage")}
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
                {form && <StorageFields values={form} onChange={updateForm} />}
              </div>
            </div>
          ) : (
            <div className="p-4 lg:p-6">
              {draft && <StorageFields values={toFormValues(draft)} onChange={updateDraft} />}
            </div>
          )}
        </div>

        {/* Sticky bar: the scope and the commit action never scroll away. */}
        <div className="sticky bottom-0 z-10 space-y-3 rounded-lg border bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
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

        {unsavedDialog}
      </div>
    );
  }

  // ── List page ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Package className="size-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-medium">{mt("storageInventory")}</h2>
                {visibleListings.length > 0 && <Badge variant="count">{visibleListings.length}</Badge>}
                {selectedKitchen && (
                  <span className="text-xs text-muted-foreground">{selectedKitchen.name}</span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{mt("storageTabHint")}</p>
            </div>
          </div>
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            {mt("addStorage")}
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : visibleListings.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Package className="mx-auto h-10 w-10 opacity-20" />
            <h3 className="mt-3 text-sm font-medium">{mt("noStorageListedYet")}</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{mt("storageEmptyBody")}</p>
            <Button className="mt-4" onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" />
              {mt("addStorage")}
            </Button>
          </div>
        ) : (
          <div>
            {groupedListings.map((group) => (
              <section key={group.type}>
                <div className="flex items-center gap-2 bg-muted/40 px-4 py-2">
                  <StorageTypeIcon type={group.type} className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {storageTypeLabel(group.type)}
                  </h3>
                  <Badge variant="count">{group.items.length}</Badge>
                </div>
                <div className="divide-y">
                  {group.items.map((listing) => {
                    const alsoIn = kitchensAlsoHaving(listing);
                    return (
                      <div
                        key={listing.id}
                        className={cn(
                          "flex items-start justify-between gap-4 px-4 py-3",
                          listing.isActive === false && "opacity-60",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="truncate text-sm font-medium">{listing.name}</span>
                            <Badge variant={listing.isActive !== false ? "success" : "outline"} className="text-xs">
                              {listing.isActive !== false ? mt("active") : mt("inactive")}
                            </Badge>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                              ${(listing.basePrice || 0).toFixed(2)}{mt("perDay")}
                            </span>
                            {listing.totalVolume ? <span>{listing.totalVolume} cu ft</span> : null}
                            {/* Falls back to the stored value so a manager's own
                                access-type label still shows in the list. */}
                            {listing.accessType
                              ? <span>{ACCESS_TYPE_LABELS[listing.accessType] ?? listing.accessType}</span>
                              : null}
                            {listing.minimumBookingDuration && listing.minimumBookingDuration > 1
                              ? <span>Min {listing.minimumBookingDuration} days</span>
                              : null}
                            <span className="flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              {listing.overstayGracePeriodDays ?? 3}d · {Math.round(parseFloat(listing.overstayPenaltyRate || '0.1') * 100)}%/day
                            </span>
                          </div>
                          {alsoIn.length > 0 && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {mt("listingsAlsoIn", { kitchens: alsoIn.join(", ") })}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Switch
                            checked={listing.isActive !== false}
                            onCheckedChange={() => void handleToggleActive(listing)}
                            disabled={isToggling}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(listing, matchSource)}
                            title={mt("editStorageDetails")}
                          >
                            <Pencil className="h-4 w-4" />
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

      {unsavedDialog}
    </div>
  );
}
