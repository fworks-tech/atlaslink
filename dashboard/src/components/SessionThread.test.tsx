import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
});
