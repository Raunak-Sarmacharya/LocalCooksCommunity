import { describe, expect, it } from "vitest";
import { normalizeChatSystemMessage } from "./chat-system-message";

describe("normalizeChatSystemMessage", () => {
  it("hides legacy booking approval before final approval", () => {
    expect(
      normalizeChatSystemMessage(
        "Step 2 Complete: All kitchen coordination requirements have been met. Your application is now fully approved."
      )
    ).toBe("");
  });

  it("shows concise booking approval only after final approval", () => {
    expect(
      normalizeChatSystemMessage(
        "✅ Step 2 Complete: All kitchen coordination requirements have been met. Your application is now fully approved.", true
      )
    ).toBe("You're approved to book this kitchen.");
  });

  it("guards previous system copy and keeps Step 1 separate", () => {
    expect(normalizeChatSystemMessage("Chef Application Requirements complete: You're approved to book this kitchen.")).toBe("");
    expect(normalizeChatSystemMessage("Chef Application Requirements complete: You're approved to book this kitchen.", true)).toBe("You're approved to book this kitchen.");
    expect(normalizeChatSystemMessage("Request to apply approved: You can now proceed to upload your kitchen documents.")).toContain("kitchen documents can be submitted next");
    expect(normalizeChatSystemMessage("Document verified: Food Safety Certificate has been verified.")).toBe("Food Safety Certificate approved.");
  });
});
