import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RentalCard } from "./ChefStoragePage";
import type { StorageRental } from "@/lib/storage-rentals";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en-CA" } }) }));
vi.mock("wouter", () => ({ Link: ({ href, children }: any) => <a href={href}>{children}</a> }));
vi.mock("@/components/storage/StoragePageShell", () => ({ StoragePageShell: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/components/chef/PendingOverstayPenalties", () => ({ PendingOverstayPenalties: () => null }));
vi.mock("@/hooks/use-chef-kitchen-applications", () => ({ useChefKitchenApplications: () => ({ applications: [] }) }));
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({}) }));
vi.mock("@/lib/session-extensions", () => ({ completeCardAction: vi.fn() }));
afterEach(cleanup);

it("shows only View under removal review even if a cached DTO advertises Extend", () => {
  const rental = { id: 3, kitchen: { name: "Harbour" }, listing: { name: "Shelf" }, unitLabel: "2", state: "removal_review", phase: "holdover",
    startOn: "2026-09-01", paidThrough: "2026-09-30", terms: [], actions: ["extend"] } as unknown as StorageRental;
  render(<RentalCard rental={rental} />);
  expect(screen.getByRole("link", { name: "stcView" })).toHaveAttribute("href", "/storage/3");
  expect(screen.queryByRole("link", { name: "stcExtend" })).toBeNull();
});
