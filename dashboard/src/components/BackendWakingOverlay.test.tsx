import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { BackendWakingOverlay } from "./BackendWakingOverlay";

const mockHealth = vi.fn();

vi.mock("@/hooks/useBackendHealth", () => ({
  useBackendHealth: () => mockHealth(),
}));

describe("BackendWakingOverlay", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders nothing when healthy", () => {
    mockHealth.mockReturnValue({ health: "healthy", attempt: 0, retry: vi.fn() });
    const { container } = render(<BackendWakingOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing immediately when unknown (avoids flash)", () => {
    mockHealth.mockReturnValue({ health: "unknown", attempt: 0, retry: vi.fn() });
    const { container } = render(<BackendWakingOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it("renders after 800ms when still unknown", async () => {
    mockHealth.mockReturnValue({ health: "unknown", attempt: 0, retry: vi.fn() });
    render(<BackendWakingOverlay />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => vi.advanceTimersByTime(800));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Server is starting/)).toBeInTheDocument();
  });

  it("renders waking overlay with Render copy and attempt", () => {
    mockHealth.mockReturnValue({ health: "waking", attempt: 2, retry: vi.fn() });
    render(<BackendWakingOverlay />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Waking Render server/)).toBeInTheDocument();
    expect(screen.getByText(/attempt 2/)).toBeInTheDocument();
  });

  it("renders down overlay with retry button", async () => {
    const retry = vi.fn();
    mockHealth.mockReturnValue({ health: "down", attempt: 3, retry });
    render(<BackendWakingOverlay />);
    expect(screen.getByText(/Retrying connection to Render/)).toBeInTheDocument();
    screen.getByRole("button", { name: /retry now/i }).click();
    expect(retry).toHaveBeenCalledOnce();
  });

  it("does not show attempt when 0", () => {
    mockHealth.mockReturnValue({ health: "waking", attempt: 0, retry: vi.fn() });
    render(<BackendWakingOverlay />);
    expect(screen.queryByText(/attempt/)).toBeNull();
  });
});
