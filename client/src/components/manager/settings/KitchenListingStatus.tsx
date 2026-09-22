import { useState, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
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
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  EyeOff,
  Loader2,
} from "@/components/ui/manager-icons";
import { useStatusButton } from "@/hooks/use-status-button";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPost } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { KitchensNavigationTarget } from "@/lib/manager-kitchens-navigation";
import {
  invalidateKitchenListingState,
  kitchenListingReadinessKey,
} from "@/lib/manager-kitchens-navigation";
import { mt } from "@/i18n/manager";
import type {
  ListingRecommendationId,
  ListingRequirementId,
} from "@shared/kitchen-listing-readiness";

interface ReadinessResponse {
  checklist: {
    requirements: Array<{ id: ListingRequirementId; met: boolean }>;
    recommendations: Array<{ id: ListingRecommendationId; met: boolean }>;
    canPublish: boolean;
    missingRequirementIds: ListingRequirementId[];
    openRecommendationIds: ListingRecommendationId[];
  };
  listingStatus: "draft" | "active";
  adminHidden: boolean;
  /**
   * The same payload the review page reads. Only `kitchenName` is used here: the take-down
   * confirmation has to name the kitchen it is about, because a dialog is read on its own and the
   * header's switcher is not in view behind it.
   */
  details: { kitchenName: string };
}

interface KitchenListingStatusProps {
  kitchenId: number;
  /**
   * The location the kitchen belongs to, so a republish can refresh the location-scoped kitchen lists
   * as well as this kitchen's checklist.
   */
  locationId?: number;
  /**
   * Named on the card because the card is about ONE kitchen and a location can hold several.
   *
   * Two kitchens can share a state and an open-item count while blocking on completely different
   * things, which reads as a card that never updates. Naming the kitchen removes the ambiguity.
   */
  kitchenName?: string;
  /**
   * The kitchen switcher, rendered as the bar's IDENTITY — the leading slot on the same row.
   *
   * A slot rather than a callback: the bar must not know how a kitchen is chosen, and the page that
   * owns the dropdown already has the state. Passing the control in is also what lets the identity and
   * the status share ONE row, which is the whole point of the shape.
   */
  selector?: ReactNode;
  /**
   * The shell owns routing; this names the destination and, for a task that belongs to one kitchen,
   * which kitchen. Passed explicitly rather than looked up from the URL, which differs per
   * environment.
   */
  onNavigate?: (view: KitchensNavigationTarget, kitchenId?: number) => void;
}

/**
 * How each state is dressed.
 *
 * The tone is carried by the ICON alone, and the label beside it stays in the normal text colour.
 * Colouring the label too made "Not listed" read as a hyperlink — blue text next to a control is a
 * link to every reader — while the icon was already saying the same thing. A tinted badge chip is
 * deliberately not used either: in a header it becomes one more label to skim past.
 */
const TONES = {
  live: { label: "text-emerald-700 dark:text-emerald-400", icon: CheckCircle },
  blocked: { label: "text-amber-700 dark:text-amber-400", icon: AlertTriangle },
  ready: { label: "text-sky-700 dark:text-sky-400", icon: CheckCircle },
  hidden: { label: "text-amber-700 dark:text-amber-400", icon: EyeOff },
} as const;

/**
 * The bar's height, and the row it shares with the kitchen switcher.
 *
 * `h-11` (44px) because that is what the kitchen switcher ACTUALLY renders at, and the two sit side
 * by side — any other height makes one of them read as a mistake.
 *
 * Two things made this non-obvious, and both had to be MEASURED rather than reasoned about:
 *
 * 1. The switcher's trigger declares `h-9` but renders 44px. `client/src/index.css` puts a deliberate
 *    touch-target floor on every button — `min-height: 44px` on `button:not(...)`, `.button`,
 *    `a[role="button"]`, `[type="button"]`, `[type="submit"]`, under the comment "Mobile-friendly
 *    button size". That floor beats `height: 2.25rem`, so `h-9` on a `<button>` in this app means
 *    44px in practice. Matching `h-9` here produced a 36px bar beside a 44px dropdown.
 * 2. The bar must not be SHORTER than its own action for the same reason — a `size="sm"` Button is
 *    floored at 44px too, so the 36px bar had a 44px button inside it, which overflowed the bar and
 *    forced the whole row to the taller height regardless.
 *
 * A CONSTANT rather than a literal in the JSX: the value has to hold in three places (the bar, the
 * loading skeleton, and the row's own floor) and they drift the moment it is typed out three times.
 */
const BAR_H = "h-11";
const ROW = "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2";

/**
 * The bar's action.
 *
 * A plain `Button`, not `StatusButton`, and that is deliberate. `StatusButton` splits its label into
 * one span per character to animate it and hangs a floating status badge at `-top-1 -right-1`; the
 * wrapper it adds is `relative inline-flex` and the badge is designed to sit OUTSIDE its parent. In a
 * boxed, fixed-height row that added height the row did not have room for. Nothing here has a
 * saving/saved phase to animate either — the take-down opens a confirmation dialog and the review
 * navigates away — so the animation was pure cost.
 *
 * `min-h-0` + an explicit `h-8` is the load-bearing part. `client/src/index.css` floors every button
 * in this app at `min-height: 44px` for touch targets (see `BAR_H` above). Left alone, the button
 * came out exactly the bar's own height, so it sat flush against the bar's top and bottom edges and
 * read as a stretched slab glued inside the frame rather than as a button resting in it — which is
 * what the screenshot showed.
 *
 * `!` on `min-h-0` is required, and not decoration. The app's floor is a plain single-class rule
 * declared AFTER Tailwind's utilities in the compiled stylesheet, so `.min-h-0` loses to it on source
 * order. `!min-h-0` emits `!important`, which is the only thing that beats a later rule of equal
 * specificity — verified against the compiled `dev/listing-status.css`, where `.min-h-0` sits at line
 * 3458 and the `min-height: 44px` floor at 11065.
 *
 * Overriding the floor here is right, not a shortcut around it: the 44px floor exists so a control is
 * big enough to tap, and this control's whole bar is the target area that the bar's own padding
 * supplies. A 32px button with 6px of bar above and below it is easier to hit than a 44px button
 * jammed edge to edge.
 *
 * The rule itself named the exclusion pattern — it already exempts `[data-radix-collection-item]`,
 * `[role="checkbox"]` and `[role="switch"]` — so opting a specific control out is a supported thing
 * to do here rather than a hack against it.
 *
 * NO radius override. The app's `Button` is `rounded-full` and that is the pill every other CTA in
 * the manager settings pages wears; an earlier version of this forced `rounded-lg` (6px) so the
 * button would echo the bar's own corner, which made it the only pill-less button on the page and
 * read as a stray rectangle sitting in a rounded frame. A pill inside a rounded rectangle is the
 * shape the rest of this app already uses for exactly this relationship.
 *
 * `!shadow-none` cancels the elevation `Button` adds. Every variant gets a `chef*CtaClass` shadow
 * (`PREMIUM_CTA_SHADOW` / `PREMIUM_PRIMARY_SHADOW`), which is right for a CTA floating on a page and
 * wrong here: these buttons sit INSIDE a bordered bar, so a drop shadow makes them look like they are
 * hovering above their own container. The outline variant was the worst — white fill, a
 * `rgb(229,231,235)` hairline border and `rgba(15,23,42,0.05)` beneath it, which on the white bar read
 * as a shapeless pale blob rather than a button.
 *
 * `!` throughout for the same source-order reason described above: these must beat the variant
 * classes, which are emitted after the utilities.
 * `h-8` — the user's instruction, kept as given. Do not raise it again: an earlier attempt moved this
 * to `h-9` on the theory that a `rounded-full` pill needs height to clear its own end caps, and the
 * user rejected it as too big. The pill's caps are half its height, so `px-4` (16px) is what keeps the
 * label and the `→` off the curve; the height stays small.
 *
 * `gap-2 px-4` set explicitly because `tailwind-merge` had silently dropped the `Button` base's
 * `gap-2`, leaving the label and the `→` touching.
 *
 * `!hover:translate-y-0` cancels the lift. `client/src/lib/chef-cta.ts` puts
 * `hover:-translate-y-0.5` (`CTA_3D_EFFECT`) on every `Button` — a "3D" flourish that is right for a
 * CTA floating on a page and wrong here: this button sits inside a bordered bar with only 6px of
 * clearance above it, so hovering made it rise toward the bar's own edge and look like it was
 * escaping the container it belongs to.
 *
 * `!transition-colors` instead of the `CTA_3D_EFFECT`'s `transition-all`. With `transition-all`, every
 * animatable property of the button animates on hover — including ones the browser recomputes during
 * layout — and the label is laid out at a fractional x (`926.94px`), so the text visibly shifted and
 * shimmied while the transition ran. Only the colours need to change on hover here, so only the
 * colours are transitioned. The `duration-200` that came with `CTA_3D_EFFECT` is dropped with it and
 * the app's default is used.
 */
const ACTION =
  "!min-h-0 !shadow-none !transition-colors h-8 shrink-0 gap-2 px-4 text-xs hover:translate-y-0 active:translate-y-0";

/**
 * The kitchen's ENTITY HEADER, worn as one bar: which kitchen, whether it is live, what is left, and
 * the one action that follows.
 *
 * This is the header of the tabbed section below it, not a notice about the page — which is why it
 * carries no card and no alert tint. It is deliberately a SUMMARY: the reading and the deciding happen
 * on the review page, so this stays one state, one sentence and one action rather than growing a
 * checklist of its own.
 *
 * WHY IT IS ONE BAR RATHER THAN A HEADER WITH A STATUS LINE
 *
 * The publish state had no surface of its own — it was a sentence under a row, which is how a note
 * reads, not how a status reads. The three things that answer "can this kitchen earn yet?" are the
 * state, what is outstanding, and the action; on one bordered row they are one object, and the action
 * is visibly the end of that sentence rather than a control that happens to sit nearby. The bar also
 * inherits the row the manager is already looking at — the kitchen switcher's — which is the one line
 * that has to be read before anything below it makes sense.
 */
export function KitchenListingStatus({
  kitchenId,
  locationId,
  kitchenName,
  selector,
  onNavigate,
}: KitchenListingStatusProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  /**
   * Taking a kitchen off the listing is a one-click change to what chefs can book, from a button
   * that sits in a page header. It is confirmed first, and the confirmation names the consequence
   * rather than asking "are you sure" — the manager has to be able to tell what they are agreeing
   * to without remembering the page behind the dialog.
   */
  const [confirmTakeDown, setConfirmTakeDown] = useState(false);

  const { data, isLoading } = useQuery<ReadinessResponse>({
    queryKey: kitchenListingReadinessKey(kitchenId),
    queryFn: () => apiGet(`/manager/kitchens/${kitchenId}/listing-readiness`),
    enabled: Number.isFinite(kitchenId) && kitchenId > 0,
  });

  /*
   * Re-read whenever the kitchen's tab is (re)shown.
   *
   * This header stays mounted for the whole time the Kitchens view is open while its tabs are the
   * things that save, so nothing else ever asks it to re-read: the app defaults to
   * `staleTime: Infinity` with no focus refetch, and the tab components invalidate only the list they
   * are editing. Setting a cover photo therefore left this line claiming "not ready" until a full page
   * reload. `invalidateOnboardingStatus` refreshes the kitchen list on every navigation but knows
   * nothing about the checklist, which is why the status survived that too.
   *
   * Invalidating at the destination instead (the tabs that write) would mean the four of them each
   * remembering, and Equipment and Storage live on other pages entirely. This is the one place that
   * is always mounted while the answer can have changed.
   */
  useEffect(() => {
    invalidateKitchenListingState(queryClient, kitchenId, locationId);
  }, [queryClient, kitchenId, locationId]);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: kitchenListingReadinessKey(kitchenId) });

  const takeDown = async () => {
    try {
      await apiPost(`/manager/kitchens/${kitchenId}/listing-status`, { status: "draft" });
      invalidateKitchenListingState(queryClient, kitchenId, locationId);
      toast({
        title: mt("listingStatusTakenDown"),
        description: mt("listingStatusTakenDownDesc"),
      });
    } catch (error) {
      toast({
        title: mt("listingStatusPublishFailed"),
        description: error instanceof Error ? error.message : mt("listingStatusPublishFailedDesc"),
        variant: "destructive",
      });
      throw error;
    }
  };

  const takeDownAction = useStatusButton(takeDown);

  /*
   * The identity zone is built BEFORE the loading branch on purpose. The switcher is this page's only
   * route to "Add Kitchen", so unmounting it while the readiness request is in flight would make the
   * one control a manager needs disappear and then reappear, taking the row's height with it.
   *
   * NO CAPTION. It wore a "KITCHEN" eyebrow, from when this was a two-line header and the switcher
   * needed a label to read as a field rather than as the status of the row. In a single row beside
   * the status bar the eyebrow is a third block competing for the same glance — and the trigger
   * already says what it is: it is bordered and field-shaped at rest, carries the kitchen's initial
   * and a switcher glyph, and announces itself as a menu button. NN/g, *Dropdowns*: a control that
   * reveals a list is supported by "a field label **or a title**" — the switcher's own content is
   * the title here, so the bare `KITCHEN` label was redundant with the thing it was labelling.
   */
  const identity = (
    <div className="flex min-w-0 items-center gap-2">
      {selector ??
        (kitchenName ? (
          <span className="truncate text-sm font-medium">{kitchenName}</span>
        ) : null)}
    </div>
  );

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-3 pb-4">
        <div className={ROW}>
          {identity}
          {/*
           * A skeleton the same shape and height as the real bar, not a sentence saying "checking".
           * The switcher is the page's only route to "Add Kitchen" and it is already mounted above,
           * so the one control a manager needs never disappears and reappears — but the bar itself
           * must not, either: swapping a line of text for a bordered `h-9` row moves everything below
           * it the moment the request lands. `BAR_H` rather than a copy of the height, so the two
           * cannot disagree.
           */}
          <div className="min-w-[20rem] flex-1">
            <div className={cn("flex w-full items-center gap-3 rounded-lg border border-border bg-muted/40 px-3", BAR_H)}>
              <Loader2
                className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
              <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {mt("listingStatusLoading")}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { checklist, listingStatus, adminHidden } = data;
  const isListed = listingStatus === "active";
  const blockerCount = checklist.missingRequirementIds.length;
  const suggestionCount = checklist.openRecommendationIds.length;

  const tone = adminHidden
    ? TONES.hidden
    : isListed
      ? TONES.live
      : blockerCount > 0
        ? TONES.blocked
        : TONES.ready;

  const stateLabel = adminHidden
    ? mt("listingStatusHiddenLabel")
    : isListed
      ? mt("listingStatusLiveLabel")
      : mt("listingStatusDraftLabel");

  /*
   * One state, one sentence. The suggestion count is a SUFFIX and never says "below" — this card has
   * nothing below it, unlike the review page, which is where that wording came from.
   */
  const message = adminHidden
    ? mt("listingStatusHiddenDesc")
    : isListed
      ? mt("listingStatusLiveDesc")
      : blockerCount > 0
        ? mt("listingStatusNotReady", { count: blockerCount })
        : suggestionCount > 0
          ? mt("listingStatusReadyWithTips", { count: suggestionCount })
          : mt("listingStatusReady");

  const ToneIcon = tone.icon;

  return (
    /*
     * ONE BAR: [status] [what is left to do] [the action].
     *
     * This used to be three things in three places — the kitchen switcher up in a caption row, the
     * action on the far right of that row, and the state dangling underneath it as a sentence with no
     * surface of its own. Nothing said the three belonged together, so the one line that decides
     * whether this kitchen can earn money read as page furniture.
     *
     * They are one row now, sharing one border, and the row is where the eye already is — the
     * switcher's line. The bar is the ENTITY HEADER for the kitchen the tabs below it edit, not a
     * notice about the page, so it carries a hairline border rather than the `border-l-4` alert edge
     * this app reserves for page-level notices.
     *
     * The border is the quietest way to say "this is one object" and it is also the only one that
     * survives a theme change: the app's surfaces are white (`--card`) and near-white (`--muted`), so
     * a fill-only bar would be invisible at rest.
     */
    <div className="flex flex-col gap-3 pb-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        {/* The IDENTITY slots first, so the kitchen's name and its state read as one label before
            anything is asked of the reader. The bar then takes the rest of the row. */}
        {identity}

        {/*
         * `flex-1` with a `min-w` floor rather than a fixed width: the bar takes the leftover space
         * on a wide screen and wraps onto its own full-width line on a narrow one, instead of being
         * squeezed until the middle text is a three-word sliver. It is a `div` and the middle text is
         * a `p` — the overflow guard in the harness inspects paragraphs and would otherwise measure a
         * flex container's overflowing children against a client width that never shrinks.
         */}
        <div className="min-w-[20rem] flex-1">
          <div className={cn("flex w-full items-center gap-x-3 overflow-hidden rounded-lg border border-border bg-card px-3", BAR_H)}>
            {/*
             * The STATE. Tone lives in the icon; the label deliberately stays in the normal text
             * colour. Colouring it made "Not listed" read as a HYPERLINK — blue text beside a control
             * is a link to every reader, which is the one thing it is not — while the icon was already
             * saying the same thing. This is the coloured-indicator-plus-plain-label shape Vercel and
             * Linear use for status.
             */}
            <span className="flex shrink-0 items-center gap-2">
              <ToneIcon className={cn("h-4 w-4 shrink-0", tone.label)} aria-hidden="true" />
              <span className="whitespace-nowrap text-sm font-medium">{stateLabel}</span>
              {/* Non-live states get a dot: a quiet "this is a current condition", not a decoration.
                  The live state reads as an achievement and is better left clean. */}
              {!isListed && !adminHidden ? (
                <span
                  className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50"
                  aria-hidden="true"
                />
              ) : null}
            </span>

            {/*
             * The WHAT-IS-LEFT. `flex-1` so a short sentence leaves whitespace instead of stretching a
             * rule across the bar.
             *
             * `truncate` — one line that clips when it has to. The bar is a fixed height, and the
             * message must never make it taller than the control beside it; the full sentence is on the
             * review page the button opens. `min-w-0` is what actually permits the shrink: without it a
             * truncating child's automatic minimum size is its content width, so it would overflow the
             * bar instead of clipping.
             */}
            <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{message}</p>

            {/* The ACTION, against the bar's trailing edge where a CTA belongs. */}
            {isListed ? (
              /*
               * Outline, and it only OPENS a confirmation — the work happens in the dialog, so this
               * button carries no loading or success state of its own.
               *
               * `style={{ backgroundColor: "transparent" }}` rather than a `bg-transparent` class.
               * The outline variant sets `bg-background`, which is WHITE — the same as the bar behind
               * it — so the fill drew nothing and the button was defined only by a hairline border.
               *
               * The class route does not work here, and that was MEASURED, not assumed: the rendered
               * class list comes back as `... border border-input bg-background ... !min-h-0
               * !shadow-none h-8 ...` — tailwind-merge drops `bg-transparent` and `!bg-transparent`
               * alike as conflicts with `bg-background` and keeps the variant's copy, so the fill
               * stayed white either way. An inline style is outside the merge and the cascade, which
               * makes it the correct tool for overriding one property on a component whose classes
               * this component does not own.
               */
              <Button
                variant="outline"
                size="sm"
                className={ACTION}
                style={{ backgroundColor: "transparent" }}
                onClick={() => setConfirmTakeDown(true)}
              >
                {mt("listingStatusTakeDown")}
              </Button>
            ) : (
              /*
               * FILLED, unlike the take-down button above, and it carries an arrow. This is the
               * page's primary action — the one that puts the kitchen in front of chefs — and the bar
               * is the only place it appears. The arrow earns its place by naming the OUTCOME: the
               * label describes the review, and moving through a review into a listing is exactly
               * what "→" means. No new copy, no new string to translate.
               */
              <Button
                size="sm"
                className={ACTION}
                onClick={() => onNavigate?.("listing-review", kitchenId)}
              >
                {mt("listingStatusReviewAndGoLive")}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/*
       * Taking the kitchen off the listing is confirmed first, and the confirmation NAMES THE
       * CONSEQUENCE rather than asking "are you sure" — the same shape the delete-kitchen dialog on
       * Details & Pricing uses, for the same reason: a dialog is read on its own, with the page that
       * gave it its context hidden behind it.
       *
       * Every claim in the copy is checked against the endpoint (`PUT /manager/kitchens/:id/
       * listing-status`): it writes `listing_status` and nothing else, so accepted bookings really are
       * untouched and re-listing really is available. It also names the kitchen, because a location
       * can hold several and the header's switcher is not visible behind the dialog.
       */}
      <AlertDialog open={confirmTakeDown} onOpenChange={setConfirmTakeDown}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mt("listingTakeDownConfirmTitle", { kitchen: data.details.kitchenName })}
            </AlertDialogTitle>
            <AlertDialogDescription>{mt("listingTakeDownConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={takeDownAction.status === "loading"}>
              {mt("listingTakeDownConfirmKeep")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={takeDownAction.status === "loading"}
              onClick={(event) => {
                // Keep the dialog open while the request runs, so a failure is reported in place
                // rather than leaving the manager to guess whether it went through.
                event.preventDefault();
                void takeDownAction.execute().finally(() => setConfirmTakeDown(false));
              }}
            >
              {takeDownAction.status === "loading" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {mt("listingStatusTakeDown")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default KitchenListingStatus;
