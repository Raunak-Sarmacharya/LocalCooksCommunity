import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import {
  Wrench,
  Plus,
  Pencil,
  Trash2,
  ChevronLeft,
  Check,
  CheckCircle,
  DollarSign,
} from "@/components/ui/manager-icons";
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
import { EQUIPMENT_CATEGORIES, type EquipmentTemplate, type EquipmentCategoryId } from "@/lib/equipment-templates";
import { cn } from "@/lib/utils";

/**
 * Equipment tab — "My Kitchens".
 *
 * Built to the same model as the storage tab, because the two are the same shape:
 * adding and editing are **pages**, not modals — eleven-ish fields cannot live in
 * a modal without a height ceiling and its own scrollbar, which is what made the
 * earlier popover get clamped and cut off.
 *
 * Adding is master–detail: the platform's suggestions on the left, the listing's
 * own form on the right. Selecting a suggestion only *previews* it — nothing is
 * written until the button is pressed — so every detail can be read first, and the
 * same suggestion can be added twice if the kitchen genuinely has two of something.
 *
 * What is different from storage:
 * - Equipment is either **included** or a **paid add-on**, and that is the axis a
 *   manager actually thinks in, so the list is two sections rather than one.
 * - A suggestion that carries a rate means "kitchens normally rent this out", so
 *   picking one opens the form on Paid with the price filled in; a $0 suggestion
 *   opens on Included. Either way it is visible and changeable before listing.
 * - `damageDeposit` is editable here. It is added to the chef's total in
 *   `server/routes/bookings.ts` and the Stripe webhook, but no manager surface
 *   could set it before — the onboarding step hardcoded 0.
 */

/** Canonical display order for categories, used by both the form and the list. */
const CATEGORY_ORDER: EquipmentCategoryId[] = [
  'cooking',
  'food-prep',
  'refrigeration',
  'specialty',
  'cleaning',
];

const CONDITIONS: EquipmentListing['condition'][] = ['excellent', 'good', 'fair', 'needs-repair'];

const categoryLabel = (id: EquipmentCategoryId) => {
  switch (id) {
    case 'cooking': return mt("cooking");
    case 'food-prep': return mt("prep");
    case 'refrigeration': return mt("refrigeration");
    case 'specialty': return mt("specialty");
    case 'cleaning': return mt("cleaning");
    default: return id;
  }
};

/**
 * Condition was previously rendered as the raw enum (`<span className="capitalize">`),
 * so a French or Ukrainian manager saw "needs-repair". Every other enum on the page
 * was already translated; this one was missed.
 */
const conditionLabel = (condition: EquipmentListing['condition']) => {
  switch (condition) {
    case 'excellent': return mt("excellent");
    case 'fair': return mt("fair");
    case 'needs-repair': return mt("needsRepair");
    default: return mt("good");
  }
};

interface Kitchen {
  id: number;
  name: string;
  description?: string;
  locationId: number;
}

interface EquipmentListing {
  id?: number;
  kitchenId: number;
  category: EquipmentCategoryId;
  equipmentType: string;
  brand?: string;
  model?: string;
  description?: string;
  condition: 'excellent' | 'good' | 'fair' | 'needs-repair';
  availabilityType: 'included' | 'rental';
  sessionRate?: number;
  currency: string;
  damageDeposit?: number;
  isActive?: boolean;
}

/** Exactly the fields the form edits — shared by the create and edit paths. */
interface EquipmentFormValues {
  name: string;
  category: EquipmentCategoryId;
  condition: EquipmentListing['condition'];
  availabilityType: 'included' | 'rental';
  sessionRate: number;
  damageDeposit: number;
  brand: string;
  description: string;
}

/**
 * An equipment listing in *another* kitchen that looks like the one being edited.
 *
 * There is no link column in the schema, so copies are matched by type + category.
 * That is deliberately loose: renaming one copy detaches it, which is the honest
 * behaviour for a model where each kitchen owns its own row.
 */
interface EquipmentMatch {
  kitchenId: number;
  kitchenName: string;
  listingId: number;
}

/**
 * Included / Paid, as a two-segment control.
 *
 * Hand-rolled rather than Radix `ToggleGroup`. That primitive emits `role="radio"`
 * together with `data-radix-collection-item`, and `client/src/index.css` carries a
 * global `!important` rule that sizes exactly that combination to 16×16 for the
 * app's radio dots:
 *
 *   [data-radix-collection-item][role="radio"] { height: 16px !important; … }
 *
 * Its specificity is (0,2,0) and a Tailwind utility is (0,1,0), so no `!` override
 * can beat it — the items collapsed to 16px and their labels overlapped. Plain
 * buttons sidestep the collision entirely, and need only the usual `!min-h-0` for
 * the global 44px touch-target rule.
 *
 * This decides which half of the inventory the listing lands in, so it is worth
 * being the one control on the page that reads at a glance. The tint is semantic —
 * emerald for free, brand for chargeable — and only on the selected half.
 */
function AvailabilityToggle({
  value,
  onChange,
}: {
  value: EquipmentFormValues['availabilityType'];
  onChange: (next: EquipmentFormValues['availabilityType']) => void;
}) {
  const segment = (active: boolean, tone: 'included' | 'rental') =>
    cn(
      "!min-h-0 !min-w-0 inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-xs transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
      active
        ? tone === 'included'
          ? "bg-success/10 font-medium text-success"
          : "bg-primary/10 font-medium text-primary"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  return (
    <div
      role="group"
      aria-label={mt("availabilityType")}
      className="inline-flex items-center gap-0.5 rounded-md border bg-background p-0.5"
    >
      <button
        type="button"
        aria-pressed={value === 'included'}
        onClick={() => onChange('included')}
        className={segment(value === 'included', 'included')}
      >
        <Check className="h-3.5 w-3.5" />
        {mt("included")}
      </button>
      <button
        type="button"
        aria-pressed={value === 'rental'}
        onClick={() => onChange('rental')}
        className={segment(value === 'rental', 'rental')}
      >
        <DollarSign className="h-3.5 w-3.5" />
        {mt("paidAddon")}
      </button>
    </div>
  );
}

/**
 * Project a stored listing onto the form's shape.
 *
 * Declared at module scope because the edit page's dirty check runs during render
 * and calls this. As a `const` inside the component it sat below that call in the
 * temporal dead zone, so opening the edit page threw
 * "Cannot access 'toFormValues' before initialization".
 */
function toFormValues(listing: EquipmentListing): EquipmentFormValues {
  return {
    name: listing.equipmentType,
    category: listing.category,
    condition: listing.condition,
    availabilityType: listing.availabilityType,
    sessionRate: listing.sessionRate || 0,
    damageDeposit: listing.damageDeposit || 0,
    brand: listing.brand || '',
    description: listing.description || '',
  };
}

/**
 * Why the form cannot be submitted yet, or `null` when it can.
 *
 * Mirrors the server's own rules (`server/routes/equipment.ts`) so the button is
 * disabled with a reason rather than failing after the fact. Declared at module
 * scope so the add and edit pages cannot drift apart.
 */
function incompleteReason(
  values: Pick<EquipmentFormValues, 'name' | 'availabilityType' | 'sessionRate'> | null,
): string | null {
  if (!values || !values.name.trim()) return mt("equipmentNameRequired");
  if (values.availabilityType === 'rental' && values.sessionRate <= 0) {
    return mt("equipmentRateRequired");
  }
  return null;
}

/**
 * The equipment form. Declared at module scope on purpose: a component defined
 * inside the page would be a new type on every render, remounting the inputs and
 * dropping focus on each keystroke.
 *
 * Field rows follow the Booking Policies page: `SettingsRow` with the label on the
 * left and a control sized to its content on the right, so a two-digit rate never
 * gets a full-width input.
 */
function EquipmentFields({
  values,
  onChange,
}: {
  values: EquipmentFormValues;
  onChange: (updates: Partial<EquipmentFormValues>) => void;
}) {
  const isRental = values.availabilityType === 'rental';

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      {/* Same convention as every other form in the app. */}
      <FormLegend className="mb-0 border-b px-4 py-2" />
      <div className="divide-y">
        <SectionBand label={mt("groupDetails")} />

        <SettingsRow layout="stacked" id="ef-name" label={mt("equipmentName")} required>
          <Input
            id="ef-name"
            value={values.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={mt("equipmentName2")}
          />
        </SettingsRow>

        <SettingsRow id="ef-category" label={mt("category")} required>
          <Select
            value={values.category}
            onValueChange={(v: EquipmentCategoryId) => onChange({ category: v })}
          >
            <SelectTrigger id="ef-category" className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORY_ORDER.map((id) => (
                <SelectItem key={id} value={id}>{categoryLabel(id)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow id="ef-brand" label={mt("brand")}>
          <Input
            id="ef-brand"
            className="w-56"
            value={values.brand}
            onChange={(e) => onChange({ brand: e.target.value })}
            placeholder={mt("optional")}
          />
        </SettingsRow>

        <SettingsRow id="ef-condition" label={mt("condition")} help={mt("helpCondition")} required>
          <Select
            value={values.condition}
            onValueChange={(v: EquipmentListing['condition']) => onChange({ condition: v })}
          >
            <SelectTrigger id="ef-condition" className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CONDITIONS.map((condition) => (
                <SelectItem key={condition} value={condition}>{conditionLabel(condition)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>

        <SectionBand label={mt("groupAvailability")} hint={mt("availabilitySectionHint")} />

        {/* No `id`: a <label for> only binds to labelable elements, and this is a
            group of two buttons. The group carries its own aria-label instead. */}
        <SettingsRow label={mt("availabilityType")} help={mt("helpAvailability")} required>
          <AvailabilityToggle
            value={values.availabilityType}
            onChange={(next) => onChange({
              availabilityType: next,
              // Leaving Paid clears the money fields, so an item that is switched
              // back to Included can never carry a hidden charge.
              ...(next === 'included' ? { sessionRate: 0, damageDeposit: 0 } : {}),
            })}
          />
        </SettingsRow>

        {isRental && (
          <>
            <SettingsRow id="ef-rate" label={mt("sessionRateCAD")} help={mt("helpSessionRate")} required>
              <NumericInput
                id="ef-rate"
                className="w-36"
                suffix={mt("perSession")}
                allowDecimals
                value={values.sessionRate ? String(values.sessionRate) : ''}
                onValueChange={(v) => onChange({ sessionRate: parseFloat(v) || 0 })}
              />
            </SettingsRow>

            <SettingsRow
              id="ef-deposit"
              label={mt("damageDeposit")}
              help={mt("helpDamageDeposit")}
              hint={mt("damageDepositHint")}
            >
              <NumericInput
                id="ef-deposit"
                className="w-32"
                allowDecimals
                value={values.damageDeposit ? String(values.damageDeposit) : ''}
                onValueChange={(v) => onChange({ damageDeposit: parseFloat(v) || 0 })}
              />
            </SettingsRow>
          </>
        )}

        <SettingsRow layout="stacked" id="ef-desc" label={mt("description")}>
          <Textarea
            id="ef-desc"
            value={values.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder={mt("optionalDescription2")}
            rows={2}
          />
        </SettingsRow>
      </div>
    </div>
  );
}

export default function EquipmentListingManagement() {
  return (
    <ManagerPageLayout
      title={mt("equipmentManagement")}
      description={mt("manageYourKitchenEquipmentListings")}
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
          <EquipmentListingContent
            selectedLocationId={selectedLocationId}
            selectedKitchenId={selectedKitchenId}
          />
        );
      }}
    </ManagerPageLayout>
  );
}

export function EquipmentListingContent({
  selectedLocationId,
  selectedKitchenId,
  embedded = false
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
  embedded?: boolean
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  /** The tab shows either the inventory or a full page for one listing. */
  const [view, setView] = useState<'list' | 'add' | 'edit'>('list');

  const [kitchens, setKitchens] = useState<Kitchen[]>([]);
  const [listings, setListings] = useState<EquipmentListing[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Equipment listings for every kitchen at this location, keyed by kitchen id.
   * Only used to answer "does another kitchen already have this item?" — the list
   * view and every write still go through `listings` / the single-kitchen
   * endpoints, so nothing downstream changes shape.
   */
  const [allKitchenListings, setAllKitchenListings] = useState<Record<number, EquipmentListing[]>>({});

  // ── Add page ──────────────────────────────────────────────────────────────
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [form, setForm] = useState<EquipmentFormValues | null>(null);
  const [targetKitchenIds, setTargetKitchenIds] = useState<number[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  /** What the form held when it was opened or last re-previewed. */
  const addBaselineRef = useRef<string>("");

  // ── Edit page ─────────────────────────────────────────────────────────────
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState<EquipmentFormValues | null>(null);
  const [editMatches, setEditMatches] = useState<EquipmentMatch[]>([]);
  const [applyToKitchenIds, setApplyToKitchenIds] = useState<number[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingExit, setPendingExit] = useState<(() => void) | null>(null);

  // ── Delete (instant, with an undo window) ─────────────────────────────────
  const [pendingDelete, setPendingDelete] = useState<{ id: number; name: string } | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isToggling, setIsToggling] = useState(false);

  const originalListing = useMemo(
    () => (editId == null ? null : listings.find((l) => l.id === editId) ?? null),
    [editId, listings],
  );

  const editDirty = useMemo(() => {
    if (!draft || !originalListing) return false;
    return JSON.stringify(draft) !== JSON.stringify(toFormValues(originalListing));
  }, [draft, originalListing]);

  /** Typing in the add form counts as unsaved work too. */
  const addDirty = Boolean(form) && JSON.stringify(form) !== addBaselineRef.current;

  const hasUnsavedWork = view === 'add' ? addDirty : view === 'edit' ? editDirty : false;

  useEffect(() => {
    if (selectedLocationId) loadKitchens();
    else setKitchens([]);
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
    setEditId(null);
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
   * Fetch every kitchen's equipment listings so the page can tell which other
   * kitchens already carry a given item. Failures are swallowed per kitchen —
   * this is advisory data, and one failure must not blank the page.
   */
  const loadAllKitchenListings = async (kitchenList: Kitchen[]) => {
    const entries = await Promise.all(
      kitchenList.map(async (k) => {
        try {
          const rows = await apiGet(`/manager/kitchens/${k.id}/equipment-listings`);
          return [k.id, Array.isArray(rows) ? rows : []] as const;
        } catch {
          return [k.id, []] as const;
        }
      }),
    );
    setAllKitchenListings(Object.fromEntries(entries));
  };

  /** Fetch and map the current kitchen's listings. Returns them for callers that need the fresh rows. */
  const fetchListings = async (): Promise<EquipmentListing[] | null> => {
    if (!selectedKitchenId) return null;
    try {
      const data = await apiGet(`/manager/kitchens/${selectedKitchenId}/equipment-listings`);
      return Array.isArray(data) ? data.map((item: any) => ({
        ...item,
        sessionRate: item.sessionRate ? item.sessionRate / 100 : 0,
        damageDeposit: item.damageDeposit ? item.damageDeposit / 100 : 0,
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
    else toast({ title: mt("error"), description: "Failed to load equipment listings", variant: "destructive" });
    setIsLoading(false);
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  /** Loose identity for "the same item in another kitchen": type + category. */
  const matchKey = (equipmentType: string, category: string) =>
    `${equipmentType.trim().toLowerCase()}|${category}`;

  /** Names of the other kitchens at this location that already carry this listing. */
  const kitchensAlsoHaving = (listing: EquipmentListing) => {
    const key = matchKey(listing.equipmentType, listing.category);
    return kitchens
      .filter((k) => k.id !== listing.kitchenId)
      .filter((k) =>
        (allKitchenListings[k.id] || []).some((l) => matchKey(l.equipmentType, l.category) === key),
      )
      .map((k) => k.name);
  };

  const countListedHere = (name: string) =>
    listings.filter((l) => l.equipmentType.trim().toLowerCase() === name.trim().toLowerCase()).length;

  /**
   * Every kitchen's listings, flattened and de-duped by id.
   *
   * Cross-kitchen matching has to see the *other* kitchens' rows. `listings` only
   * holds the current kitchen's, so passing it as the match source made every
   * "also update" lookup fail silently and the control rendered nothing at all.
   * The current kitchen's rows win on conflict because they are the freshest.
   */
  const matchSource = useMemo(() => {
    const byId = new Map<number, EquipmentListing>();
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

  /**
   * The two inventory sections.
   *
   * Sorted by category, then id. That clusters the same category together so the
   * list reads as grouped without needing a heading per category, and — unlike the
   * heap order the API used to return — it cannot change when a row is written to.
   * A row only ever moves when the manager changes its category or its
   * availability, both of which are deliberate.
   */
  const sections = useMemo(() => {
    const rank = (listing: EquipmentListing) => CATEGORY_ORDER.indexOf(listing.category);
    const sort = (rows: EquipmentListing[]) =>
      [...rows].sort((a, b) => rank(a) - rank(b) || (a.id ?? 0) - (b.id ?? 0));

    return [
      {
        key: 'included',
        label: mt("includedEquipment"),
        icon: <CheckCircle className="h-3.5 w-3.5 text-success" />,
        items: sort(visibleListings.filter((l) => l.availabilityType !== 'rental')),
      },
      {
        key: 'rental',
        label: mt("paidEquipment"),
        icon: <DollarSign className="h-3.5 w-3.5 text-primary" />,
        items: sort(visibleListings.filter((l) => l.availabilityType === 'rental')),
      },
    ].filter((section) => section.items.length > 0);
  }, [visibleListings]);

  /**
   * The suggestion list. Nothing is disabled: a kitchen can legitimately hold two
   * of the same thing, so "already listed" is shown as a note, never a block.
   */
  const suggestions: AddSuggestion[] = useMemo(
    () => EQUIPMENT_CATEGORIES.flatMap((cat) =>
      cat.items.map((template) => {
        const here = countListedHere(template.name);
        return {
          id: template.id,
          name: template.name,
          group: cat.name,
          meta: template.suggestedSessionRate > 0
            ? `$${template.suggestedSessionRate}${mt("perSession")}`
            : mt("included"),
          note: here > 0 ? mt("alreadyListedCount", { count: here }) : undefined,
        };
      }),
    ),
    [listings],
  );

  /** Sensible starting values. */
  const blankEntry = (overrides: Partial<EquipmentFormValues> = {}): EquipmentFormValues => ({
    name: '',
    category: 'cooking',
    condition: 'good',
    availabilityType: 'included',
    sessionRate: 0,
    damageDeposit: 0,
    brand: '',
    description: '',
    ...overrides,
  });

  /**
   * A suggestion's suggested rate is a signal, not decoration: templates that carry
   * one are the things kitchens normally rent out, templates at $0 are part of the
   * kitchen. So the form opens on the matching side with the price already filled.
   */
  const templateToEntry = (template: EquipmentTemplate): EquipmentFormValues =>
    blankEntry({
      name: template.name,
      category: template.category,
      condition: template.defaultCondition,
      availabilityType: template.suggestedSessionRate > 0 ? 'rental' : 'included',
      sessionRate: template.suggestedSessionRate,
    });

  /** Current kitchen plus any ticked others — de-duped, order irrelevant. */
  const targetKitchens = () =>
    Array.from(new Set(selectedKitchenId ? [selectedKitchenId, ...targetKitchenIds] : targetKitchenIds));

  // ── Navigation between the inventory and the two pages ────────────────────

  const openAdd = () => {
    const blank = blankEntry();
    addBaselineRef.current = JSON.stringify(blank);
    setPreviewId(null);
    setForm(blank);
    setTargetKitchenIds([]);
    setView('add');
  };

  const openEdit = useCallback((listing: EquipmentListing, source: EquipmentListing[]) => {
    setEditId(listing.id ?? null);
    setDraft(toFormValues(listing));
    const key = matchKey(listing.equipmentType, listing.category);
    const matches: EquipmentMatch[] = kitchens
      .filter((k) => k.id !== listing.kitchenId)
      .flatMap((k) => {
        const hit = source.find(
          (l) => l.kitchenId === k.id && matchKey(l.equipmentType, l.category) === key,
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
    setEditId(null);
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

  /** Previewing only — nothing is written until the button is pressed. */
  const selectSuggestion = (id: string | null) => {
    setPreviewId(id);
    const next = id === null
      ? blankEntry()
      : (() => {
          const template = EQUIPMENT_CATEGORIES.flatMap((c) => c.items).find((t) => t.id === id);
          return template ? templateToEntry(template) : blankEntry();
        })();
    addBaselineRef.current = JSON.stringify(next);
    setForm(next);
  };

  const updateForm = (updates: Partial<EquipmentFormValues>) => {
    setForm((prev) => (prev ? { ...prev, ...updates } : prev));
  };

  const addBlocker = incompleteReason(form);
  const canSubmitAdd = Boolean(form) && addBlocker === null;
  const editBlocker = incompleteReason(draft);

  /** Fields the server accepts for a listing. `kitchenId` is added per target. */
  const equipmentPayload = (values: EquipmentFormValues) => ({
    category: values.category,
    equipmentType: values.name.trim(),
    brand: values.brand || undefined,
    description: values.description || undefined,
    condition: values.condition,
    availabilityType: values.availabilityType,
    sessionRate: values.availabilityType === 'rental' ? Math.round(values.sessionRate * 100) : 0,
    damageDeposit: values.availabilityType === 'rental' ? Math.round(values.damageDeposit * 100) : 0,
    currency: 'CAD',
    isActive: true,
  });

  /**
   * Create one listing per target kitchen.
   *
   * Reuses the single-kitchen endpoint in parallel rather than adding a bulk route:
   * per-kitchen access checks keep running exactly as they do today, so there is no
   * new server surface to get wrong.
   */
  const createForKitchens = async (equipment: EquipmentFormValues, kitchenIds: number[]) => {
    const results = await Promise.allSettled(
      kitchenIds.map((kitchenId) =>
        apiPost('/manager/equipment-listings', { kitchenId, ...equipmentPayload(equipment) }),
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
      if (created === 0) throw new Error(mt("failedToAddEquipmentListings"));
      toast({
        title: mt("equipmentAdded"),
        description: created > 1
          ? mt("addToKitchensCount", { count: created })
          : form.name.trim(),
      });
      closePage();
      const fresh = await fetchListings();
      if (fresh) setListings(fresh);
      loadAllKitchenListings(kitchens);
      queryClient.invalidateQueries({ queryKey: [`/api/manager/equipment-listings`] });
    } catch (error: any) {
      toast({ title: mt("error"), description: error.message || mt("failedToAddEquipmentListings"), variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  // ── Edit ──────────────────────────────────────────────────────────────────

  const updateDraft = (updates: Partial<EquipmentFormValues>) => {
    setDraft((prev) => (prev ? { ...prev, ...updates } : prev));
  };

  /**
   * Body for a copy living in another kitchen.
   *
   * Deliberately a whitelist of the fields this form exposes, not a spread of the
   * whole row: a spread would also push columns the form never touched. `kitchenId`
   * is omitted for the same class of reason — the repository applies the body
   * straight to the UPDATE, so forwarding it would move the other kitchen's listing
   * here.
   */
  const extraKitchenPayload = (values: EquipmentFormValues) => {
    const { isActive: _isActive, ...rest } = equipmentPayload(values);
    return rest;
  };

  /** Returns true when the listing saved, so the unsaved-changes dialog can stay open on failure. */
  const saveDraft = async (): Promise<boolean> => {
    if (editId == null || !draft) return false;
    if (editBlocker) {
      toast({ title: mt("error"), description: editBlocker, variant: "destructive" });
      return false;
    }
    setIsSaving(true);
    try {
      await apiPut(`/manager/equipment-listings/${editId}`, equipmentPayload(draft));

      const extras = editMatches.filter((m) => applyToKitchenIds.includes(m.kitchenId));
      const results = extras.length
        ? await Promise.allSettled(
            extras.map((m) =>
              apiPut(`/manager/equipment-listings/${m.listingId}`, extraKitchenPayload(draft)),
            ),
          )
        : [];
      const extraOk = results.filter((r) => r.status === 'fulfilled').length;
      const extraFailed = extras.length - extraOk;

      toast({
        title: mt("success"),
        description: extraFailed
          ? `${mt("equipmentListingUpdatedSuccessfully")} ${extraFailed} failed.`
          : extraOk > 0
            ? mt("updatedInKitchens", { count: extraOk + 1 })
            : mt("equipmentListingUpdatedSuccessfully"),
      });
      closePage();
      loadListings();
      loadAllKitchenListings(kitchens);
      queryClient.invalidateQueries({ queryKey: [`/api/manager/equipment-listings`] });
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
      await apiDelete(`/manager/equipment-listings/${id}`);
      toast({ title: mt("success"), description: mt("equipmentListingDeletedSuccessfully") });
      loadAllKitchenListings(kitchens);
    } catch (error: any) {
      toast({ title: mt("error"), description: error.message || "Failed to delete listing", variant: "destructive" });
    } finally {
      loadListings();
    }
  };

  const requestDelete = (listing: EquipmentListing) => {
    if (listing.id == null) return;
    if (pendingDelete) void commitDelete(pendingDelete.id);
    setPendingDelete({ id: listing.id, name: listing.equipmentType });
    deleteTimerRef.current = setTimeout(() => void commitDelete(listing.id!), UNDO_WINDOW_MS);
  };

  const undoDelete = () => {
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    setPendingDelete(null);
  };

  const handleToggleActive = async (listing: EquipmentListing) => {
    if (listing.id == null) return;
    const next = listing.isActive === false;
    setIsToggling(true);
    try {
      await apiPut(`/manager/equipment-listings/${listing.id}`, { isActive: next });
      loadListings();
      queryClient.invalidateQueries({ queryKey: [`/api/manager/equipment-listings`] });
      toast({
        title: mt("statusUpdated"),
        description: next ? mt("listingNowActive") : mt("listingNowInactive"),
      });
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
          <Wrench className="h-12 w-12 mb-4 opacity-20" />
          <h3 className="text-lg font-medium text-foreground mb-1">{mt("noKitchenSelected")}</h3>
          <p>{mt("selectALocationAndKitchenFromTheSidebarToManageEquipment")}</p>
        </CardContent>
      </Card>
    );
  }

  const unsavedDialog = (
    <AlertDialog open={pendingExit !== null} onOpenChange={(open) => !open && setPendingExit(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{mt("unsavedChanges")}</AlertDialogTitle>
          <AlertDialogDescription>{mt("equipmentUnsavedChangesDescription")}</AlertDialogDescription>
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
            {mt("listThisEquipment")}
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
                  {isAdd ? mt("addEquipment") : mt("editEquipment")}
                </h2>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {isAdd
                    ? mt("addEquipmentDialogHint")
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
                  title={mt("commonEquipment")}
                  hint={mt("suggestionsHint")}
                  searchPlaceholder={mt("searchEquipment")}
                  items={suggestions}
                  selectedId={previewId}
                  onSelect={selectSuggestion}
                  createOwnLabel={mt("createYourOwn")}
                  createOwnHint={mt("createYourOwnHint")}
                  emptyLabel={mt("noMatchingEquipmentFound")}
                />
              </div>
              <div className="p-4 lg:p-6">
                {form && <EquipmentFields values={form} onChange={updateForm} />}
              </div>
            </div>
          ) : (
            <div className="p-4 lg:p-6">
              {draft && <EquipmentFields values={draft} onChange={updateDraft} />}
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
              selectedKitchenId={originalListing?.kitchenId ?? selectedKitchenId}
              value={applyToKitchenIds}
              onChange={setApplyToKitchenIds}
              disabled={isSaving}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Explains a blocked submit rather than leaving it a dead end. */}
            <p className="text-xs text-muted-foreground">
              {isAdd ? addBlocker : editBlocker}
            </p>
            {pageActions}
          </div>
        </div>

        {unsavedDialog}
      </div>
    );
  }

  // ── Inventory ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Wrench className="size-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {/* The host's heading already names this, so only the count and the
                    kitchen it belongs to survive — the two things it does not say. */}
                {!embedded && <h2 className="text-base font-medium">{mt("equipmentInventory")}</h2>}
                {visibleListings.length > 0 && <Badge variant="count">{visibleListings.length}</Badge>}
                {selectedKitchen && (
                  <span className="text-xs text-muted-foreground">{selectedKitchen.name}</span>
                )}
              </div>
              {!embedded && <p className="mt-0.5 text-xs text-muted-foreground">{mt("equipmentTabHint")}</p>}
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
              {mt("addEquipment")}
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : visibleListings.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Wrench className="mx-auto h-10 w-10 opacity-20" />
            <h3 className="mt-3 text-sm font-medium">{mt("noEquipmentListedYet")}</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{mt("equipmentEmptyBody")}</p>
            {/* Outline inside a host surface: the step's Continue is the filled action
                there, and a second brand CTA makes the manager choose between two. */}
            <Button className="mt-4" variant={embedded ? "outline" : "default"} onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" />
              {mt("addEquipment")}
            </Button>
          </div>
        ) : (
          <div>
            {sections.map((section) => (
              <section key={section.key}>
                <SectionBand label={section.label} icon={section.icon} />
                <div className="divide-y">
                  {section.items.map((listing) => {
                    const alsoIn = kitchensAlsoHaving(listing);
                    const isRental = listing.availabilityType === 'rental';
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
                            <span className="truncate text-sm font-medium">{listing.equipmentType}</span>
                            {listing.brand && (
                              <span className="truncate text-xs text-muted-foreground">{listing.brand}</span>
                            )}
                            <Badge variant={listing.isActive !== false ? "success" : "outline"} className="text-xs">
                              {listing.isActive !== false ? mt("active") : mt("inactive")}
                            </Badge>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                            {/*
                              The one thing worth colouring: whether this costs the
                              chef money. Free is a quiet tick, chargeable is the
                              number — the price is the information either way.
                            */}
                            {isRental ? (
                              <span className="font-medium text-foreground">
                                ${(listing.sessionRate || 0).toFixed(2)}{mt("perSession")}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 font-medium text-success">
                                <Check className="h-3 w-3" />
                                {mt("included")}
                              </span>
                            )}
                            <span>{categoryLabel(listing.category)}</span>
                            <span>{conditionLabel(listing.condition)}</span>
                            {isRental && listing.damageDeposit ? (
                              <span>${(listing.damageDeposit || 0).toFixed(2)} {mt("damageDeposit").toLowerCase()}</span>
                            ) : null}
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
                            title={mt("editEquipment")}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => requestDelete(listing)}
                            title={mt("deleteEquipmentListing")}
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
