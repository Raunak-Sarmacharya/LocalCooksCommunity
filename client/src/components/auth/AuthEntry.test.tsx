import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthEntry } from "./AuthEntry";

const state = vi.hoisted(() => ({ subdomain: "kitchen" as string | null }));
vi.mock("@/hooks/use-subdomain", () => ({ useSubdomain: () => state.subdomain }));
vi.mock("@/pages/EnhancedAuthPage", () => ({ default: () => <h1>Chef sign in</h1> }));

afterEach(cleanup);

describe("AuthEntry", () => {
  it("sends the kitchen subdomain to the manager login", () => {
    state.subdomain = "kitchen";
    const navigation = memoryLocation({ path: "/auth", record: true });
    render(<Router hook={navigation.hook}><AuthEntry /></Router>);
    expect(navigation.history?.at(-1)).toBe("/manager/login");
    expect(screen.queryByText("Chef sign in")).not.toBeInTheDocument();
  });
  it("keeps the chef sign-in everywhere else", () => {
    state.subdomain = "chef";
    const navigation = memoryLocation({ path: "/auth", record: true });
    render(<Router hook={navigation.hook}><AuthEntry /></Router>);
    expect(screen.getByText("Chef sign in")).toBeInTheDocument();
  });
});
