import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
  useRouter: () => ({ push: pushMock() }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authMock(),
}));

const signOut = vi.fn();
const authMock = vi.fn<(session?: { jwt: string; email: string; userId: string } | null) => { session: { jwt: string; email: string; userId: string } | null; signOut: () => void }>(() => ({ session: null, signOut }));

const notificationsMock = vi.fn((): { notifications: Notification[]; unreadCount: number; unreadBySession: Record<string, number>; error: null; refresh: () => void; markRead: (id: string) => void } => ({ notifications: [], unreadCount: 0, unreadBySession: {}, error: null, refresh: vi.fn(), markRead: vi.fn() }));

vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => notificationsMock(),
}));

function seed(pathname: string) {
  pathnameMock.mockReturnValue(pathname);
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

describe("Header My Atlas / identity", () => {
  it("shows My Atlas linking to /login for anonymous visitors", () => {
    seed("/");
    renderHeader();
    const link = screen.getByRole("link", { name: "My Atlas" });
    expect(link.getAttribute("href")).toBe("/login");
  });

  it("shows the signed-in email with sign-out instead", async () => {
    seed("/");
    authMock.mockReturnValue({ session: { jwt: "j", email: "a@b.c", userId: "u" }, signOut });
    renderHeader();
    expect(screen.getByRole("button", { name: /a@b\.c/ }).textContent).toMatch(/sign out/);
    fireEvent.click(screen.getByRole("button", { name: /a@b\.c/ }));
    expect(signOut).toHaveBeenCalled();
  });
});

describe("Header notification bell", () => {
  it("selecting a bell navigates to the session", () => {
    seed("/");
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
