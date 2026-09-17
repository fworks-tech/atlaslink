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
    expect(screen.getByText(/Atlas holds the sky/i)).toBeDefined();
    const open = screen.getByRole("link", { name: "Open Atlas — live demo" });
    expect(open.getAttribute("href")).toBe("/atlas");
    expect(screen.getByRole("link", { name: "My Atlas — sign in" }).getAttribute("href")).toBe("/login");
  });

  it("renders stats, preview band, members grid and how-it-works", () => {
    render(<LandingPage />);
    expect(screen.getByText(/specialized members/i)).toBeInTheDocument();
    expect(screen.getByText(/Watch the Society work/i)).toBeInTheDocument();
    expect(screen.getByText(/Meet the team/i)).toBeInTheDocument();
    expect(screen.getByText(/How it works/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open Atlas" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Your task deserves a full team/i)).toBeInTheDocument();
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
