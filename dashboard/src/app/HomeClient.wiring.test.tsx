import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import HomeClient from "./HomeClient";

const routerPush = vi.fn();
const routerReplace = vi.fn();
const searchParamsMock = vi.fn();
const projectsMock = vi.fn();
const sessionsMock = vi.fn();
const eventsMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  useSearchParams: () => searchParamsMock(),
}));

vi.mock("@/hooks/useProjects", () => ({
  useProjects: () => projectsMock(),
}));

vi.mock("@/hooks/useSessions", () => ({
  useSessions: () => sessionsMock(),
}));

vi.mock("@/hooks/useEvents", () => ({
  useEvents: () => eventsMock(),
}));

// biome-ignore lint/suspicious/noExplicitAny: test stubs
vi.mock("@/components/SocietyDiagram", () => ({
  SocietyDiagram: ({
    onNodeClick,
    selectedNodeId,
  }: {
    onNodeClick: (id: string, type: string, data: unknown) => void;
    selectedNodeId?: string;
  }) => (
    <div data-testid="diagram" data-node={selectedNodeId ?? ""}>
      <button data-testid="click-node" onClick={() => onNodeClick("n-1", "tool", { pair: {} })}>
        click-node
      </button>
    </div>
  ),
}));

vi.mock("@/components/SessionList", () => ({
  SessionList: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button data-testid="select-ses2" onClick={() => onSelect("ses-2")}>
      select-ses2
    </button>
  ),
}));

vi.mock("@/components/SessionInspector", () => ({
  SessionInspector: ({
    open,
    selectedNode,
    onClose,
  }: {
    open: boolean;
    selectedNode?: { id: string } | null;
    onClose: () => void;
  }) =>
    open ? (
      <div data-testid="inspector" data-selected={selectedNode?.id ?? ""}>
        <button data-testid="close-inspector" onClick={onClose}>
          close
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/SessionThread", () => ({
  SessionThread: () => null,
}));
vi.mock("@/components/SessionComposer", () => ({
  SessionComposer: () => null,
}));
vi.mock("@/components/Sidebar", () => ({
  Sidebar: () => null,
}));
vi.mock("@/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function seed(params: string) {
  searchParamsMock.mockReturnValue(new URLSearchParams(params));
  projectsMock.mockReturnValue({ projects: [], loading: false, error: null, addProject: vi.fn() });
  sessionsMock.mockReturnValue({
    sessions: [
      {
        sessionId: "ses-1",
        correlationId: "cor-1",
        status: "running",
        version: 1,
        projectId: "p-1",
        task: { member: "the-mediator", prompt: "review PR" },
      },
      {
        sessionId: "ses-2",
        correlationId: "cor-2",
        status: "queued",
        version: 1,
        projectId: "p-1",
        task: { member: "the-mediator", prompt: "second task" },
      },
    ],
  });
  eventsMock.mockReturnValue({ events: [] });
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

describe("HomeClient inspector wiring", () => {
  it("passes ?node= through to the diagram and opens the inspector on click", () => {
    seed("session=ses-1&node=ses-1::reasoning::0");
    render(<HomeClient />);
    expect(screen.getByTestId("diagram").getAttribute("data-node")).toBe("ses-1::reasoning::0");
    expect(screen.queryByTestId("inspector")).toBeNull();
    fireEvent.click(screen.getByTestId("click-node"));
    expect(screen.getByTestId("inspector").getAttribute("data-selected")).toBe("n-1");
    expect(routerReplace).toHaveBeenCalledWith("?session=ses-1&node=n-1", { scroll: false });
  });

  it("closing the inspector clears ?node= but keeps the session", () => {
    seed("session=ses-1&node=n-1");
    render(<HomeClient />);
    fireEvent.click(screen.getByTestId("click-node"));
    expect(screen.getByTestId("inspector")).toBeDefined();
    fireEvent.click(screen.getByTestId("close-inspector"));
    expect(routerReplace).toHaveBeenCalledWith("?session=ses-1", { scroll: false });
    expect(screen.queryByTestId("inspector")).toBeNull();
  });

  it("switching sessions drops stale ?node= and closes the inspector", () => {
    seed("session=ses-1&node=n-1");
    render(<HomeClient />);
    fireEvent.click(screen.getByTestId("click-node"));
    expect(screen.getByTestId("inspector")).toBeDefined();
    fireEvent.click(screen.getByTestId("select-ses2"));
    expect(routerPush).toHaveBeenCalledWith("?session=ses-2&project=p-1");
    expect(screen.queryByTestId("inspector")).toBeNull();
  });
});
