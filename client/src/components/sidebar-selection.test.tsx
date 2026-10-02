import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ user: null, logout: vi.fn() }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/components/i18n/LanguageSwitcher", () => ({ LanguageMenuSection: () => null }));
vi.mock("@/components/auth/ProfileGettingStarted", () => ({ default: () => null }));
vi.mock("@/components/manager/ManagerGettingStarted", () => ({ default: () => null }));

import { AppSidebar } from "./app-sidebar";
import { ChefSidebar } from "./chef/ChefSidebar";
import { SidebarProvider } from "./ui/sidebar";

describe("sidebar destination selection", () => {
  it("selects a chef child without also selecting its parent", () => {
    const { container } = render(<SidebarProvider><ChefSidebar activeView="kitchen-requests" onViewChange={vi.fn()} /></SidebarProvider>);
    const selected = container.querySelectorAll('[data-sidebar][data-active="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAttribute("data-sidebar", "menu-sub-button");
  });

  it("selects a manager child without requiring breadcrumbs", () => {
    const { container, getByText } = render(<SidebarProvider><AppSidebar activeView="damage-claims" onViewChange={vi.fn()} locations={[]} selectedLocation={null} onLocationChange={vi.fn()} /></SidebarProvider>);
    fireEvent.click(getByText("navBookings"));
    const selected = container.querySelectorAll('[data-sidebar][data-active="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent("navDamageClaims");
  });
});
