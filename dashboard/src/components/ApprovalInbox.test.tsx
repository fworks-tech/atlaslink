import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ApprovalInbox } from "./ApprovalInbox";
import type { Session } from "@/lib/types";

const getTasksMock = vi.fn();
vi.mock("@/lib/api", () => ({
  getTasks: (...args: unknown[]) => getTasksMock(...args),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function waiting(id: string, createdAt: string, over?: Partial<Session>): Session {
  return {
    sessionId: id,
    correlationId: `cor-${id}`,
    status: "awaiting_input",
    version: 1,
    createdAt,
    task: { member: "the-builder", prompt: `prompt ${id}` },
    ...over,
  };
}

describe("ApprovalInbox", () => {
  it("renders nothing when nobody is waiting", async () => {
    getTasksMock.mockResolvedValue({ ok: true, sessions: [], total: 0 });
    const { container } = render(<ApprovalInbox onSelect={() => {}} />);
    await vi.waitFor(() => expect(getTasksMock).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("queries only awaiting sessions and lists longest-waiting first", async () => {
    getTasksMock.mockResolvedValue({
      ok: true,
      total: 2,
      sessions: [waiting("new", "2026-09-07T12:00:00.000Z"), waiting("old", "2026-09-07T10:00:00.000Z")],
    });
    render(<ApprovalInbox onSelect={() => {}} />);
    await vi.waitFor(() => expect(getTasksMock).toHaveBeenCalledWith(50, 0, undefined, "awaiting_input"));
    const rows = await screen.findAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("prompt old"),
      expect.stringContaining("prompt new"),
    ]);
  });

  it("prefers the unified question over the raw task prompt", async () => {
    getTasksMock.mockResolvedValue({
      ok: true,
      total: 1,
      sessions: [waiting("s1", "2026-09-07T10:00:00.000Z", { question: { question: "which env?" } })],
    });
    render(<ApprovalInbox onSelect={() => {}} />);
    expect(await screen.findByText("which env?")).toBeDefined();
  });

  it("selecting a row hands the session id to the caller", async () => {
    getTasksMock.mockResolvedValue({ ok: true, total: 1, sessions: [waiting("s9", "2026-09-07T10:00:00.000Z")] });
    const onSelect = vi.fn();
    render(<ApprovalInbox onSelect={onSelect} />);
    fireEvent.click(await screen.findByRole("button"));
    expect(onSelect).toHaveBeenCalledWith("s9");
  });

  it("caps rows and shows the overflow count", async () => {
    const many = Array.from({ length: 5 }, (_, i) => waiting(`s${i}`, `2026-09-07T1${i}:00:00.000Z`));
    getTasksMock.mockResolvedValue({ ok: true, total: 5, sessions: many });
    render(<ApprovalInbox onSelect={() => {}} />);
    await vi.waitFor(() => expect(screen.getAllByRole("button")).toHaveLength(3));
    expect(screen.getByText("+2 more")).toBeDefined();
  });
});
