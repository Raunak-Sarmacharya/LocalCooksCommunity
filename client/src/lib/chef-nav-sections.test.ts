import assert from "node:assert/strict";
import { sidebarBranchForView, type ChefBreadcrumb } from "./chef-nav-sections";

{
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
  const crumbs: ChefBreadcrumb[] = [
    { label: "Dashboard", navId: "overview" },
    { label: "Discover", navId: "discover-kitchens" },
  ];
  assert.deepEqual(sidebarBranchForView(crumbs, "discover-kitchens"), []);
}

{
  assert.deepEqual(sidebarBranchForView(undefined, "bookings"), []);
}

console.log("chef-nav-sections.test.ts: ok");
