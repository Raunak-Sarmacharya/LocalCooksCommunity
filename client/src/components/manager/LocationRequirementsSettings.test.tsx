import { cleanup, render } from "@testing-library/react";
import { createRef, forwardRef, useImperativeHandle } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import LocationRequirementsSettings from "./LocationRequirementsSettings";
import type { ApplicationRequirementsWizardHandle } from "./requirements";

/**
 * A stand-in for the real wizard that records the props it receives and exposes
 * an imperative handle. We are testing the WRAPPER, not the wizard — the wrapper
 * is the new code, and the whole point is that it forwards both halves of the
 * guard contract (a dirty signal it can read, and a ref it can call to save).
 */
const received: {
  onDirtyChange?: (dirty: boolean) => void;
  locationId?: number;
  ref?: React.Ref<ApplicationRequirementsWizardHandle>;
} = {};

vi.mock("./requirements", () => ({
  ApplicationRequirementsWizard: forwardRef<
    ApplicationRequirementsWizardHandle,
    {
      locationId: number;
      onDirtyChange?: (dirty: boolean) => void;
      onSaveSuccess?: () => void;
    }
  >(function FakeWizard({ locationId, onDirtyChange }, ref) {
    received.locationId = locationId;
    received.onDirtyChange = onDirtyChange;
    received.ref = ref;
    useImperativeHandle(ref, () => ({
      save: async () => {},
      hasUnsavedChanges: false,
    }));
    return <div data-testid="fake-wizard" />;
  }),
}));

afterEach(() => {
  cleanup();
  received.onDirtyChange = undefined;
  received.locationId = undefined;
  received.ref = undefined;
});

describe("LocationRequirementsSettings (guard plumbing)", () => {
  it("forwards onDirtyChange to the wizard", () => {
    const onDirtyChange = vi.fn();
    render(<LocationRequirementsSettings locationId={42} onDirtyChange={onDirtyChange} />);

    expect(received.onDirtyChange).toBe(onDirtyChange);
  });

  it("forwards the imperative ref to the wizard", () => {
    const ref = createRef<ApplicationRequirementsWizardHandle>();
    render(<LocationRequirementsSettings ref={ref} locationId={42} />);

    // The ref must resolve to the wizard's handle — a wrapper that swallowed it
    // would leave the parent unable to save-before-leave.
    expect(ref.current).not.toBeNull();
    expect(typeof ref.current?.save).toBe("function");
  });

  it("passes the locationId through", () => {
    render(<LocationRequirementsSettings locationId={7} />);

    expect(received.locationId).toBe(7);
  });

  it("surfaces a dirty=true report from the wizard up to the parent", () => {
    const onDirtyChange = vi.fn();
    render(<LocationRequirementsSettings locationId={42} onDirtyChange={onDirtyChange} />);

    act(() => {
      received.onDirtyChange?.(true);
    });

    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });
});
