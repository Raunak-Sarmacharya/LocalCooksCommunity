import assert from "node:assert/strict";
import { chefNavSections, findChefNavItem, sidebarBranchForView, type ChefBreadcrumb } from "./chef-nav-sections";
import { getIcon } from "@iconify/react";
import { KITCHEN_ICON_NAME } from "@/components/ui/kitchen-icon";

import { describe, it } from "vitest";

/*
 * A `node:assert` script, wrapped so vitest can REPORT it.
 *
 * It was named `*.test.ts`, which made vitest collect it — and a file with no `describe`/`it`
 * is reported as "No test suite found", i.e. a FAILED FILE. So a script whose every assertion
 * PASSED showed up as a failure, and a genuine regression showed up as exactly the same
 * failure. The signal was useless in both directions, and twenty of these had buried the two
 * real failures in this repo's baseline.
 */
describe("chef-nav-sections", () => {
  it("holds", () => {

    {
      const kitchens = chefNavSections.flatMap((section) => section.items).find((item) => item.id === "discover-kitchens");
      assert.deepEqual(kitchens?.children?.map((item) => item.id), ["kitchen-requests", "kitchen-applications", "viewings"]);
      assert.equal(kitchens?.icon, KITCHEN_ICON_NAME);
      assert.equal(findChefNavItem("kitchen-applications")?.icon, KITCHEN_ICON_NAME);
      assert.ok(getIcon(KITCHEN_ICON_NAME)?.body, "Kitchen glyph must be available offline");
      assert.equal(findChefNavItem("viewings")?.labelKey, "shellKitchenTours");
    }

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

  });
});
