import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { MobileTableCards } from "./mobile-table-cards";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

type RecordRow = { name: string; address: string };
const data: RecordRow[] = [{ name: "Kitchen One", address: "A long address that must remain readable" }];
const columns: ColumnDef<RecordRow>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "address", header: "Address" },
  { id: "actions", cell: () => <button type="button">Edit</button> },
];

function Fixture({ onOpen }: { onOpen: (row: RecordRow) => void }) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  return <MobileTableCards rows={table.getRowModel().rows} onRowClick={onOpen} />;
}

describe("mobile table cards", () => {
  it("shows full record details and keeps action clicks separate from row clicks", () => {
    const onOpen = vi.fn();
    render(<Fixture onOpen={onOpen} />);
    const card = screen.getByRole("button", { name: /Kitchen One/ });
    expect(within(card).getByText("A long address that must remain readable")).toBeTruthy();
    fireEvent.click(within(card).getByText("Edit"));
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByText("Kitchen One"));
    expect(onOpen).toHaveBeenCalledWith(data[0]);
  });
});
