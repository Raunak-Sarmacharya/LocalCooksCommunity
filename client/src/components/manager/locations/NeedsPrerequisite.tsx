import { useState } from "react";
import { CookingPot, MapPin } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { mt } from "@/i18n/manager";
import { LocationSetupForm } from "./LocationSetupForm";

/**
 * The prerequisite screens: what a manager sees when the thing a page is about does not exist yet.
 *
 * Two of them, and they exist because the alternative was a dead end repeated many times over. The
 * dashboard used to answer both cases with a sentence and no action:
 *
 *   - nine settings views said "Select a Location" over "Choose a location to manage kitchens" —
 *     with no location in existence and nothing on the page that could make one;
 *   - the publish review said "No Kitchen Selected" over "Please select a kitchen first" — with
 *     nothing to select.
 *
 * NN/g's third empty-state guideline is exactly this: an empty state should *"provide direct
 * pathways for key tasks"*, and copy that says WHAT is missing without telling HOW to fix it is the
 * named anti-pattern. So each of these says what the thing IS, and each can produce one.
 *
 * They share one shell on purpose. Two copies of the same layout is how the nine versions of the
 * first dead end came about, and the shell is the part that must not drift.
 */

function Notice({
    icon,
    titleKey,
    bodyKey,
    actionKey,
    onAction,
}: {
    icon: React.ReactNode;
    titleKey: string;
    bodyKey: string;
    actionKey: string;
    onAction: () => void;
}) {
    return (
        <div className="rounded-[1.35rem] border border-dashed border-border bg-card p-10 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted ring-1 ring-border">
                {icon}
            </div>
            <h3 className="font-semibold text-foreground">{mt(titleKey)}</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
                {mt(bodyKey)}
            </p>
            <Button className="mt-5" onClick={onAction}>{mt(actionKey)}</Button>
        </div>
    );
}

/**
 * No location at all.
 *
 * Reachable only with zero locations, and that is now guaranteed rather than hoped for: the
 * dashboard auto-selects the first location as soon as one exists, so `selectedLocation === null`
 * means "has none", never "has not chosen yet". Without that, this screen would be wrong for a
 * manager who simply had not picked from several.
 *
 * The form appears IN PLACE, not in a dialog. It used to be a dialog, and the reason that was
 * wrong is worth keeping: it scrolled (six fields, two uploads, a date picker — SaaSUI: *"a scrolling
 * modal usually means the content outgrew the pattern"*), and it opened over a page that is EMPTY
 * anyway, so the overlay dimmed nothing and only added a layer. See `LocationSetupForm` for the full
 * note.
 *
 * No callback prop, deliberately: the form invalidates the locations query, and the dashboard
 * auto-selects the first location as soon as one exists. Selection is the dashboard's job and it
 * already does it — passing the created row up would be a second way to set the same state.
 */
export function NeedsLocation() {
    const [isAdding, setIsAdding] = useState(false);

    if (isAdding) {
        // Same slot, same width, no overlay: the empty state becomes the form.
        return <LocationSetupForm onCancel={() => setIsAdding(false)} />;
    }

    return (
        <Notice
            icon={<MapPin className="h-6 w-6 text-muted-foreground" />}
            titleKey="addYourLocationFirstTitle"
            bodyKey="addYourLocationFirstBody"
            actionKey="addYourLocation"
            onAction={() => setIsAdding(true)}
        />
    );
}

/**
 * No kitchen — or a kitchen the review was never told to open.
 *
 * Two cases, one destination, and the copy says which one it is. `hasKitchen` distinguishes them:
 * the publish review is per-kitchen and resolves its target from an explicit choice or the URL, so
 * a manager who reloads the page has a kitchen and no target. Telling them to "add a kitchen" when
 * they already have one is its own small insult.
 *
 * The action goes to the Kitchens view in both cases, because that is where a kitchen is created and
 * where one is chosen — and it already seeds itself from the first kitchen, so a single-kitchen
 * manager is one click from the review rather than being asked to pick from a list of one.
 */
export function NeedsKitchen({ hasKitchen, onGoToKitchens }: { hasKitchen: boolean; onGoToKitchens: () => void }) {
    return (
        <Notice
            icon={<CookingPot className="h-6 w-6 text-muted-foreground" />}
            titleKey={hasKitchen ? "chooseAKitchenToReviewTitle" : "noKitchenTitle"}
            bodyKey={hasKitchen ? "chooseAKitchenToReviewBody" : "addYourKitchenFirstBody"}
            actionKey={hasKitchen ? "navKitchens" : "addYourKitchen"}
            onAction={onGoToKitchens}
        />
    );
}
