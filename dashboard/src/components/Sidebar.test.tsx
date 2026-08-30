import { describe, it, expect } from "vitest";
import { groupByDate } from "./Sidebar";
import type { Session } from "@/lib/types";

function session(over: Partial<Session> = {}): Session {
  return {
    sessionId: "ses-a",
    correlationId: "cor-a",
    status: "queued",
    version: 1,
    task: { member: "the-mediator", prompt: "fix x" },
    ...over,
  };
}

describe("groupByDate", () => {
  it("groups today vs yesterday vs older using calendar dates", () => {
    const now = new Date();
    const today = now.toISOString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yStr = yesterday.toISOString();
    const older = new Date(now);
    older.setDate(now.getDate() - 5);
    const oStr = older.toISOString();

    const sToday = session({ sessionId: "a", createdAt: today });
    const sYesterday = session({ sessionId: "b", createdAt: yStr });
    const sOlder = session({ sessionId: "c", createdAt: oStr });

    const groups = groupByDate([sToday, sYesterday, sOlder]);
    expect(groups.get("Today")?.map((s) => s.sessionId)).toEqual(["a"]);
    expect(groups.get("Yesterday")?.map((s) => s.sessionId)).toEqual(["b"]);
    expect(groups.get("Older")?.map((s) => s.sessionId)).toEqual(["c"]);
  });

  it("handles missing createdAt as Older", () => {
    const s = session({ sessionId: "x" });
    delete (s as unknown as Record<string, unknown>)["createdAt"] as unknown as void;
    const groups = groupByDate([s]);
    expect(groups.get("Older")?.length).toBe(1);
  });
});
