import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

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
    const open = screen.getByText("Open Atlas · live demo");
    expect(open.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByRole("link", { name: "Open Atlas · live demo" })).toBeNull();
    expect(screen.getByRole("link", { name: "My Atlas · sign in" }).getAttribute("href")).toBe("/login");
  });

  it("renders the room band, evidence band and final CTA — and none of the copied agenthood sections", () => {
    render(<LandingPage />);
    expect(screen.getByText(/The room, not the queue/i)).toBeInTheDocument();
    expect(screen.getByText(/Session activity, recorded for review/i)).toBeInTheDocument();
    expect(screen.getByText(/Hand it to the room/i)).toBeInTheDocument();
    expect(screen.getByText(/Live Shared Room/i)).toBeInTheDocument();
    expect(screen.getByText(/Session History/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get Started" }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "Request a Demo" }).getAttribute("href")).toBe("/atlas");
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

describe("hero video", () => {
  it("autoplays the hand-it-to-the-room demo muted and on loop", () => {
    render(<LandingPage />);
    const video = screen.getByTestId("hero-video") as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe("/hand-it-to-the-room.mp4");
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.playsInline).toBe(true);
  });
});


describe("SharedRoomCard", () => {
  it("storyboards a PR review: agents flank the chat, approval gates the history", async () => {
    const SharedRoomCard = (await import("@/components/SharedRoomCard")).default;
    render(<SharedRoomCard />);
    expect(screen.getByLabelText(/resolving a PR security review/i)).toBeInTheDocument();
    expect(screen.getByText("Agent: triage")).toBeInTheDocument();
    expect(screen.getByText("Agent: implementer")).toBeInTheDocument();
    expect(screen.getByText(/Vulnerability no longer detected/i)).toBeInTheDocument();
    expect(screen.getByText("approval")).toBeInTheDocument();
    expect(screen.getByText("Vulnerability resolved")).toBeInTheDocument();
  });
});
