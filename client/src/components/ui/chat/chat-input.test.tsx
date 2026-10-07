import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatInput } from "./chat-input";

describe("ChatInput attachments", () => {
  it("requires the sender to edit or send an ETA draft, retains it on failure and clears it on success", async () => {
    const send = vi.fn().mockRejectedValueOnce(Error("Retry needed")).mockResolvedValueOnce(undefined);
    render(<ChatInput onSend={send} initialDraft="My ETA is: " />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('My ETA is: ');
    expect(send).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'My ETA is 10:15' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByRole('alert');
    expect(input).toHaveValue('My ETA is 10:15');
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(input).toHaveValue(''));
    expect(send).toHaveBeenLastCalledWith('My ETA is 10:15', undefined);
  });
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
