import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import Header from "./Header";

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
const costMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authMock(),
}));

const signOut = vi.fn();
const authMock = vi.fn<(session?: { jwt: string; email: string; userId: string } | null) => { session: { jwt: string; email: string; userId: string } | null; signOut: () => void }>(() => ({ session: null, signOut }));

vi.mock("@/hooks/useCost", () => ({
  useCost: (opts?: { poll?: boolean }) => costMock(opts),
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
    fireEvent.click(screen.getByRole("button", { name: /toggle menu/i }));
    // the Drawer portal mounts its content on the next frame — wait for it
    await waitFor(() => {
      // desktop pill + drawer link — jsdom applies no media queries, so both render
      const costLinks = screen.getAllByRole("link").filter((l) => l.getAttribute("href") === "/cost");
      expect(costLinks.length).toBeGreaterThanOrEqual(2);
    });
    const costLinks = screen.getAllByRole("link").filter((l) => l.getAttribute("href") === "/cost");
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
