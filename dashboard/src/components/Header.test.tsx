import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import Header from "./Header";
import type { Notification } from "@/lib/types";

// jsdom has no matchMedia — stub for MantineProvider color-scheme detection
if (typeof window.matchMedia === "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const pathnameMock = vi.fn();
const pushFn = vi.fn();
const pushMock = vi.fn(() => pushFn);
const costMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
  useRouter: () => ({ push: pushMock() }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authMock(),
}));

const signOut = vi.fn();
const authMock = vi.fn<(session?: { jwt: string; email: string; userId: string } | null) => { session: { jwt: string; email: string; userId: string } | null; signOut: () => void }>(() => ({ session: null, signOut }));

vi.mock("@/hooks/useCost", () => ({
  useCost: (opts?: { poll?: boolean }) => costMock(opts),
}));

const notificationsMock = vi.fn((): { notifications: Notification[]; unreadCount: number; unreadBySession: Record<string, number>; error: null; refresh: () => void; markRead: (id: string) => void } => ({ notifications: [], unreadCount: 0, unreadBySession: {}, error: null, refresh: vi.fn(), markRead: vi.fn() }));

vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => notificationsMock(),
}));

function seed(pathname: string, stepCost: number) {
  pathnameMock.mockReturnValue(pathname);
  costMock.mockReturnValue({
    breakdown: [],
    total: { promptTokens: 0, completionTokens: 0, stepCost },
    loading: false,
    error: null,
    refresh: vi.fn(),
  });
}

function renderHeader() {
  return render(
    <MantineProvider>
      <Header />
    </MantineProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Header cost badge", () => {
  it("renders the live total as a labeled pill at 2 decimals", () => {
    seed("/", 0.12345);
    renderHeader();
    const link = screen.getByRole("link", { name: /cost/ });
    expect(link.textContent).toContain("$0.12");
  });

  it("hides the cost link when there is no spend yet", () => {
    seed("/", 0);
    renderHeader();
    expect(screen.queryByRole("link", { name: /cost/ })).toBeNull();
  });

  it("polls off /cost and skips its interval on /cost", () => {
    seed("/", 0.01);
    const first = renderHeader();
    expect(costMock).toHaveBeenCalledWith({ poll: true });
    first.unmount();
    cleanup();
    costMock.mockClear();
    seed("/cost", 0.01);
    renderHeader();
    expect(costMock).toHaveBeenCalledWith({ poll: false });
    expect(costMock).not.toHaveBeenCalledWith({ poll: true });
  });

  it("exposes /cost inside the mobile drawer", async () => {
    seed("/", 0.02);
    renderHeader();
    // jsdom ≥31 evaluates Mantine's hiddenFrom media query, so the Burger is
    // display:none at the default 1024px viewport and its accessible name
    // computes empty — match the aria-label attribute directly
    fireEvent.click(screen.getByLabelText(/toggle menu/i));
    // the Drawer portal mounts its content on the next frame — wait for it
    await waitFor(() => {
      // desktop pill + drawer link — jsdom ≥31 applies Mantine's
      // hiddenFrom/hidden media queries at its 1024px viewport, so the
      // mobile-only nodes query as hidden
      const costLinks = screen.getAllByRole("link", { hidden: true }).filter((l) => l.getAttribute("href") === "/cost");
      expect(costLinks.length).toBeGreaterThanOrEqual(2);
    });
    const costLinks = screen.getAllByRole("link", { hidden: true }).filter((l) => l.getAttribute("href") === "/cost");
    expect(costLinks.every((l) => l.textContent?.includes("$0.02"))).toBe(true);
  });
});

describe("Header My Atlas / identity", () => {
  it("shows My Atlas linking to /login for anonymous visitors", () => {
    seed("/", 0);
    renderHeader();
    const link = screen.getByRole("link", { name: "My Atlas" });
    expect(link.getAttribute("href")).toBe("/login");
  });

  it("shows the signed-in email with sign-out instead", async () => {
    seed("/", 0);
    authMock.mockReturnValue({ session: { jwt: "j", email: "a@b.c", userId: "u" }, signOut });
    renderHeader();
    expect(screen.getByRole("button", { name: /a@b\.c/ }).textContent).toMatch(/sign out/);
    fireEvent.click(screen.getByRole("button", { name: /a@b\.c/ }));
    expect(signOut).toHaveBeenCalled();
  });
});

describe("Header notification bell", () => {
  it("selecting a bell navigates to the session", () => {
    seed("/", 0);
    authMock.mockReturnValue({ session: { jwt: "j", email: "a@b.c", userId: "u" }, signOut });
    notificationsMock.mockReturnValue({
      notifications: [{ id: "n-1", userId: "u", sessionId: "ses-1", kind: "mention", excerpt: "hey you", readAt: null, createdAt: "2026-11-14T10:00:00Z" }],
      unreadCount: 1,
      unreadBySession: { "ses-1": 1 },
      error: null,
      refresh: vi.fn(),
      markRead: vi.fn(),
    });
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: /notifications, 1 unread/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /hey you/ }));
    expect(pushFn).toHaveBeenCalledWith("/?session=ses-1");
  });
});
