import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ManagerGettingStarted } from "./ManagerGettingStarted";
import type { ManagerSetupStep } from "@/hooks/use-onboarding-status";

vi.mock("@/i18n/manager", () => ({
  mt: (key: string, options?: Record<string, unknown>) => {
    if (key === "managerGettingStarted") return "Getting started";
    if (key === "managerSetupProgress") return `${options?.completed} of ${options?.total} complete`;
    if (key === "continueSetup") return "Continue Setup";
    if (key === "completeListing") return "Complete listing";
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
  { id: "license", labelKey: "onboardingKitchenLicense", complete: true },
  { id: "kitchen", labelKey: "onboardingKitchenSpace", complete: false },
  { id: "availability", labelKey: "onboardingAvailability", complete: false },
  { id: "requirements", labelKey: "onboardingChefRequirements", complete: false },
  { id: "payments", labelKey: "onboardingPayments", complete: false },
];

describe("ManagerGettingStarted", () => {
  it("opens a flyout, closes it, and resumes setup from the sidebar", () => {
    const onContinue = vi.fn();
    render(
      <SidebarProvider>
        <ManagerGettingStarted steps={steps} onContinue={onContinue} />
      </SidebarProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Getting started: 1 of 5 complete" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "1 of 5 complete" })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("list", { name: "1 of 5 complete" })).toBeInTheDocument();
    expect(screen.getAllByText("onboardingKitchenSpace")).toHaveLength(1);

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Continue Setup" }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("disappears when every setup step is complete", () => {
    render(
      <SidebarProvider>
        <ManagerGettingStarted steps={steps.map((step) => ({ ...step, complete: true }))} onContinue={() => undefined} />
      </SidebarProvider>,
    );

    expect(screen.queryByRole("button", { name: /Getting started/ })).not.toBeInTheDocument();
  });

  it("opens the flyout without expanding the collapsed sidebar", () => {
    const onOpenChange = vi.fn();
    render(
      <SidebarProvider open={false} onOpenChange={onOpenChange}>
        <ManagerGettingStarted steps={steps} onContinue={() => undefined} />
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
    expect(screen.getByText(improvement)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Complete listing" }));
    expect(onImprove).toHaveBeenCalledWith(improvement);
  });
});
