import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TransactionTable } from "./TransactionTable";
import type { Transaction } from "../types";

vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
afterEach(cleanup);

it("groups reference with chef and creation date with kitchen while retaining financial columns", () => {
  const transaction: Transaction = { id: 1, transactionId: 2, bookingId: 3, bookingType: "kitchen", bookingDate: "2026-10-25", chefId: 4, chefName: "Jamie", kitchenId: 5, kitchenName: "Kitchen East", locationId: 6, locationName: "Sunlight Kitchens", referenceCode: "KB-TEST", totalPrice: 10000, managerRevenue: 10000, platformFee: 0, taxAmount: 0, taxRatePercent: 0, serviceFee: 0, stripeFee: 200, netRevenue: 9800, paymentStatus: "paid", paymentIntentId: null, currency: "CAD", createdAt: "2026-09-28T12:00:00Z", paidAt: null, refundAmount: 0, refundableAmount: 9800 };
  render(<TransactionTable transactions={[transaction]} isLoading={false} onDownloadInvoice={vi.fn()} />);
  const table = screen.getByRole("table");
  const cells = within(table).getAllByRole("cell");
  const chef = cells.find((cell) => cell.textContent?.includes("Jamie"))!;
  expect(within(chef).getByText("#KB-TEST")).toBeInTheDocument();
  const kitchen = cells.find((cell) => cell.textContent?.includes("Kitchen East"))!;
  expect(within(kitchen).getByText("transactionCreatedOn")).toBeInTheDocument();
  expect(within(table).getAllByRole("columnheader")).toHaveLength(10);
  for (const label of ["kitchenSubtotal", "taxHeader", "stripeFee", "refunded", "managerPayout"]) {
    expect(within(table).getByText(label)).toBeInTheDocument();
  }
});
