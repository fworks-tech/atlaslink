import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Sidebar, groupByDate } from "./Sidebar";
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

const sessionsMock = vi.fn();

vi.mock("@/hooks/useSessions", () => ({
  useSessions: () => sessionsMock(),
}));

vi.mock("@/hooks/useEvents", () => ({
  useEvents: () => ({ events: [] }),
}));

describe("Sidebar navigation", () => {
  const project = { id: "p-1", name: "Atlas", createdAt: new Date().toISOString() };

  beforeEach(() => {
    sessionsMock.mockReturnValue({
      sessions: [session({ sessionId: "ses-1", projectId: "p-1", createdAt: new Date().toISOString() })],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderSidebar(over: Record<string, unknown> = {}) {
    const onSelectSession = vi.fn();
    const onCreateProject = vi.fn(async () => null);
    render(
      <Sidebar
        projects={[project]}
        projectsLoading={false}
        projectsError={null}
        onCreateProject={onCreateProject}
        selectedSessionId="ses-1"
        onSelectSession={onSelectSession}
        {...over}
      />,
    );
    return { onSelectSession, onCreateProject };
  }

  it("expands a project to reveal its sessions and selects through", () => {
    const { onSelectSession } = renderSidebar();
    expect(screen.queryByText("fix x")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Atlas/ }));
    fireEvent.click(screen.getByRole("button", { name: /fix x/ }));
    expect(onSelectSession).toHaveBeenCalledWith("ses-1");
  });

  it("creates a project from the header form", () => {
    const { onCreateProject } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    fireEvent.change(screen.getByPlaceholderText("Project name"), { target: { value: "Next" } });
    fireEvent.submit(screen.getByPlaceholderText("Project name").closest("form")!);
    expect(onCreateProject).toHaveBeenCalledWith("Next");
  });

  it("rejects blank names and overlong names without calling through", () => {
    const { onCreateProject } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    const input = screen.getByPlaceholderText("Project name");
    fireEvent.submit(input.closest("form")!);
    fireEvent.change(input, { target: { value: "x".repeat(201) } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText("Project name must be ≤200 characters")).toBeDefined();
    expect(onCreateProject).not.toHaveBeenCalled();
  });
});
