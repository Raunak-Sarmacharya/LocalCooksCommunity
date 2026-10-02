/**
 * REGRESSION HARNESS — DataTable mobile card view
 *
 * Why this file exists.
 *
 * DataTable handled mobile by scrolling a `whitespace-nowrap` table sideways.
 * At 375px that is unreadable, so each row now also renders as a label/value
 * card below `md`.
 *
 * The card view reads per-column config off `ColumnDef.meta`, which TanStack
 * types as `unknown`. So label resolution (`meta.mobileLabel` → a string
 * `header` → nothing) and the `mobileHidden` opt-out are exactly the parts that
 * regress silently: a wrong label is invisible until someone opens the page on
 * a phone.
 *
 * jsdom does not evaluate CSS breakpoints, so these tests assert that BOTH
 * trees render with the visibility classes that swap them, and that the card
 * tree resolves labels correctly. They cannot assert which tree is *visible*.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "./data-table";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

interface Row {
  name: string;
  status: string;
  audit: string;
}

const rows: Row[] = [
  { name: "Ada", status: "active", audit: "2026-01-01" },
  { name: "Grace", status: "paused", audit: "2026-01-02" },
];

const columns: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Name", cell: ({ row }) => row.original.name },
  {
    accessorKey: "status",
    header: <span>Status</span>,
    meta: { mobileLabel: "State" },
    cell: ({ row }) => row.original.status,
  },
  {
    accessorKey: "audit",
    header: "Audit",
    meta: { mobileHidden: true },
    cell: ({ row }) => row.original.audit,
  },
];

describe("DataTable mobile card view", () => {
  it("hides pagination for one page and shows it when rows span pages", () => {
    const { rerender } = render(<DataTable columns={columns} data={rows} pageSize={2} />);
    expect(screen.queryByRole("button", { name: "previous" })).toBeNull();
    expect(screen.queryByRole("button", { name: "next" })).toBeNull();

    rerender(<DataTable columns={columns} data={[...rows, { name: "Lin", status: "active", audit: "2026-01-03" }]} pageSize={2} />);
    expect(screen.getByRole("button", { name: "previous" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "next" })).toBeTruthy();
  });

  it("renders both trees with the breakpoint classes that swap them", () => {
    render(<DataTable columns={columns} data={rows} />);

    const desktop = screen.getByTestId("data-table-desktop");
    const mobile = screen.getByTestId("data-table-mobile");

    expect(desktop.className).toContain("hidden");
    expect(desktop.className).toContain("md:block");
    expect(mobile.className).toContain("md:hidden");
  });

  it("renders one card per row", () => {
    render(<DataTable columns={columns} data={rows} />);

    const mobile = screen.getByTestId("data-table-mobile");
    expect(within(mobile).getByText("Ada")).toBeTruthy();
    expect(within(mobile).getByText("Grace")).toBeTruthy();
  });

  it("labels a field from a string header, and from meta.mobileLabel when the header is a node", () => {
    render(<DataTable columns={columns} data={rows} />);

    const mobile = screen.getByTestId("data-table-mobile");
    // One label per card, so one per row.
    expect(within(mobile).getAllByText("Name")).toHaveLength(rows.length);
    expect(within(mobile).getAllByText("State")).toHaveLength(rows.length);
  });

  it("drops a mobileHidden column from the cards but keeps it in the table", () => {
    render(<DataTable columns={columns} data={rows} />);

    expect(within(screen.getByTestId("data-table-mobile")).queryByText("2026-01-01")).toBeNull();
    expect(within(screen.getByTestId("data-table-desktop")).getByText("2026-01-01")).toBeTruthy();
  });

  it("shows the empty message in the card view when there are no rows", () => {
    render(<DataTable columns={columns} data={[]} />);

    const mobile = screen.getByTestId("data-table-mobile");
    expect(within(mobile).getByText("noResults")).toBeTruthy();
  });

  /*
   * The card used to render every field as its own full-width label/value block, so a wide table
   * became a single tall column of fields. It is now an identity row plus a two-column grid — these
   * assert the shape, because jsdom cannot tell anyone how tall a card is.
   */
  it("gives the first detail column its own full-width identity row", () => {
    render(<DataTable columns={columns} data={rows} />);

    const card = screen.getByTestId("data-table-mobile").querySelector(".data-table-mobile-card") as HTMLElement;
    expect(card).toBeTruthy();

    const identity = card.firstElementChild as HTMLElement;
    expect(identity.className).toContain("border-b");
    expect(within(identity).getByText("Ada")).toBeTruthy();
  });

  it("lays the remaining fields out in a two-column grid, not one field per line", () => {
    render(<DataTable columns={columns} data={rows} />);

    const grid = screen.getByTestId("data-table-mobile").querySelector(".grid-cols-2") as HTMLElement;
    expect(grid).toBeTruthy();
    // `status` is the only remaining field in the fixture, so it must live inside that grid.
    expect(within(grid).getByText("active")).toBeTruthy();
  });

  it("gives a field the whole row when its column opts in with mobileSpan", () => {
    const withWideField: ColumnDef<Row>[] = [
      { accessorKey: "name", header: "Name", cell: ({ row }) => row.original.name },
      {
        accessorKey: "status",
        header: "Status",
        meta: { mobileSpan: "full" },
        cell: ({ row }) => row.original.status,
      },
    ];
    render(<DataTable columns={withWideField} data={rows} />);

    const grid = screen.getByTestId("data-table-mobile").querySelector(".grid-cols-2") as HTMLElement;
    const value = within(grid).getByText("active");
    expect(value.parentElement?.className).toContain("col-span-2");
  });
});
