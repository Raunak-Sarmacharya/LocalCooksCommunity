import { createRoot } from "react-dom/client";
import { KitchenGridCard } from "./components/kitchen/KitchenGridCard";
import { DataTable } from "./components/ui/data-table";
import { TooltipProvider } from "./components/ui/tooltip";
import "./index.css";
import "./i18n";

const columns = [
  { accessorKey: "name", header: "Name", cell: ({ row }: any) => <div className="truncate max-w-[150px]">{row.original.name}</div> },
  { accessorKey: "address", header: "Address", cell: ({ row }: any) => <div className="truncate max-w-[300px]">{row.original.address}</div> },
  { id: "actions", cell: () => <button className="rounded border px-3 py-2">Edit</button> },
];

createRoot(document.getElementById("root")!).render(<TooltipProvider><main className="mx-auto max-w-5xl space-y-6 p-4">
  <KitchenGridCard title="A very long kitchen name that should remain readable on a phone" address="123 An Extremely Long Avenue Address, Toronto, Ontario" overlayChip={<span className="rounded-full bg-white px-2 py-1 text-xs">Not taking bookings</span>} actions={<button className="min-h-11 w-full rounded-xl bg-primary px-3 py-2 text-white">This kitchen is not taking bookings right now</button>} />
  <DataTable columns={columns} data={[{ name: "A very long kitchen name that should remain readable", address: "123 An Extremely Long Avenue Address, Toronto, Ontario" }]} />
</main></TooltipProvider>);
