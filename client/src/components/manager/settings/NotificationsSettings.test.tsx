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
    fireEvent.click(screen.getByRole("button", { name: "SaveNotificationSettings" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        locationId: 7,
        notificationEmail: "",
      });
    });
  });
});
