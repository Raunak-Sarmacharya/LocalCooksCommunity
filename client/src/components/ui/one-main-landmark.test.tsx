import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarInset } from "@/components/ui/sidebar";
import { ChefShellContext } from "@/layouts/chef-shell-context";
import KitchenJourneyLayout from "@/components/kitchen-application/KitchenJourneyLayout";

vi.mock("@/components/layout/Header", () => ({ default: () => <header /> }));

// Each page has one main landmark: the layout's own <main> around the content, nothing nested.
describe("one main landmark", () => {
  it("the sidebar inset is not a landmark, so the layout's <main> is the only one", () => {
    const { container } = render(<SidebarInset><header /><main>Page</main></SidebarInset>);
    expect(container.querySelectorAll("main")).toHaveLength(1);
  });

  it("the kitchen journey uses <main> on its own and a div inside the chef shell", () => {
    const journey = <KitchenJourneyLayout eyebrow="Apply" title="Harbour Kitchen" description="d" onBack={() => {}} aside={null}>Body</KitchenJourneyLayout>;
    expect(render(journey).container.querySelectorAll("main")).toHaveLength(1);
    const inShell = render(<ChefShellContext.Provider value={{ isChefShell: true, setChrome: () => {} }}><main>{journey}</main></ChefShellContext.Provider>);
    expect(inShell.container.querySelectorAll("main")).toHaveLength(1);
  });
});
