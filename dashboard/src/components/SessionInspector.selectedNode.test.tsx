import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SessionInspector } from "./SessionInspector";
import type { BridgeEvent, Session } from "@/lib/types";

afterEach(cleanup);

function session(): Session {
  return {
    sessionId: "ses-1",
    correlationId: "cor-1",
    status: "running",
    version: 1,
    task: { member: "the-mediator", prompt: "review PR" },
  };
}

describe("SessionInspector selectedNode", () => {
  it("shows usage rollup in overview and token chips per reasoning step", () => {
    const events = [
      { type: "reasoning", correlationId: "cor-1", step: 0, member: "the-builder", content: "thinking", model: "muse", promptTokens: 12, completionTokens: 8, stepCost: 0.0025 },
      { type: "tool.called", correlationId: "cor-1", name: "grep", args: {} },
      { type: "tool.result", correlationId: "cor-1", durationMs: 700 },
    ] as unknown as BridgeEvent[];
    render(<SessionInspector open onClose={() => {}} session={session()} events={events} />);
    const rollup = screen.getByLabelText("session usage");
    expect(rollup).toBeDefined();
    expect(rollup).toHaveTextContent("12 in tok");
    expect(rollup).toHaveTextContent("8 out tok");
    expect(rollup).toHaveTextContent("$0.0025");
    expect(rollup).toHaveTextContent("1 tool calls · 0.7s");
    expect(rollup).toHaveTextContent("muse");
    fireEvent.click(screen.getByRole("button", { name: /^reasoning/ }));
    expect(screen.getByText("12↗ 8↘")).toBeDefined();
    expect(screen.getByText("$0.0025")).toBeDefined();
  });

  it("renders reasoning node payload without session switch", () => {
    render(
      <SessionInspector
        open
        onClose={() => {}}
        session={session()}
        events={[]}
        selectedNode={{
          id: "ses-1::reasoning::0",
          type: "reasoning",
          data: {
            sessionId: "ses-1",
            step: 0,
            events: [{ content: "Happy to route that" } as unknown as BridgeEvent],
          },
        }}
      />,
    );
    expect(screen.getByText("selected node")).toBeDefined();
    expect(screen.getByText("ses-1::reasoning::0")).toBeDefined();
    expect(screen.getByText("Happy to route that")).toBeDefined();
  });

  it("renders tool node payload and keeps empty state only when nothing selected", () => {
    const { unmount } = render(
      <SessionInspector
        open
        onClose={() => {}}
        session={null}
        events={[]}
        selectedNode={{ id: "t-1", type: "tool", data: { pair: { called: { name: "grep" }, result: null } } }}
      />,
    );
    expect(screen.queryByText("Select a node to see details.")).toBeNull();
    expect(screen.getByText("grep")).toBeDefined();
    unmount();
    render(<SessionInspector open onClose={() => {}} session={null} events={[]} selectedNode={null} />);
    expect(screen.getByText("Select a node to see details.")).toBeDefined();
  });

  it("falls back to JSON for unknown types", () => {
    render(
      <SessionInspector
        open
        onClose={() => {}}
        session={session()}
        events={[]}
        selectedNode={{ id: "x", type: "mystery", data: { foo: "bar" } }}
      />,
    );
    expect(screen.getByText(/"foo"/)).toBeDefined();
  });

  it("auto-switches tab on node click, preserves manual tab, re-autos after close", () => {    const node = {
      id: "ses-1::reasoning::0",
      type: "reasoning",
      data: {
        sessionId: "ses-1",
        step: 0,
        events: [{ content: "Happy to route that" } as unknown as BridgeEvent],
      },
    };
    const props = { open: true, onClose: () => {}, session: session(), events: [] as BridgeEvent[] };
    const { rerender } = render(<SessionInspector {...props} selectedNode={node} />);
    // New node selection auto-switches away from overview.
    expect(screen.getByText("No reasoning yet — mediator has not streamed.")).toBeDefined();

    // Manual tab switches survive re-renders with the same node.
    fireEvent.click(screen.getByRole("button", { name: "overview" }));
    expect(screen.getByText("review PR")).toBeDefined();
    rerender(<SessionInspector {...props} selectedNode={node} />);
    expect(screen.getByText("review PR")).toBeDefined();

    // Closing (null) resets the latch so reopening re-autos.
    rerender(<SessionInspector {...props} selectedNode={null} />);
    rerender(<SessionInspector {...props} selectedNode={node} />);
    expect(screen.getByText("No reasoning yet — mediator has not streamed.")).toBeDefined();
  });

  it("renders decision payload and auto-switches to decisions", () => {
    render(
      <SessionInspector
        open
        onClose={() => {}}
        session={session()}
        events={[]}
        selectedNode={{
          id: "ses-1::decision::0",
          type: "decision",
          data: { sessionId: "ses-1", event: { decisionId: "d-1", outcome: "route-approved" } },
        }}
      />,
    );
    expect(screen.getByText("route-approved")).toBeDefined();
    expect(screen.getByText("No decisions recorded.")).toBeDefined();
  });

  it("renders member and session payloads on the overview tab", () => {
    const props = { open: true, onClose: () => {}, session: session(), events: [] as BridgeEvent[] };
    const { unmount } = render(
      <SessionInspector
        {...props}
        selectedNode={{ id: "ses-1::the-builder", type: "member", data: { member: "the-builder", sessionId: "ses-1", active: true } }}
      />,
    );
    expect(screen.getByText("the-builder")).toBeDefined();
    expect(screen.getByText(/active · holds the podium/)).toBeDefined();
    expect(screen.getByText("review PR")).toBeDefined();
    unmount();
    render(
      <SessionInspector
        {...props}
        selectedNode={{ id: "ses-1", type: "session", data: { session: { task: { prompt: "do the thing" }, status: "done" } } }}
      />,
    );
    expect(screen.getByText("do the thing")).toBeDefined();
    expect(screen.getByText("status: done")).toBeDefined();
  });

  it("renders tool result output and auto-switches to tools", () => {
    render(
      <SessionInspector
        open
        onClose={() => {}}
        session={session()}
        events={[]}
        selectedNode={{
          id: "t-2",
          type: "tool",
          data: { pair: { called: { name: "bash", args: "ls" }, result: { output: "file.txt" } } },
        }}
      />,
    );
    expect(screen.getByText("bash")).toBeDefined();
    expect(screen.getByText(/file\.txt/)).toBeDefined();
    expect(screen.getByText("No tool calls yet.")).toBeDefined();
  });

  it("renders reasoning summary and overflow count for multi-event steps", () => {
    render(
      <SessionInspector
        open
        onClose={() => {}}
        session={session()}
        events={[]}
        selectedNode={{
          id: "ses-1::reasoning::0",
          type: "reasoning",
          data: {
            sessionId: "ses-1",
            step: 0,
            events: [{ content: "first thought", summary: "short sum" }, { content: "second thought" }] as unknown as BridgeEvent[],
          },
        }}
      />,
    );
    expect(screen.getByText("first thought")).toBeDefined();
    expect(screen.getByText(/short sum/)).toBeDefined();
    expect(screen.getByText("+1 more event(s) in this step")).toBeDefined();
  });

  it("falls back to reasoning label when the step has no events", () => {
    render(
      <SessionInspector
        open
        onClose={() => {}}
        session={session()}
        events={[]}
        selectedNode={{ id: "ses-1::reasoning::0", type: "reasoning", data: { sessionId: "ses-1", step: 0, events: [] } }}
      />,
    );
    // The type badge and tab share the label — pin the payload container.
    expect(
      screen.getByText(
        (content, el) => content === "reasoning" && (el?.className ?? "").includes("whitespace-pre-wrap"),
      ),
    ).toBeDefined();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <SessionInspector
        open={false}
        onClose={() => {}}
        session={session()}
        events={[]}
        selectedNode={{ id: "x", type: "tool", data: {} }}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows a loading state instead of the fallback while context resolves", () => {
    const { unmount } = render(
      <SessionInspector
        open
        onClose={() => {}}
        session={null}
        contextLoading
        events={[]}
        selectedNode={{ id: "n-1", type: "tool", data: {} }}
      />,
    );
    expect(screen.getByText("Loading session context…")).toBeDefined();
    expect(screen.queryByText(/not loaded yet/)).toBeNull();
    unmount();
    render(
      <SessionInspector
        open
        onClose={() => {}}
        session={null}
        events={[]}
        selectedNode={{ id: "n-1", type: "tool", data: {} }}
      />,
    );
    expect(screen.getByText(/not loaded yet/)).toBeDefined();
  });

  it("keeps the node payload visible above the loading state", () => {
    render(
      <SessionInspector
        open
        onClose={() => {}}
        session={null}
        contextLoading
        events={[]}
        selectedNode={{
          id: "ses-1::reasoning::0",
          type: "reasoning",
          data: { sessionId: "ses-1", step: 0, events: [{ content: "sticky payload" }] as unknown as BridgeEvent[] },
        }}
      />,
    );
    expect(screen.getByText("sticky payload")).toBeDefined();
    expect(screen.getByText("Loading session context…")).toBeDefined();
  });

  it("wraps long unbroken tool args", () => {
    render(
      <SessionInspector
        open
        onClose={() => {}}
        session={session()}
        events={[]}
        selectedNode={{
          id: "t-3",
          type: "tool",
          data: { pair: { called: { name: "grep", args: "x".repeat(600) }, result: null } },
        }}
      />,
    );
    const args = screen.getByText(
      (content, el) => content.startsWith("args:") && (el?.className ?? "").includes("text-muted"),
    );
    expect(args.className).toContain("break-words");
  });

  it("contains a 2000-char payload inside a scrolling header", () => {
    const payload = "p".repeat(2000);
    const { container } = render(
      <SessionInspector
        open
        onClose={() => {}}
        session={session()}
        events={[]}
        selectedNode={{
          id: "ses-1::reasoning::0",
          type: "reasoning",
          data: { sessionId: "ses-1", step: 0, events: [{ content: payload }] as unknown as BridgeEvent[] },
        }}
      />,
    );
    const drawer = container.firstElementChild as HTMLElement;
    expect(drawer.className).toContain("max-w-[90vw]");
    const body = screen.getByText(
      (content, el) => content === payload && (el?.className ?? "").includes("whitespace-pre-wrap"),
    );
    expect(body.className).toContain("break-words");
    const header = body.closest("section") as HTMLElement;
    expect(header.className).toContain("overflow-y-auto");
  });

  it("closes on Escape", () => {
    let closed = false;
    render(<SessionInspector open onClose={() => { closed = true; }} session={session()} events={[]} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(closed).toBe(true);
  });

  it("renders an editable config panel for a draft member node", () => {
    const onConfigChange = vi.fn();
    render(
      <SessionInspector
        open
        onClose={() => {}}
        session={null}
        events={[]}
        selectedNode={{
          id: "draft-abc",
          type: "member",
          data: { member: "the-builder", sessionId: "ses-1", active: true, draft: true, config: { provider: "opencode", model: "claude-sonnet-4-20250514", temperature: 0.7, maxTokens: 4096, tools: [] } },
        }}
        onConfigChange={onConfigChange}
      />,
    );
    expect(screen.getByLabelText("provider")).toBeDefined();
    expect(screen.getByLabelText("temperature")).toBeDefined();
    fireEvent.change(screen.getByLabelText("temperature"), { target: { value: "0.3" } });
    expect(onConfigChange).toHaveBeenCalledWith("draft-abc", expect.objectContaining({ temperature: 0.3 }));
  });

  it("renders a read-only config for a live session node", () => {
    render(
      <SessionInspector
        open
        onClose={() => {}}
        session={{ ...session(), tweaks: { provider: "groq", member: { model: "llama-3.3", temperature: 0.2, maxTokens: 2048, tools: [] } } }}
        events={[]}
        selectedNode={{ id: "ses-1", type: "session", data: { session: { task: { prompt: "p" }, status: "running" } } }}
      />,
    );
    expect(screen.getByText("groq")).toBeDefined();
    expect(screen.getByText("llama-3.3")).toBeDefined();
    expect(screen.queryByLabelText("provider")).toBeNull();
  });

  it("marks clamped payloads with an ellipsis and full-text tooltip", () => {
    const long = "x".repeat(600);
    render(
      <SessionInspector
        open
        onClose={() => {}}
        session={null}
        events={[]}
        selectedNode={{ id: "ses-9", type: "session", data: { session: { status: "running", task: { prompt: long } } } }}
      />,
    );
    const el = screen.getByTitle(long);
    expect(el.textContent).toBe(`${long.slice(0, 500)}…`);
  });
});
