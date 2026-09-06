import { describe, expect, it } from "vitest";
import { normalizeChatSystemMessage } from "./chat-system-message";

describe("normalizeChatSystemMessage", () => {
  it("rewrites the Step 2 Complete banner from the screenshot", () => {
    expect(
      normalizeChatSystemMessage(
        "Step 2 Complete: All kitchen coordination requirements have been met. Your application is now fully approved."
      )
    ).toBe("Kitchen coordination complete: You're approved to book this kitchen.");
  });

  it("rewrites emoji-prefixed legacy variants", () => {
    expect(
      normalizeChatSystemMessage(
        "✅ Step 2 Complete: All kitchen coordination requirements have been met. Your application is now fully approved."
      )
    ).toBe("Kitchen coordination complete: You're approved to book this kitchen.");
  });

  it("leaves modern copy alone", () => {
    const modern =
      "Kitchen coordination complete: You're approved to book this kitchen.";
    expect(normalizeChatSystemMessage(modern)).toBe(modern);
  });
});
