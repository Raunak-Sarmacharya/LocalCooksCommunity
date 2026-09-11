import { describe, expect, it } from "vitest";
import { acceptingRequestsIcon, bookNowIcon, kitchenActionKindIcon } from "./status-icons";

describe("kitchen status icons", () => {
  it("keeps Accepting Requests and Book Now on different icons", () => {
    expect(kitchenActionKindIcon("book")).toBe(bookNowIcon);
    expect(acceptingRequestsIcon).not.toBe(bookNowIcon);
    expect(kitchenActionKindIcon("book")).not.toBe(acceptingRequestsIcon);
  });

  it("maps each action kind to a distinct icon", () => {
    const icons = (["book", "wait", "complete-step", "discover"] as const).map(
      kitchenActionKindIcon
    );
    expect(new Set(icons).size).toBe(icons.length);
  });
});
