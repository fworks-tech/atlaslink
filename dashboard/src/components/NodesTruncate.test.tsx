import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { ReasoningNode } from "./ReasoningNode";
import { DecisionNode } from "./DecisionNode";
import { ToolNode } from "./ToolNode";
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

  it("truncates tool name with title tooltip", () => {
    const name = "tool-" + "z".repeat(100);
    renderNode(
      // @ts-expect-error — NodeProps stub for unit test
      <ToolNode data={{ pair: { called: { name } as unknown as BridgeEvent, result: null }, sessionId: "ses-1" }} selected={false} />,
    );
    expect(screen.getByTitle(name)).toBeDefined();
  });
});
