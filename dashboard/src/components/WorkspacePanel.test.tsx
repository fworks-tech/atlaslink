import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { WorkspacePanel } from "./WorkspacePanel";

const apiMock = vi.hoisted(() => ({
  listWorkspaceFiles: vi.fn(),
  readWorkspaceFile: vi.fn(),
  logWorkspaceCommits: vi.fn(),
  diffWorkspace: vi.fn(),
  commitWorkspace: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  listWorkspaceFiles: apiMock.listWorkspaceFiles,
  readWorkspaceFile: apiMock.readWorkspaceFile,
  logWorkspaceCommits: apiMock.logWorkspaceCommits,
  diffWorkspace: apiMock.diffWorkspace,
  commitWorkspace: apiMock.commitWorkspace,
}));

afterEach(cleanup);

describe("WorkspacePanel", () => {
  beforeEach(() => {
    apiMock.listWorkspaceFiles.mockResolvedValue({ ok: true, files: [".gitignore", "notes.md"] });
    apiMock.logWorkspaceCommits.mockResolvedValue({
      ok: true,
      commits: [
        { sha: "b".repeat(40), at: "2026-11-14T10:01:00Z", message: "add notes" },
        { sha: "a".repeat(40), at: "2026-11-14T10:00:00Z", message: "chore: initialize workspace" },
      ],
    });
    apiMock.readWorkspaceFile.mockResolvedValue({ ok: true, content: "# hello\n" });
    apiMock.diffWorkspace.mockResolvedValue({ ok: true, diff: "+# hello" });
    apiMock.commitWorkspace.mockResolvedValue({ ok: true, sha: "c".repeat(40) });
  });

  it("lists files and history, opens a file as inert text", async () => {
    render(<WorkspacePanel projectId="proj-1" />);
    expect(await screen.findByRole("button", { name: "Open notes.md" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Show add notes" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Open notes.md" }));
    expect(await screen.findByText("# hello")).toBeDefined();
    // no HTML interpretation — the viewer is a <pre>
    expect(document.querySelector('[data-testid="workspace-panel"] pre')?.tagName).toBe("PRE");
  });

  it("opens a commit diff against its parent", async () => {
    render(<WorkspacePanel projectId="proj-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Show add notes" }));
    await waitFor(() =>
      expect(apiMock.diffWorkspace).toHaveBeenCalledWith("proj-1", "a".repeat(40), "b".repeat(40))
    );
    expect(await screen.findByText("+# hello")).toBeDefined();
  });

  it("commits with the session link and refreshes", async () => {
    render(<WorkspacePanel projectId="proj-1" sessionId="ses-1" />);
    fireEvent.change(screen.getByLabelText(/commit working tree/i), { target: { value: "human touch" } });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await waitFor(() => expect(apiMock.commitWorkspace).toHaveBeenCalledWith("proj-1", "human touch", "ses-1"));
    await waitFor(() => expect(apiMock.listWorkspaceFiles).toHaveBeenCalledTimes(2));
  });
});
