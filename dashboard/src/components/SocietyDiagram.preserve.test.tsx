import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { NodeChange } from "@xyflow/react";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
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

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    ReactFlow: ({
      nodes,
      onNodesChange,
    }: {
      nodes: Array<{ id: string }>;
      onNodesChange?: (changes: NodeChange[]) => void;
    }) => {
      capturedOnNodesChange = onNodesChange ?? null;
      return (
        <div data-testid="rf">
          {nodes.map((n) => (
            <div
              key={n.id}
              data-testid={`rf-node-${n.id}`}
              // The merge effect preserves these across projection rebuilds.
              data-style={JSON.stringify((n as unknown as Record<string, unknown>).style ?? null)}
              data-selected={String((n as unknown as Record<string, unknown>).selected ?? false)}
              data-measured={JSON.stringify((n as unknown as Record<string, unknown>).measured ?? null)}
              data-position={JSON.stringify((n as unknown as Record<string, unknown>).position ?? null)}
            />
          ))}
        </div>
      );
    },
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
  };
});

function session() {
  return {
    sessionId: "ses-1",
    correlationId: "cor-1",
    status: "running" as const,
    version: 1,
    task: { member: "the-mediator", prompt: "review PR" },
  };
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  capturedOnNodesChange = null;
  sessionsMock.mockReturnValue({ sessions: [session()], loading: false });
  eventsMock.mockReturnValue({ events: [] });
});

describe("SocietyDiagram user size preservation", () => {
  it("keeps user selection, size, and position across projection rebuilds", async () => {
    const { rerender } = render(<SocietyDiagram selectedSessionId="ses-1" />);
    expect(screen.getByTestId("rf-node-ses-1")).toBeDefined();
    expect(capturedOnNodesChange).not.toBeNull();

    // Simulate the user selecting, dragging, and resizing the node.
    await act(async () => {
      capturedOnNodesChange?.([
        { type: "select", id: "ses-1", selected: true },
        { type: "position", id: "ses-1", position: { x: 111, y: 222 } },
        { type: "dimensions", id: "ses-1", dimensions: { width: 400, height: 300 } },
      ]);
    });
    expect(screen.getByTestId("rf-node-ses-1").getAttribute("data-selected")).toBe("true");
    expect(screen.getByTestId("rf-node-ses-1").getAttribute("data-measured")).toContain("400");

    // A live update rebuilds the projection (debounced); the user's
    // selection, size, and position must survive it.
    sessionsMock.mockReturnValue({ sessions: [{ ...session(), version: 2 }], loading: false });
    await act(async () => {
      rerender(<SocietyDiagram selectedSessionId="ses-1" />);
    });

    await waitFor(() => {
      const node = screen.getByTestId("rf-node-ses-1");
      expect(node.getAttribute("data-selected")).toBe("true");
      expect(node.getAttribute("data-measured")).toContain("400");
      expect(node.getAttribute("data-position")).toContain("111");
    });
  });

  it("prunes nodes the projection no longer yields", async () => {
    const { rerender } = render(<SocietyDiagram selectedSessionId="ses-1" />);
    expect(screen.getByTestId("rf-node-ses-1")).toBeDefined();
    sessionsMock.mockReturnValue({ sessions: [], loading: false });
    await act(async () => {
      rerender(<SocietyDiagram selectedSessionId="ses-1" />);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("rf-node-ses-1")).toBeNull();
    });
  });
});
