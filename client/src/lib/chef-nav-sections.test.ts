import assert from "node:assert/strict";
import { sidebarBranchForView, type ChefBreadcrumb } from "./chef-nav-sections";

{
  // Discover → kitchen → book nests under Discover (book is child of kitchen in UI)
  const crumbs: ChefBreadcrumb[] = [
    { label: "Dashboard", navId: "overview" },
    { label: "Discover", navId: "discover-kitchens", onClick: () => {} },
    { label: "Satya Test", onClick: () => {} },
    { label: "Book a kitchen" },
  ];
  const branch = sidebarBranchForView(crumbs, "discover-kitchens");
  assert.equal(branch.length, 2);
  assert.equal(branch[0].label, "Satya Test");
  assert.equal(branch[1].label, "Book a kitchen");
}

{
  // No nested trail when only the nav item itself is in the crumbs
  const crumbs: ChefBreadcrumb[] = [
    { label: "Dashboard", navId: "overview" },
    { label: "Discover", navId: "discover-kitchens" },
  ];
  assert.deepEqual(sidebarBranchForView(crumbs, "discover-kitchens"), []);
}

{
  // Default layout: Dashboard + Overview both tagged overview — do not mirror Overview under itself
  const crumbs: ChefBreadcrumb[] = [
    { label: "Dashboard", navId: "overview", onClick: () => {} },
    { label: "Overview", navId: "overview" },
  ];
  assert.deepEqual(sidebarBranchForView(crumbs, "overview"), []);
}

{
  assert.deepEqual(sidebarBranchForView(undefined, "bookings"), []);
}

console.log("chef-nav-sections.test.ts: ok");
