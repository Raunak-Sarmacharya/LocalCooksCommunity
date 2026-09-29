import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The prerequisite screens — what a manager sees when the thing a page is about does not exist yet.
 *
 * These exist because the alternative was a dead end repeated many times over: nine settings views
 * saying "Select a Location" over "Choose a location to manage kitchens" with nothing to select,
 * and a publish review saying "No Kitchen Selected" over "Please select a kitchen first". NN/g's
 * third empty-state guideline names that anti-pattern — it says WHAT is missing and never HOW to
 * fix it — so each of these has to state the thing and be able to produce one.
 *
 * The kitchen one carries two cases because `hasKitchen` decides the words, and getting them wrong
 * tells a manager to add a kitchen they already have.
 */
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/components/manager/locations/LocationSetupForm", () => ({
  LocationSetupForm: ({ onCancel }: { onCancel?: () => void }) => (
    <div data-testid="location-setup-form">
      <button type="button" onClick={onCancel}>cancel</button>
    </div>
  ),
}));

import { NeedsKitchen, NeedsLocation } from "./NeedsPrerequisite";

afterEach(() => cleanup());

describe("NeedsLocation", () => {
    it("says what a location is, not merely that one is missing", () => {
        render(<NeedsLocation />);

        expect(screen.getByText("addYourLocationFirstTitle")).toBeInTheDocument();
        expect(screen.getByText("addYourLocationFirstBody")).toBeInTheDocument();
        // The old copy, which named the state and stopped there.
        expect(screen.queryByText("selectALocation")).not.toBeInTheDocument();
    });

    it("swaps the empty state for the form IN PLACE — no dialog, no overlay", () => {
        /*
         * The form used to open as a dialog. It appeared over a page that is EMPTY anyway, so the
         * overlay dimmed nothing and only added a layer — and it scrolled, which is the signal that
         * the content had outgrown the pattern. It now replaces the empty state in the same slot.
         */
        render(<NeedsLocation />);
        expect(screen.queryByTestId("location-setup-form")).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "addYourLocation" }));

        expect(screen.getByTestId("location-setup-form")).toBeInTheDocument();
        // The empty state is GONE rather than covered: nothing is layered over anything.
        expect(screen.queryByText("addYourLocationFirstTitle")).not.toBeInTheDocument();
    });

    it("goes back to the empty state if the manager changes their mind", () => {
        render(<NeedsLocation />);
        fireEvent.click(screen.getByRole("button", { name: "addYourLocation" }));

        fireEvent.click(screen.getByRole("button", { name: "cancel" }));

        expect(screen.queryByTestId("location-setup-form")).not.toBeInTheDocument();
        expect(screen.getByText("addYourLocationFirstTitle")).toBeInTheDocument();
    });
});

describe("NeedsKitchen", () => {
    it("asks for a kitchen when there is none", () => {
        render(<NeedsKitchen hasKitchen={false} onGoToKitchens={vi.fn()} />);

        expect(screen.getByText("noKitchenTitle")).toBeInTheDocument();
        expect(screen.getByText("addYourKitchenFirstBody")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "addYourKitchen" })).toBeInTheDocument();
    });

    it("asks which kitchen when one exists but the review has no target", () => {
        /*
         * The publish review resolves its kitchen from an explicit choice or the URL, so a reload
         * lands here with a kitchen and no target. Telling that manager to "add a kitchen" would be
         * a small insult, and the old copy told them to select one without listing any.
         */
        render(<NeedsKitchen hasKitchen onGoToKitchens={vi.fn()} />);

        expect(screen.getByText("chooseAKitchenToReviewTitle")).toBeInTheDocument();
        expect(screen.queryByText("noKitchenTitle")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "navKitchens" })).toBeInTheDocument();
    });

    it("sends the manager somewhere the problem can actually be solved", () => {
        const go = vi.fn();
        render(<NeedsKitchen hasKitchen={false} onGoToKitchens={go} />);

        fireEvent.click(screen.getByRole("button", { name: "addYourKitchen" }));

        expect(go).toHaveBeenCalledTimes(1);
    });
});
