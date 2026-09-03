import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
});
