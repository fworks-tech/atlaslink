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
});
