import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionList, VIRTUALIZE_AT } from "./SessionList";

const sessionsMock = vi.fn();
const eventsMock = vi.fn();
const throttledMock = vi.fn((v) => v);

vi.mock("@/hooks/useSessions", () => ({
  useSessions: () => sessionsMock(),
}));
vi.mock("@/hooks/useEvents", () => ({
  useEvents: () => eventsMock(),
}));
vi.mock("@/hooks/useThrottledValue", () => ({
  useThrottledValue: (v: unknown) => throttledMock(v),
}));

function session(id: string, n: number) {
  return {
    sessionId: id,
    correlationId: `cor-${n}`,
    status: "queued" as const,
    version: 1,
    createdAt: `2026-08-28T12:${String(n).padStart(2, "0")}:00.000Z`,
    task: { member: "the-mediator", prompt: `prompt ${n}` },
  };
}

describe("SessionList", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders empty state", () => {
    sessionsMock.mockReturnValue({ sessions: [], loading: false, error: null, refresh: vi.fn() });
    eventsMock.mockReturnValue({ events: [] });
    render(<SessionList />);
    expect(screen.getByText(/No sessions yet/)).toBeInTheDocument();
  });

  it("renders non-virtualized rows for small lists", () => {
    sessionsMock.mockReturnValue({ sessions: [session("ses-1", 1), session("ses-2", 2)], loading: false, error: null, refresh: vi.fn() });
    eventsMock.mockReturnValue({ events: [] });
    render(<SessionList />);
    expect(screen.getByText("prompt 1")).toBeInTheDocument();
    expect(screen.getByText("prompt 2")).toBeInTheDocument();
    // no virtualization spacers
    expect(document.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });

  it("selects rows through a real button with valid table semantics", () => {
    sessionsMock.mockReturnValue({ sessions: [session("ses-1", 1)], loading: false, error: null, refresh: vi.fn() });
    eventsMock.mockReturnValue({ events: [] });
    const onSelect = vi.fn();
    const { container } = render(<SessionList onSelect={onSelect} />);
    expect(container.querySelector('[role="button"]')).toBeNull();
    screen.getByRole("button", { name: "prompt 1" }).click();
    expect(onSelect).toHaveBeenCalledWith("ses-1");
  });

  it("virtualizes large lists with spacers", () => {
    const many = Array.from({ length: VIRTUALIZE_AT + 20 }, (_, i) => session(`ses-${i}`, i));
    sessionsMock.mockReturnValue({ sessions: many, loading: false, error: null, refresh: vi.fn() });
    eventsMock.mockReturnValue({ events: [] });
    const { container } = render(<SessionList />);
    // virtualized container is a region labeled Sessions
    expect(screen.getByRole("region", { name: "Sessions" })).toBeInTheDocument();
    // bottom pad spacer should exist (topPad 0, bottomPad >0)
    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(hidden.length).toBeGreaterThanOrEqual(1);
    // at least one slice row is rendered
    expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("tbody tr").length).toBeLessThan(many.length);
  });

  it("throttles events via useThrottledValue", () => {
    const ev = [{ eventId: 1, type: "session.created", sessionId: "ses-1" }];
    sessionsMock.mockReturnValue({ sessions: [session("ses-1", 1)], loading: false, error: null, refresh: vi.fn() });
    eventsMock.mockReturnValue({ events: ev });
    render(<SessionList />);
    expect(throttledMock).toHaveBeenCalledWith(ev);
  });
});
