import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatInput } from "./chat-input";

describe("ChatInput attachments", () => {
  it("keeps a failed upload selected so the sender can retry", async () => {
    const send = vi.fn().mockRejectedValue(new Error("Upload failed"));
    const { container } = render(<ChatInput onSend={send} />);
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["test"], "test.pdf", { type: "application/pdf" });

    fireEvent.change(picker, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Upload failed"));
    expect(screen.getByText("test.pdf")).toBeInTheDocument();
    expect(send).toHaveBeenCalledWith("", [file]);
  });
});
