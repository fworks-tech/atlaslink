import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { SessionComposer } from "./SessionComposer";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    createTask: vi.fn(async () => ({ ok: true, session: { sessionId: "ses-123", correlationId: "cor-1", status: "queued", version: 1, task: { member: "the-mediator", prompt: "hi" } } })),
  };
});

import { createTask } from "@/lib/api";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionComposer", () => {
  it("renders prompt textarea and validates prompt length", async () => {
    const projects = [{ id: "proj-1", name: "alpha", createdAt: new Date().toISOString() }];
    const onCreate = vi.fn();
    render(<SessionComposer projects={projects} onCreateSession={onCreate} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(10000);

    const button = screen.getByRole("button", { name: /ask atlas/i });
    expect(button).toBeDisabled();
    fireEvent.change(textarea, { target: { value: "  hello  " } });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ prompt: "hello", member: "the-mediator" })));
    expect(onCreate).toHaveBeenCalledWith("ses-123");
    expect(textarea.value).toBe("");
  });

  it("includes projectId when selected and retains it after success", async () => {
    const projects = [
      { id: "proj-1", name: "alpha", createdAt: new Date().toISOString() },
      { id: "proj-2", name: "beta", createdAt: new Date().toISOString() },
    ];
    const onCreate = vi.fn();
    render(<SessionComposer projects={projects} onCreateSession={onCreate} />);
    const projectSelect = screen.getByDisplayValue("no project") as HTMLSelectElement;
    fireEvent.change(projectSelect, { target: { value: "proj-2" } });
    expect(projectSelect.value).toBe("proj-2");

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "do thing" } });
    fireEvent.click(screen.getByRole("button", { name: /ask atlas/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ projectId: "proj-2" })));
    expect(projectSelect.value).toBe("proj-2");
  });

  it("rejects prompt over 10000 chars", async () => {
    const onCreate = vi.fn();
    render(<SessionComposer projects={[]} onCreateSession={onCreate} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "a".repeat(10001) } });
    fireEvent.click(screen.getByRole("button", { name: /ask atlas/i }));
    await waitFor(() => expect(screen.getByText(/≤10000/)).toBeInTheDocument());
    expect(createTask).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });
});
