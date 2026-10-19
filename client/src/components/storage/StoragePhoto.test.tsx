import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StorageStatusChip } from "@/components/manager/storage/StorageStatusChip";
import { StoragePhoto } from "./StoragePhoto";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key === "stChipFree" ? "Available" : key }) }));
afterEach(cleanup);

it.each(["dry", "cold", "frozen", "other"])("shows a type placeholder for %s without photos", kind => {
  render(<StoragePhoto storageType={kind} photos={[]} />);
  expect(screen.getByRole("img", { name: `stPhoto_${kind}` })).toBeVisible();
  expect(document.querySelector("img")).toBeNull();
});

it("uses an uploaded photo with a type fallback underneath", () => {
  render(<StoragePhoto storageType="freezer" photos={["https://images.example/freezer.jpg"]} />);
  expect(document.querySelector("img")).toHaveAttribute("src", "https://images.example/freezer.jpg");
  expect(screen.getByRole("img", { name: "stPhoto_frozen" })).toBeInTheDocument();
});

it("calls an empty unit Available", () => {
  render(<StorageStatusChip chip="free" />);
  expect(screen.getByText("Available")).toBeInTheDocument();
  expect(screen.queryByText("Free")).toBeNull();
});
