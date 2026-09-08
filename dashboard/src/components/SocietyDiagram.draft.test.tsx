import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { Connection, Node, NodeChange, XYPosition } from "@xyflow/react";
import { fireEvent, render, screen, cleanup, act, waitFor } from "@testing-library/react";
import { SocietyDiagram } from "./SocietyDiagram";

const sessionsMock = vi.fn();
const eventsMock = vi.fn();

vi.mock("@/hooks/useSessions", () => ({
  useSessions: () => sessionsMock(),
}));

vi.mock("@/hooks/useEvents", () => ({
  useEvents: () => eventsMock(),
}));

let capturedOnNodesChange: ((changes: NodeChange[]) => void) | null = null;
let capturedOnConnect: ((connection: Connection) => void) | null = null;

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    useReactFlow: () => ({ screenToFlowPosition: (p: XYPosition) => p }),
    ReactFlow: ({
      nodes,
      onNodesChange,
      onConnect,
    }: {
      nodes: Array<{ id: string }>;
      onNodesChange?: (changes: NodeChange[]) => void;
      onConnect?: (connection: Connection) => void;
    }) => {
      capturedOnNodesChange = onNodesChange ?? null;
      capturedOnConnect = onConnect ?? null;
      return (
        <div data-testid="rf">
          {nodes.map((n) => (
            <div key={n.id} data-testid={`rf-node-${n.id}`} />
          ))}
        </div>
      );
    },
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
  };
});

function session(version = 1) {
  return {
    sessionId: "ses-1",
    correlationId: "cor-1",
    status: "running" as const,
    version,
    task: { member: "the-mediator", prompt: "review PR" },
  };
}

function dropPayload(type: string) {
  return { dataTransfer: { getData: (mime: string) => (mime === "application/atlaslink-agent" ? type : "") } };
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  capturedOnNodesChange = null;
  capturedOnConnect = null;
  sessionsMock.mockReturnValue({ sessions: [session()], loading: false });
  eventsMock.mockReturnValue({ events: [] });
});

describe("SocietyDiagram draft overlay", () => {
  it("drops a palette agent onto the canvas as a draft node", async () => {
    const onDraftDrop = vi.fn();
    render(<SocietyDiagram selectedSessionId="ses-1" onDraftDrop={onDraftDrop} />);
    fireEvent.drop(screen.getByTestId("flow-dropzone"), {
      ...dropPayload("member"),
      clientX: 100,
      clientY: 200,
    });
    expect(onDraftDrop).toHaveBeenCalledTimes(1);
    const [agentType, position] = onDraftDrop.mock.calls[0];
    expect(agentType).toBe("member");
    expect(typeof position).toBe("object");
  });

  it("ignores drops without an agent payload", () => {
    const onDraftDrop = vi.fn();
    render(<SocietyDiagram selectedSessionId="ses-1" onDraftDrop={onDraftDrop} />);
    fireEvent.drop(screen.getByTestId("flow-dropzone"), {
      ...dropPayload(""),
      clientX: 10,
      clientY: 10,
    });
    expect(onDraftDrop).not.toHaveBeenCalled();
  });

  it("renders draft nodes beside live nodes and keeps them across projection rebuilds", async () => {
    const draft: Node = {
      id: "draft-abc",
      type: "member",
      position: { x: 10, y: 20 },
      data: { label: "New Member", draft: true },
    };
    const { rerender } = render(<SocietyDiagram selectedSessionId="ses-1" draftNodes={[draft]} />);
    expect(screen.getByTestId("rf-node-ses-1")).toBeDefined();
    expect(screen.getByTestId("rf-node-draft-abc")).toBeDefined();

    sessionsMock.mockReturnValue({ sessions: [session(2)], loading: false });
    await act(async () => {
      rerender(<SocietyDiagram selectedSessionId="ses-1" draftNodes={[draft]} />);
    });
    await waitFor(() => {
      expect(screen.getByTestId("rf-node-draft-abc")).toBeDefined();
    });
  });

  it("routes draft-to-live connections to the draft handler, not the projection", () => {
    const onDraftConnect = vi.fn();
    render(<SocietyDiagram selectedSessionId="ses-1" onDraftConnect={onDraftConnect} />);
    expect(capturedOnConnect).not.toBeNull();
    act(() => {
      capturedOnConnect?.({ source: "draft-abc", target: "ses-1", sourceHandle: null, targetHandle: null });
    });
    expect(onDraftConnect).toHaveBeenCalledWith("draft-abc", "ses-1");
  });

  it("routes draft node changes to the draft handler instead of the drag tracker", async () => {
    const onDraftNodesChange = vi.fn();
    render(<SocietyDiagram selectedSessionId="ses-1" draftNodes={[]} onDraftNodesChange={onDraftNodesChange} />);
    expect(capturedOnNodesChange).not.toBeNull();
    await act(async () => {
      capturedOnNodesChange?.([{ type: "position", id: "draft-abc", position: { x: 5, y: 5 } }]);
    });
    expect(onDraftNodesChange).toHaveBeenCalledTimes(1);
  });
});
