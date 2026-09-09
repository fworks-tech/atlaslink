import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SessionThread } from "./SessionThread";
import type { Session } from "@/lib/types";

afterEach(cleanup);

function session(): Session {
  return {
    sessionId: "ses-abcdef",
    correlationId: "cor-1",
    status: "running",
    version: 1,
    task: { member: "m", prompt: "p" },
    interaction: [],
  };
}

describe("SessionThread presence", () => {
  it("shows the headcount when room members are present", () => {
    render(<SessionThread session={session()} events={[]} members={[{ name: "Alice" }, { name: "Bob" }]} />);
    expect(screen.getByText(/2 here/)).toBeDefined();
  });

  it("shows no headcount when nobody else is around", () => {
    render(<SessionThread session={session()} events={[]} members={[]} />);
    expect(screen.queryByText(/here/)).toBeNull();
  });

  it("renders turn content as markdown", () => {
    const s = session();
    s.interaction = [{ role: "atlas", content: "done — see **summary**", at: "2026-09-03T20:00:00.000Z" } as unknown as NonNullable<Session["interaction"]>[number]];
    render(<SessionThread session={s} events={[]} members={[]} />);
    expect(screen.getByText("summary").tagName).toBe("STRONG");
  });

  it("bounds the thread height so the page keeps one scrollbar", () => {
    const { container } = render(<SessionThread session={session()} events={[]} members={[]} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("min-h-[320px]");
    expect(root.className).toContain("max-h-[60vh]");
  });

  it("windows long threads and grows on request", () => {
    const s = session();
    s.interaction = Array.from({ length: 120 }, (_, i) => ({
      role: "user" as const,
      at: new Date(1700000000000 + i * 1000).toISOString(),
      content: `turn ${i}`,
    })) as NonNullable<Session["interaction"]>;
    render(<SessionThread session={s} events={[]} members={[]} />);
    expect(screen.queryByText("turn 0")).toBeNull();
    expect(screen.getByText("turn 119")).toBeDefined();
    const more = screen.getByRole("button", { name: /earlier/ });
    fireEvent.click(more);
    fireEvent.click(more);
    expect(screen.getByText("turn 0")).toBeDefined();
  });

  it("renders a run.failed event as a red error row", () => {
    render(
      <SessionThread
        session={session()}
        events={[{ eventId: 1, type: "run.failed", correlationId: "cor-1", error: "boom", at: "2026-01-01T00:00:00Z" }]}
        members={[]}
      />,
    );
    const row = screen.getByRole("alert");
    expect(row.textContent).toContain("boom");
    expect(row.className).toContain("text-danger");
  });

  it("renders the failed-session terminal error even without a run.failed event", () => {
    const s = session();
    s.status = "failed";
    s.error = "kaput";
    render(<SessionThread session={s} events={[]} members={[]} />);
    expect(screen.getByRole("alert").textContent).toContain("kaput");
  });

  it("shows no error row for healthy sessions", () => {
    render(<SessionThread session={session()} events={[]} members={[]} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
