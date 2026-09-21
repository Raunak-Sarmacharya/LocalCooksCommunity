import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsRow } from "./SettingsRow";

afterEach(cleanup);

const WARNING = "Chefs can book up to 2 hours hourly for $100.00";
const INFO = "Equals 1.6 hours at your hourly rate.";
const HELP_COPY = "The price for the whole day.";

describe("SettingsRow advisory", () => {
  it("is on screen with no interaction at all", () => {
    render(
      <SettingsRow
        id="daily-rate"
        label="Daily Rate"
        hint="Amount charged per day"
        advisory={{ tone: "warning", text: WARNING }}
      >
        <input id="daily-rate" />
      </SettingsRow>,
    );

    // The whole point: no click, no hover, no focus. A tooltip would fail here.
    expect(screen.getByText(WARNING)).toBeInTheDocument();
  });

  it("is not the ⓘ copy — help stays hidden until the popover opens", () => {
    render(
      <SettingsRow
        id="daily-rate"
        label="Daily Rate"
        help={HELP_COPY}
        advisory={{ tone: "info", text: INFO }}
      >
        <input id="daily-rate" />
      </SettingsRow>,
    );

    expect(screen.getByText(INFO)).toBeInTheDocument();
    // The field explanation must still be behind the ⓘ — if this ever starts
    // passing, the two have been merged back into one message.
    expect(screen.queryByText(HELP_COPY)).not.toBeInTheDocument();
  });

  it("renders nothing extra when there is no advisory", () => {
    render(
      <SettingsRow id="daily-rate" label="Daily Rate" hint="Amount charged per day">
        <input id="daily-rate" />
      </SettingsRow>,
    );

    expect(screen.getByText("Amount charged per day")).toBeInTheDocument();
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
    expect(screen.queryByText(INFO)).not.toBeInTheDocument();
  });

  it("tints both tones and keeps them distinct from the hint", () => {
    const { unmount } = render(
      <SettingsRow id="r" label="Daily Rate" advisory={{ tone: "warning", text: WARNING }}>
        <input id="r" />
      </SettingsRow>,
    );
    const warning = screen.getByText(WARNING).closest("p")!;
    const warningClass = warning.className;
    // The warning carries the icon; the info line must not, or the two read as
    // the same message repeated.
    expect(warning.querySelectorAll("svg").length).toBe(1);
    unmount();

    render(
      <SettingsRow id="r" label="Daily Rate" advisory={{ tone: "info", text: INFO }}>
        <input id="r" />
      </SettingsRow>,
    );
    const info = screen.getByText(INFO).closest("p")!;

    // The regression this guards: an advisory in the same grey as the hint above
    // it reads as more subtext and gets skipped.
    expect(info.className).not.toContain("text-muted-foreground");
    expect(warningClass).not.toContain("text-muted-foreground");

    // One message family, not two hues: both tones stay amber, and severity is
    // carried by the shade plus the icon.
    expect(info.className).toContain("amber");
    expect(warningClass).toContain("amber");
    expect(info.className).not.toBe(warningClass);
    expect(info.querySelectorAll("svg").length).toBe(0);

    // A light-mode-only shade goes muddy on a dark surface.
    expect(info.className).toContain("dark:");
    expect(warningClass).toContain("dark:");
  });
});
