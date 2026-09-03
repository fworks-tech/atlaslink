import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { Dispatch, ReactElement, SetStateAction } from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { SocietyDiagram } from "./SocietyDiagram";

const sessionsMock = vi.fn();
const eventsMock = vi.fn();

vi.mock("@/hooks/useSessions", () => ({
  useSessions: () => sessionsMock(),
}));

vi.mock("@/hooks/useEvents", () => ({
  useEvents: () => eventsMock(),
}));

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  interface StubNode {
    id: string;
    type?: string;
    data?: unknown;
  }
  function mockState<T>(init: T): [T, Dispatch<SetStateAction<T>>, () => void] {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- test stub mirroring the real hook shape
    const [v, s] = React.useState(init);
    return [v, s, () => {}];
  }
  return {
    ReactFlow: ({
      nodes,
      onNodeClick,
    }: {
      nodes: StubNode[];
      onNodeClick?: (e: unknown, n: StubNode) => void;
    }) => (
      <div data-testid="rf">
        {nodes.map((n) => (
          <button key={n.id} data-testid={`node-${n.id}`} onClick={() => onNodeClick?.({}, n)}>
            {n.id}
          </button>
        ))}
      </div>
    ),
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    useNodesState: mockState,
    useEdgesState: mockState,
  };
});

function seed() {
  sessionsMock.mockReturnValue({
    sessions: [
      {
        sessionId: "ses-1",
        correlationId: "cor-1",
        status: "running",
        version: 1,
        task: { member: "the-mediator", prompt: "review PR" },
      },
    ],
    loading: false,
  });
  eventsMock.mockReturnValue({ events: [] });
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

describe("SocietyDiagram node hydration", () => {
  it("fires onNodeClick once for a ?node= id that exists", async () => {
    const onNodeClick = vi.fn();
    let rerender!: (ui: ReactElement) => void;
    await act(async () => {
      ({ rerender } = render(<SocietyDiagram selectedSessionId="ses-1" onNodeClick={onNodeClick} selectedNodeId="ses-1" />));
    });
    expect(screen.getByTestId("node-ses-1")).toBeDefined();
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick).toHaveBeenCalledWith("ses-1", "session", expect.anything());
    await act(async () => {
      rerender(<SocietyDiagram selectedSessionId="ses-1" onNodeClick={onNodeClick} selectedNodeId="ses-1" />);
    });
    expect(onNodeClick).toHaveBeenCalledTimes(1);
  });

  it("ignores a ?node= id that does not exist", async () => {
    const onNodeClick = vi.fn();
    await act(async () => {
      render(<SocietyDiagram selectedSessionId="ses-1" onNodeClick={onNodeClick} selectedNodeId="no-such-node" />);
    });
    expect(onNodeClick).not.toHaveBeenCalled();
  });

  it("forwards clicks with id, type, and data", async () => {
    const onNodeClick = vi.fn();
    await act(async () => {
      render(<SocietyDiagram selectedSessionId="ses-1" onNodeClick={onNodeClick} />);
    });
    expect(onNodeClick).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByTestId("node-ses-1"));
    });
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick).toHaveBeenCalledWith("ses-1", "session", expect.anything());
  });
});
