import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationList } from "./ConversationList";
import type { Conversation } from "@/services/chat-service";

vi.stubGlobal("ResizeObserver", class {
  observe() {}
  disconnect() {}
});

const conversation = (id: string, extra: Partial<Conversation> = {}): Conversation => ({
  id,
  applicationId: Number(id),
  chefId: 1,
  managerId: 2,
  locationId: 3,
  createdAt: new Date(),
  lastMessageAt: new Date(),
  unreadChefCount: 0,
  unreadManagerCount: 0,
  ...extra,
});

describe("ConversationList archive", () => {
  it("groups manually archived and inactive chats for a manager, with a muted inactive chip", () => {
    const onToggleArchive = vi.fn();
    render(<ConversationList
      viewerRole="manager"
      conversations={[conversation("1"), conversation("2", { archivedManagerAt: new Date() }), conversation("3", { unavailable: true })]}
      onSelect={vi.fn()}
      onToggleArchive={onToggleArchive}
      getPartnerName={(chat) => `Chef ${chat.id}`}
      getPartnerLocation={() => "Test Kitchen"}
    />);

    expect(screen.getByText("Archived (2)")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Archived (2)"));
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore chat" }));
    expect(onToggleArchive).toHaveBeenCalledWith(expect.objectContaining({ id: "2" }), false);
    fireEvent.click(screen.getByRole("button", { name: "Archive chat" }));
    expect(onToggleArchive).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), true);
  });

  it("keeps a chef's archive separate from the manager's", () => {
    render(<ConversationList
      viewerRole="chef"
      conversations={[conversation("1", { archivedManagerAt: new Date() }), conversation("2", { archivedChefAt: new Date() })]}
      onSelect={vi.fn()}
      getPartnerName={(chat) => `Manager ${chat.id}`}
      getPartnerLocation={() => "Test Kitchen"}
    />);
    expect(screen.getByText("Archived (1)")).toBeInTheDocument();
    expect(screen.getByText("Manager 1")).toBeInTheDocument();
  });
});
