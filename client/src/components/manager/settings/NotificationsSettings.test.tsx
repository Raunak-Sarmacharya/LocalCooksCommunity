import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NotificationsSettings from "./NotificationsSettings";

vi.mock("@/i18n/manager", () => ({
  mt: (key: string) => ({
    emailAddress: "Email Address",
    saveNotificationSettings: "Save Notification Settings",
  })[key as "emailAddress" | "saveNotificationSettings"] || key,
}));

afterEach(cleanup);

describe("NotificationsSettings", () => {
  it("clears the notification email without exposing or submitting an SMS phone", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <NotificationsSettings
        location={{ id: 7, name: "Harbour Kitchen", notificationEmail: "old@example.com" }}
        onSave={onSave}
      />,
    );

    expect(screen.queryByRole("textbox", { name: /phone|sms/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Email Address"), {
      target: { value: "" },
    });
    // The real label, with its spaces. This used to be queried as "SaveNotificationSettings" —
    // StatusButton renders its label one character per span, so the accessible name came out
    // de-spaced and this test was quietly asserting that bug. StatusButton now sets an aria-label
    // from the real string, so the name is what a screen reader would actually read out.
    fireEvent.click(screen.getByRole("button", { name: "Save Notification Settings" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        locationId: 7,
        notificationEmail: "",
      });
    });
  });
});
