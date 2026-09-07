import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AnimatedInput from "./AnimatedInput";

afterEach(cleanup);

describe("AnimatedInput", () => {
  it("shows an asterisk and marks required registration fields as required", () => {
    render(<AnimatedInput label="Full Name" name="displayName" required />);

    expect(screen.getByLabelText(/Full Name/)).toBeRequired();
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("does not show an asterisk for optional fields", () => {
    render(<AnimatedInput label="Business Description" name="businessDescription" />);

    expect(screen.getByLabelText("Business Description")).not.toBeRequired();
    expect(screen.queryByText("*")).not.toBeInTheDocument();
  });
});
