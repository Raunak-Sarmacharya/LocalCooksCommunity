import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CustomAlertsProvider, useCustomAlerts } from "./custom-alerts";

function Opener({ mode }: { mode: "single" | "two" }) {
  const { showAlert } = useCustomAlerts();
  return (
    <button
      type="button"
      onClick={() =>
        showAlert(
          mode === "single"
            ? { title: "Saved", description: "All good.", type: "success", confirmText: "Done" }
            : {
                title: "This account can't manage kitchens",
                description: "Use the account you manage your kitchens with.",
                type: "warning",
                confirmText: "Try a different account",
                secondaryText: "Back to main page",
              },
        )
      }
    >
      open
    </button>
  );
}

function open(mode: "single" | "two") {
  render(
    <CustomAlertsProvider>
      <Opener mode={mode} />
    </CustomAlertsProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "open" }));
}

describe("custom alerts", () => {
  it("declares the dialog modal — Radix hides the app but never emits this", async () => {
    open("single");
    const dialog = await screen.findByRole("alertdialog");

    // The APG requires aria-modal="true" on the alertdialog container, and it is
    // truthful: Radix traps focus and paints a scrim.
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby");
    expect(dialog).toHaveAttribute("aria-describedby");
  });

  it("focuses the confirming action when there is no dismissive one", async () => {
    // Radix's AlertDialog focuses the *dismissive* action and preventDefaults its
    // own fallback, so with no dismissive action focus was left on <body> and
    // the dialog was announced to nobody (WCAG 2.4.3). Most alerts in this app
    // are single-action, so this regressed everywhere.
    open("single");
    await screen.findByRole("alertdialog");

    await waitFor(() => expect(document.activeElement?.textContent).toBe("Done"));
  });

  it("renders the dismissive action to the left of the confirming one", async () => {
    open("two");
    await screen.findByRole("alertdialog");

    const actions = screen
      .getAllByRole("button")
      .filter((b) => b.textContent !== "open")
      .map((b) => b.textContent);

    expect(actions).toEqual(["Back to main page", "Try a different account"]);
  });

  it("runs the secondary handler and closes when the dismissive action is used", async () => {
    const onSecondary = vi.fn();
    function SecondaryOpener() {
      const { showAlert } = useCustomAlerts();
      return (
        <button
          type="button"
          onClick={() =>
            showAlert({
              title: "Not a manager",
              description: "Use another account.",
              confirmText: "Try a different account",
              secondaryText: "Back to main page",
              onSecondary,
            })
          }
        >
          open
        </button>
      );
    }

    render(
      <CustomAlertsProvider>
        <SecondaryOpener />
      </CustomAlertsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.click(await screen.findByRole("button", { name: "Back to main page" }));

    expect(onSecondary).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });
});
