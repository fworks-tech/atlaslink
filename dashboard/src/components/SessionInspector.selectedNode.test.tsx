import { describe, it, expect, afterEach } from "vitest";
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

  it("auto-switches tab on node click, preserves manual tab, re-autos after close", () => {
    const node = {
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
});
