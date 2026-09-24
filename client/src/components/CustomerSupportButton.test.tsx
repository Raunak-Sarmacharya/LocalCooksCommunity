import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CustomerSupportButton from "./CustomerSupportButton";

const openTidioChat = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/tidio", () => ({
  openTidioChat: () => openTidioChat(),
  subscribeTidioOpenState: () => () => {},
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      contactUs: "Contact us",
      chatWithOurTeam: "Chat with our team",
      bookACall: "Book a call",
    })[key] ?? key,
  }),
}));

afterEach(() => {
  cleanup();
  openTidioChat.mockClear();
});

describe("CustomerSupportButton", () => {
  it("opens contact choices before starting a human chat", () => {
    render(<CustomerSupportButton />);

    fireEvent.click(screen.getByRole("button", { name: "Contact us" }));
    expect(openTidioChat).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Book a call/ })).toHaveAttribute(
      "href",
      "https://cal.com/localcooks/talk-to-localcooks",
    );

    fireEvent.click(screen.getByRole("button", { name: /Chat with our team/ }));
    expect(openTidioChat).toHaveBeenCalledTimes(1);
  });
});
