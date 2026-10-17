import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimeSelect, timeOptions } from "./time-select";

describe("timeOptions", () => {
  it("steps across the whole day and stops at the last slot before midnight", () => {
    const options = timeOptions(30);
    expect(options).toHaveLength(48);
    expect(options[0]).toBe("00:00");
    expect(options.at(-1)).toBe("23:30");
  });

  it("respects inclusive min and max bounds", () => {
    expect(timeOptions(60, "09:00", "12:00")).toEqual(["09:00", "10:00", "11:00", "12:00"]);
    // An off-grid bound is still a bound, not a generated option.
    expect(timeOptions(30, "09:10", "10:20")).toEqual(["09:30", "10:00"]);
  });

  it("keeps a stored value that is not on the step grid", () => {
    expect(timeOptions(30, undefined, undefined, "09:07")).toContain("09:07");
  });

  it("does not duplicate a value that is already on the grid", () => {
    expect(timeOptions(30, undefined, undefined, "09:30").filter(option => option === "09:30")).toHaveLength(1);
  });
});

describe("TimeSelect", () => {
  it("labels options with the app's time formatter and reports the chosen HH:mm", () => {
    const onChange = vi.fn();
    render(<TimeSelect aria-label="Open time" value="09:00" onChange={onChange} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Open time" }));
    fireEvent.click(screen.getByRole("option", { name: "9:30 a.m." }));

    expect(onChange).toHaveBeenCalledWith("09:30");
  });

  it("shows the placeholder while unset", () => {
    render(<TimeSelect aria-label="Open time" value="" onChange={() => {}} placeholder="Choose a time" />);
    expect(screen.getByRole("combobox", { name: "Open time" })).toHaveTextContent("Choose a time");
  });
});
