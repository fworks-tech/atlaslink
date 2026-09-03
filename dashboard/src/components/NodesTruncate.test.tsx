import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { ReasoningNode } from "./ReasoningNode";
import { DecisionNode } from "./DecisionNode";
import { ToolNode } from "./ToolNode";
import { MemberNode } from "./MemberNode";
import { SessionNode } from "./SessionNode";
import { AwaitingNode } from "./AwaitingNode";
import { TerminalNode } from "./TerminalNode";
import type { BridgeEvent } from "@/lib/types";

afterEach(cleanup);

function renderNode(ui: React.ReactNode) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe("diagram node truncation", () => {
  it("truncates reasoning content at 120 chars with full-text title", () => {
    const long = "x".repeat(200);
    renderNode(
      // @ts-expect-error — NodeProps stub for unit test
      <ReasoningNode
        data={{ sessionId: "ses-1", step: 0, events: [{ content: long } as unknown as BridgeEvent] }}
        selected={false}
      />,
    );
    const el = screen.getByTitle(long);
    expect(el.textContent?.length).toBeLessThanOrEqual(120);
  });

  it("truncates decision outcome at 40 chars with title", () => {
    const outcome = "y".repeat(100);
    renderNode(
      // @ts-expect-error — NodeProps stub for unit test
      <DecisionNode data={{ event: { outcome } as unknown as BridgeEvent, sessionId: "ses-1" }} selected={false} />,
    );
    const el = screen.getByTitle(outcome);
    expect(el.textContent?.length).toBeLessThanOrEqual(40);
  });

  it("renders reasoning fallback when the step has no events", () => {
    renderNode(
      // @ts-expect-error — NodeProps stub for unit test
      <ReasoningNode data={{ sessionId: "ses-1", step: 0, events: [] }} selected={false} />,
    );
    expect(screen.getByText("reasoning")).toBeDefined();
  });

  it("truncates tool name with title tooltip", () => {
    const name = "tool-" + "z".repeat(100);
    renderNode(
      // @ts-expect-error — NodeProps stub for unit test
      <ToolNode data={{ pair: { called: { name } as unknown as BridgeEvent, result: null }, sessionId: "ses-1" }} selected={false} />,
    );
    expect(screen.getByTitle(name)).toBeDefined();
  });

  it("shows running vs result state on tool nodes", () => {
    const { unmount } = renderNode(
      // @ts-expect-error — NodeProps stub for unit test
      <ToolNode data={{ pair: { called: { name: "grep" } as unknown as BridgeEvent, result: null }, sessionId: "ses-1" }} selected={false} />,
    );
    expect(screen.getByText("running…")).toBeDefined();
    unmount();
    renderNode(
      // @ts-expect-error — NodeProps stub for unit test
      <ToolNode
        data={{ pair: { called: { name: "grep" } as unknown as BridgeEvent, result: { output: "ok" } as unknown as BridgeEvent }, sessionId: "ses-1" }}
        selected={false}
      />,
    );
    expect(screen.getByText("✓ result")).toBeDefined();
  });

  it("truncates reasoning summary at 80 chars with full-text title", () => {
    const summary = "s".repeat(150);
    renderNode(
      // @ts-expect-error — NodeProps stub for unit test
      <ReasoningNode
        data={{ sessionId: "ses-1", step: 0, events: [{ content: "thinking", summary } as unknown as BridgeEvent] }}
        selected={false}
      />,
    );
    const el = screen.getByTitle(summary);
    expect(el.textContent?.length).toBeLessThanOrEqual(82);
  });

  it("strips the- prefix and tooltips the full member name", () => {
    const member = "the-" + "m".repeat(100);
    renderNode(
      // @ts-expect-error — NodeProps stub for unit test
      <MemberNode data={{ member, active: true }} selected={false} />,
    );
    const el = screen.getByTitle(member);
    expect(el.textContent?.startsWith("the-")).toBe(false);
    expect(el.textContent?.length).toBeLessThanOrEqual(100);
  });

  it("carries the full session prompt in the title tooltip", () => {
    const prompt = "p".repeat(300);
    renderNode(
      // @ts-expect-error — NodeProps stub for unit test
      <SessionNode
        data={{
          session: {
            sessionId: "ses-1",
            correlationId: "cor-1",
            status: "running",
            version: 1,
            task: { member: "the-mediator", prompt },
          },
          members: [],
        }}
        selected={false}
      />,
    );
    expect(screen.getByTitle(prompt)).toBeDefined();
  });

  it("truncates awaiting prompt at 160 chars with full-text title", () => {
    const prompt = "a".repeat(200);
    renderNode(
      // @ts-expect-error — NodeProps stub for unit test
      <AwaitingNode data={{ session: { nextStep: { prompt } } }} selected={false} />,
    );
    const el = screen.getByTitle(prompt);
    expect(el.textContent?.length).toBeLessThanOrEqual(160);
  });

  it("renders terminal status with title tooltip", () => {
    const { unmount } = renderNode(
      // @ts-expect-error — NodeProps stub for unit test
      <TerminalNode data={{ session: { status: "succeeded" } }} selected={false} />,
    );
    expect(screen.getByTitle("succeeded")).toBeDefined();
    unmount();
    renderNode(
      // @ts-expect-error — NodeProps stub for unit test
      <TerminalNode data={{ session: { status: "failed" } }} selected={false} />,
    );
    expect(screen.getByTitle("failed")).toBeDefined();
  });
});

describe("diagram node resize handles", () => {
  const cases: Array<[string, (selected: boolean) => React.ReactNode]> = [
    [
      "reasoning",
      (selected) => (
        // @ts-expect-error — NodeProps stub for unit test
        <ReasoningNode data={{ sessionId: "ses-1", step: 0, events: [{ content: "x" } as unknown as BridgeEvent] }} selected={selected} />
      ),
    ],
    [
      "decision",
      (selected) => (
        // @ts-expect-error — NodeProps stub for unit test
        <DecisionNode data={{ event: { outcome: "yes" } as unknown as BridgeEvent, sessionId: "ses-1" }} selected={selected} />
      ),
    ],
    [
      "tool",
      (selected) => (
        // @ts-expect-error — NodeProps stub for unit test
        <ToolNode data={{ pair: { called: { name: "grep" } as unknown as BridgeEvent, result: null }, sessionId: "ses-1" }} selected={selected} />
      ),
    ],
    [
      "member",
      (selected) => (
        // @ts-expect-error — NodeProps stub for unit test
        <MemberNode data={{ member: "the-builder", active: false }} selected={selected} />
      ),
    ],
    [
      "session",
      (selected) => (
        // @ts-expect-error — NodeProps stub for unit test
        <SessionNode data={{ session: { sessionId: "ses-1", status: "running", task: { prompt: "do it" } }, members: [] }} selected={selected} />
      ),
    ],
    [
      "awaiting",
      (selected) => (
        // @ts-expect-error — NodeProps stub for unit test
        <AwaitingNode data={{ session: { nextStep: { prompt: "reply?" } } }} selected={selected} />
      ),
    ],
    [
      "terminal",
      (selected) => (
        // @ts-expect-error — NodeProps stub for unit test
        <TerminalNode data={{ session: { status: "succeeded" } }} selected={selected} />
      ),
    ],
  ];

  for (const [name, ui] of cases) {
    it(`shows resize handles for selected ${name} nodes only`, () => {
      const { container, unmount } = renderNode(ui(true));
      expect(container.querySelector(".react-flow__resize-control")).not.toBeNull();
      unmount();
      const hidden = renderNode(ui(false));
      expect(hidden.container.querySelector(".react-flow__resize-control")).toBeNull();
      hidden.unmount();
    });
  }
});
