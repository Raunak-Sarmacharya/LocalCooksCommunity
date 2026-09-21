import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ManagerGettingStarted } from "./ManagerGettingStarted";
import type { ManagerSetupStep } from "@/hooks/use-onboarding-status";

vi.mock("@/i18n/manager", () => ({
  mt: (key: string, options?: Record<string, unknown>) => {
    if (key === "managerGettingStarted") return "Getting started";
    if (key === "managerSetupProgress") return `${options?.completed} of ${options?.total} complete`;
    if (key === "managerSetupStepProfile") return "Complete your profile";
    if (key === "managerSetupStepLicense") return "Upload your license";
    if (key === "managerSetupStepKitchen") return "Add a kitchen";
    if (key === "managerSetupStepAvailability") return "Set your availability";
    if (key === "managerSetupStepRequirements") return "Set chef requirements";
    if (key === "managerSetupStepPayments") return "Connect Stripe";
    return key;
  },
}));

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(cleanup);

const steps: ManagerSetupStep[] = [
  { id: "license", labelKey: "managerSetupStepLicense", complete: true },
  { id: "kitchen", labelKey: "managerSetupStepKitchen", complete: false },
  { id: "availability", labelKey: "managerSetupStepAvailability", complete: false },
  { id: "requirements", labelKey: "managerSetupStepRequirements", complete: false },
  { id: "payments", labelKey: "managerSetupStepPayments", complete: false },
];

describe("ManagerGettingStarted", () => {
  it("opens a flyout and deep-links the row that was clicked", () => {
    const onSelectStep = vi.fn();
    render(
      <SidebarProvider>
        <ManagerGettingStarted steps={steps} onSelectStep={onSelectStep} />
      </SidebarProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Getting started: 1 of 5 complete" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "1 of 5 complete" })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("list", { name: "1 of 5 complete" })).toBeInTheDocument();

    // Rows carry no CTA — the row itself is the control, and it closes the flyout.
    fireEvent.click(screen.getByRole("button", { name: "Add a kitchen" }));
    expect(onSelectStep).toHaveBeenCalledWith("kitchen");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps finished rows read-only", () => {
    const onSelectStep = vi.fn();
    render(
      <SidebarProvider>
        <ManagerGettingStarted steps={steps} onSelectStep={onSelectStep} />
      </SidebarProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Getting started: 1 of 5 complete" }));

    // license is complete: still listed, but not a button and not navigable
    expect(screen.getByText("Upload your license")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload your license" })).not.toBeInTheDocument();
    expect(onSelectStep).not.toHaveBeenCalled();
  });

  it("disappears when every setup step is complete", () => {
    render(
      <SidebarProvider>
        <ManagerGettingStarted steps={steps.map((step) => ({ ...step, complete: true }))} onSelectStep={() => undefined} />
      </SidebarProvider>,
    );

    expect(screen.queryByRole("button", { name: /Getting started/ })).not.toBeInTheDocument();
  });

  it("opens the flyout without expanding the collapsed sidebar", () => {
    const onOpenChange = vi.fn();
    render(
      <SidebarProvider open={false} onOpenChange={onOpenChange}>
        <ManagerGettingStarted steps={steps} onSelectStep={() => undefined} />
      </SidebarProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Getting started: 1 of 5 complete" }));
    expect(screen.getByRole("list", { name: "1 of 5 complete" })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("stays visible for listing improvements after required setup is complete", () => {
    const onImprove = vi.fn();
    const improvement = "Add a cover photo to every kitchen";
    render(
      <SidebarProvider>
        <ManagerGettingStarted
          steps={steps.map((step) => ({ ...step, complete: true }))}
          improvementSteps={[improvement]}
          onImprove={onImprove}
        />
      </SidebarProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Getting started: 5 of 6 complete" }));
    fireEvent.click(screen.getByRole("button", { name: improvement }));
    expect(onImprove).toHaveBeenCalledWith(improvement);
  });
});
