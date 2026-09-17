import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const authMock = vi.fn<(session?: { jwt: string; email: string; userId: string } | null) => { session: { jwt: string; email: string; userId: string } | null; signOut: () => void }>(() => ({ session: null, signOut: () => {} }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authMock() }));

import LandingPage from "./page";
import DemoBanner from "@/components/DemoBanner";

afterEach(() => {
  cleanup();
  authMock.mockReturnValue({ session: null, signOut: () => {} });
});

describe("landing page", () => {
  it("renders the hero with both CTAs", () => {
    render(<LandingPage />);
    expect(screen.getByText("Ask Atlas.")).toBeDefined();
    expect(screen.getByText("Together, live.")).toBeDefined();
    const open = screen.getByRole("link", { name: "Open Atlas — live demo" });
    expect(open.getAttribute("href")).toBe("/atlas");
    expect(screen.getByRole("link", { name: "My Atlas — sign in" }).getAttribute("href")).toBe("/login");
  });

  it("renders the room band, evidence band and final CTA — and none of the copied agenthood sections", () => {
    render(<LandingPage />);
    expect(screen.getByText(/The room, not the queue/i)).toBeInTheDocument();
    expect(screen.getByText(/Every step, on the record/i)).toBeInTheDocument();
    expect(screen.getByText(/Hand it to the room/i)).toBeInTheDocument();
    expect(screen.queryByText(/specialized members/i)).toBeNull();
    expect(screen.queryByText(/Meet the team/i)).toBeNull();
    expect(screen.queryByText(/How it works/i)).toBeNull();
  });
});

describe("DemoBanner", () => {
  it("shows for anonymous visitors with a login link", () => {
    render(<DemoBanner />);
    expect(screen.getByText(/demo/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in to keep your sessions/i }).getAttribute("href")).toBe("/login");
  });

  it("hides for authenticated visitors", () => {
    authMock.mockReturnValue({ session: { jwt: "j", email: "a@b.c", userId: "u" }, signOut: () => {} });
    render(<DemoBanner />);
    expect(screen.queryByText(/demo/i)).toBeNull();
  });
});

describe("LandingCanvas choreography", () => {
  it("builds the session step by step and keeps the room alive", async () => {
    vi.useFakeTimers();
    const LandingCanvas = (await import("@/components/LandingCanvas")).default;
    render(<LandingCanvas />);
    expect(screen.getByTestId("landing-canvas")).toBeDefined();
    expect(screen.getByText(/Review my PR for security holes/i)).toBeInTheDocument();
    // atlas delegates next
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText("ATLAS")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(5800); });
    expect(screen.getByText(/Apply the suggested fix\?/i)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(4200); });
    expect(screen.getByText(/session\.succeeded/i)).toBeInTheDocument();
    // the loop restarts — the human bubble returns after the cycle
    act(() => { vi.advanceTimersByTime(7600); });
    expect(screen.getByText(/Review my PR for security holes/i)).toBeInTheDocument();
    expect(screen.getByText(/is typing/i)).toBeInTheDocument();
    vi.useRealTimers();
  });
});


describe("AskTerminal", () => {
  it("types the command and reveals the session outcome lines, looping", async () => {
    vi.useFakeTimers();
    const AskTerminal = (await import("@/components/AskTerminal")).default;
    render(<AskTerminal />);
    expect(screen.getByTestId("ask-terminal")).toBeInTheDocument();
    // typing completes for the first example (~54 chars * 26ms)
    act(() => { vi.advanceTimersByTime(1600); });
    expect(screen.getByText(/fix issue #42/i)).toBeInTheDocument();
    // outcome lines reveal
    act(() => { vi.advanceTimersByTime(1200); });
    expect(screen.getByText(/session\.succeeded/i)).toBeInTheDocument();
    // next example cycles in and types its command
    act(() => { vi.advanceTimersByTime(4200); });
    expect(screen.getByText(/review my PR for security holes/i)).toBeInTheDocument();
    vi.useRealTimers();
  });
});
