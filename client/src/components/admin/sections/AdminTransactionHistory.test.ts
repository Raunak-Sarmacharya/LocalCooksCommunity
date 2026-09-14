import { describe, expect, it } from "vitest";
import { filterTransactionsByStatus, type AdminTransaction } from "./AdminTransactionHistory";

const transaction = (status: string, refundAmount = 0) => ({ status, refundAmount, metadata: null }) as AdminTransaction;

describe("filterTransactionsByStatus", () => {
  const transactions = [transaction("succeeded"), transaction("pending"), transaction("partially_refunded", 100), transaction("failed")];

  it("keeps tab filters independent from the full source list", () => {
    expect(filterTransactionsByStatus(transactions, "all")).toHaveLength(4);
    expect(filterTransactionsByStatus(transactions, "succeeded")).toEqual([transactions[0]]);
    expect(filterTransactionsByStatus(transactions, "pending")).toEqual([transactions[1]]);
    expect(filterTransactionsByStatus(transactions, "refunded")).toEqual([transactions[2]]);
    expect(filterTransactionsByStatus(transactions, "failed")).toEqual([transactions[3]]);
  });
});
