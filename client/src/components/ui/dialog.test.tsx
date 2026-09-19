import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

describe("dialog primitive", () => {
  it("declares the dialog modal — Radix hides the app but never emits this", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Kitchen settings</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    // The APG requires aria-modal="true" on a non-native dialog container. Radix
    // satisfies the *effect* with aria-hidden on the sibling layer but leaves the
    // attribute off, so this is supplied by the wrapper.
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("lets a genuinely non-modal dialog opt out", () => {
    // Marking a dialog modal when it is not is worse than omitting it: assistive
    // tech would then hide content the user can still reach.
    render(
      <Dialog open modal={false}>
        <DialogContent aria-modal={undefined}>
          <DialogTitle>Find bar</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-modal");
  });
});
