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
  it("renders the live total at 2 decimals", () => {
    seed("/", 0.12345);
    renderHeader();
    expect(screen.getByRole("link", { name: "$0.12" })).toBeInTheDocument();
  });

  it("shows an em dash when there is no spend yet", () => {
    seed("/", 0);
    renderHeader();
    expect(screen.getByRole("link", { name: "—" })).toBeInTheDocument();
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
      expect(screen.getAllByRole("link", { name: "$0.02" })).toHaveLength(2);
    });
    const badges = screen.getAllByRole("link", { name: "$0.02" });
    expect(badges.length).toBeGreaterThanOrEqual(2);
    expect(badges.every((b) => b.getAttribute("href") === "/cost")).toBe(true);
  });
});
