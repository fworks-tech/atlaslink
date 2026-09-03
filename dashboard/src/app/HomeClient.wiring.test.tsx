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
const refreshMock = vi.fn();
const replyMock = vi.fn();
const chatMock = vi.fn();
const steerMock = vi.fn();
const cancelMock = vi.fn();
const presenceMock = vi.fn();
const hydrateMock = vi.fn();

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

vi.mock("@/hooks/useRoomPresence", () => ({
  useRoomPresence: () => presenceMock(),
}));

vi.mock("@/lib/api", () => ({
  replyToSession: (...args: unknown[]) => replyMock(...args),
  sendChatMessage: (...args: unknown[]) => chatMock(...args),
  steerSession: (...args: unknown[]) => steerMock(...args),
  cancelSession: (...args: unknown[]) => cancelMock(...args),
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
    session,
    contextLoading,
    onClose,
  }: {
    open: boolean;
    selectedNode?: { id: string } | null;
    session?: { sessionId: string } | null;
    contextLoading?: boolean;
    onClose: () => void;
  }) =>
    open ? (
      <div data-testid="inspector" data-selected={selectedNode?.id ?? ""} data-session={session?.sessionId ?? ""} data-loading={contextLoading ? "true" : "false"}>
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
  presenceMock.mockReturnValue({ members: [] });
  hydrateMock.mockResolvedValue({ sessionId: "ses-hydrated" });
  projectsMock.mockReturnValue({ projects: [], loading: false, error: null, addProject: vi.fn() });
  sessionsMock.mockReturnValue({
    loading: false,
    error: null,
    hydrateSession: hydrateMock,
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
    refresh: refreshMock,
  });
  eventsMock.mockReturnValue({ events: [] });
}

function seedRoom(params: string) {
  searchParamsMock.mockReturnValue(new URLSearchParams(params));
  presenceMock.mockReturnValue({ members: [] });
  hydrateMock.mockResolvedValue({ sessionId: "ses-hydrated" });
  projectsMock.mockReturnValue({ projects: [], loading: false, error: null, addProject: vi.fn() });
  sessionsMock.mockReturnValue({
    loading: false,
    error: null,
    hydrateSession: hydrateMock,
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
        sessionId: "ses-9",
        correlationId: "cor-9",
        status: "awaiting_input",
        version: 2,
        task: { member: "the-architect", prompt: "plan" },
        nextStep: { awaiting_input: true, prompt: "Ship it?", member: "the-architect" },
        question: { question: "Ship it?", context: "plan context" },
      },
      {
        sessionId: "ses-7",
        correlationId: "cor-7",
        status: "succeeded",
        version: 3,
        task: { member: "the-builder", prompt: "done work" },
      },
    ],
    refresh: refreshMock,
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

describe("HomeClient room wiring", () => {
  beforeEach(() => {
    chatMock.mockResolvedValue({ ok: true, session: {} });
    steerMock.mockResolvedValue({ ok: true, session: {} });
    cancelMock.mockResolvedValue({ ok: true, status: "cancelled", session: {} });
    replyMock.mockResolvedValue({ ok: true, session: {}, resumedSession: { sessionId: "ses-10" } });
  });

  it("chat composer posts to the room, clears, and refreshes", async () => {
    seedRoom("session=ses-1");
    render(<HomeClient />);
    fireEvent.change(screen.getByLabelText("Message the room"), { target: { value: "hi all" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await vi.waitFor(() => expect(chatMock).toHaveBeenCalledWith("ses-1", "hi all"));
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    // the clear lands on a later flush than the refresh call — wait for the DOM
    await vi.waitFor(() => expect(screen.getByLabelText("Message the room")).toHaveValue(""));
  });

  it("approval inbox renders the question plus context and replies via the composer", async () => {
    seedRoom("session=ses-9");
    render(<HomeClient />);
    expect(screen.getByText(/Ship it\?/)).toBeDefined();
    expect(screen.getByText("plan context")).toBeDefined();
    expect(screen.queryByRole("button", { name: "yes" })).toBeNull();
    const replyInput = screen.getByPlaceholderText("Type your reply…");
    fireEvent.change(replyInput, { target: { value: "go ahead" } });
    const sendBtn = replyInput.parentElement?.querySelector("button");
    expect(sendBtn).not.toBeNull();
    fireEvent.click(sendBtn as HTMLButtonElement);
    await vi.waitFor(() => expect(replyMock).toHaveBeenCalledWith("ses-9", "go ahead"));
    await vi.waitFor(() => expect(routerPush).toHaveBeenCalledWith(expect.stringContaining("ses-10")));
  });

  it("steer box steers and the interrupt button cancels a running session", async () => {
    seedRoom("session=ses-1");
    render(<HomeClient />);
    fireEvent.change(screen.getByLabelText("Redirect this session"), { target: { value: "pivot" } });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await vi.waitFor(() => expect(steerMock).toHaveBeenCalledWith("ses-1", "pivot"));
    // the steer round-trip disables the box while in flight — wait for it to settle
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Interrupt" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Interrupt" }));
    await vi.waitFor(() => expect(cancelMock).toHaveBeenCalledWith("ses-1"));
  });

  it("terminal sessions hide the chat composer and the steer box", () => {
    seedRoom("session=ses-7");
    render(<HomeClient />);
    expect(screen.queryByLabelText("Message the room")).toBeNull();
    expect(screen.queryByLabelText("Redirect this session")).toBeNull();
    expect(screen.queryByRole("button", { name: "Interrupt" })).toBeNull();
  });

  it("hydrates a deep-linked session missing from the list", async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("session=ses-9"));
    presenceMock.mockReturnValue({ members: [] });
    projectsMock.mockReturnValue({ projects: [], loading: false, error: null, addProject: vi.fn() });
    hydrateMock.mockResolvedValue({ sessionId: "ses-9" });
    sessionsMock.mockReturnValue({ sessions: [], loading: false, error: null, refresh: refreshMock, hydrateSession: hydrateMock });
    eventsMock.mockReturnValue({ events: [] });
    render(<HomeClient />);
    await vi.waitFor(() => expect(hydrateMock).toHaveBeenCalledWith("ses-9"));
  });

  it("does not hydrate a session already in the list", () => {
    seedRoom("session=ses-1");
    render(<HomeClient />);
    expect(hydrateMock).not.toHaveBeenCalled();
  });

  it("does not hydrate while the list is still loading", () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("session=ses-9"));
    presenceMock.mockReturnValue({ members: [] });
    projectsMock.mockReturnValue({ projects: [], loading: false, error: null, addProject: vi.fn() });
    sessionsMock.mockReturnValue({ sessions: [], loading: true, error: null, refresh: refreshMock, hydrateSession: hydrateMock });
    eventsMock.mockReturnValue({ events: [] });
    render(<HomeClient />);
    expect(hydrateMock).not.toHaveBeenCalled();
  });

  it("Enter submits the chat form", async () => {
    seedRoom("session=ses-1");
    render(<HomeClient />);
    const input = screen.getByLabelText("Message the room");
    fireEvent.change(input, { target: { value: "hi all" } });
    const form = input.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    await vi.waitFor(() => expect(chatMock).toHaveBeenCalledWith("ses-1", "hi all"));
  });

  it("shows the room presence count in the chat header", () => {
    seedRoom("session=ses-1");
    presenceMock.mockReturnValue({ members: [{ name: "a" }, { name: "b" }] });
    render(<HomeClient />);
    expect(screen.getByText(/2 here/)).toBeDefined();
  });

  it("chat failure shows a status-qualified error with retry and clears on edit", async () => {
    seedRoom("session=ses-1");
    chatMock.mockRejectedValueOnce(new Error("404 not found")).mockRejectedValueOnce(new Error("404 not found"));
    render(<HomeClient />);
    const input = screen.getByLabelText("Message the room");
    fireEvent.change(input, { target: { value: "hi all" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await vi.waitFor(() => expect(screen.getByText("404 not found")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await vi.waitFor(() => expect(chatMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(screen.getByText("404 not found")).toBeDefined());
    fireEvent.change(input, { target: { value: "hi all!" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await vi.waitFor(() => expect(chatMock).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("posts exactly once on double submit", async () => {
    seedRoom("session=ses-1");
    render(<HomeClient />);
    fireEvent.change(screen.getByLabelText("Message the room"), { target: { value: "hi all" } });
    const send = screen.getByRole("button", { name: "Send" });
    fireEvent.click(send);
    fireEvent.click(send);
    await vi.waitFor(() => expect(chatMock).toHaveBeenCalledTimes(1));
  });

  it("a failed list refresh does not mark a delivered chat as failed", async () => {
    seedRoom("session=ses-1");
    refreshMock.mockRejectedValueOnce(new Error("list down"));
    render(<HomeClient />);
    fireEvent.change(screen.getByLabelText("Message the room"), { target: { value: "hi all" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await vi.waitFor(() => expect(chatMock).toHaveBeenCalledWith("ses-1", "hi all"));
    await vi.waitFor(() => expect(screen.getByLabelText("Message the room")).toHaveValue(""));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the fallback text for non-Error chat rejections", async () => {
    seedRoom("session=ses-1");
    chatMock.mockRejectedValueOnce("plain string failure");
    render(<HomeClient />);
    fireEvent.change(screen.getByLabelText("Message the room"), { target: { value: "hi all" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await vi.waitFor(() => expect(screen.getByText(/Chat failed/)).toBeDefined());
  });

  it("shows a sessions load error with retry", async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("session=ses-9"));
    presenceMock.mockReturnValue({ members: [] });
    projectsMock.mockReturnValue({ projects: [], loading: false, error: null, addProject: vi.fn() });
    sessionsMock.mockReturnValue({ sessions: [], loading: false, error: "boom", refresh: refreshMock, hydrateSession: hydrateMock });
    eventsMock.mockReturnValue({ events: [] });
    render(<HomeClient />);
    expect(screen.getByText(/Couldn't load sessions/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("resolves inspector context after deep-link hydration", async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("session=ses-9"));
    presenceMock.mockReturnValue({ members: [] });
    projectsMock.mockReturnValue({ projects: [], loading: false, error: null, addProject: vi.fn() });
    const hydrated = { sessionId: "ses-9", correlationId: "cor-9", status: "running", version: 1, task: { member: "m", prompt: "p" } };
    hydrateMock.mockResolvedValue(hydrated);
    sessionsMock.mockReturnValue({ sessions: [], loading: false, error: null, refresh: refreshMock, hydrateSession: hydrateMock });
    eventsMock.mockReturnValue({ events: [] });
    const { rerender } = render(<HomeClient />);
    await vi.waitFor(() => expect(hydrateMock).toHaveBeenCalledWith("ses-9"));
    fireEvent.click(screen.getByTestId("click-node"));
    const inspector = screen.getByTestId("inspector");
    expect(inspector.getAttribute("data-session")).toBe("");
    expect(inspector.getAttribute("data-loading")).toBe("true");
    // the hydrated row lands in the list — the inspector gets its context
    sessionsMock.mockReturnValue({ sessions: [hydrated], loading: false, error: null, refresh: refreshMock, hydrateSession: hydrateMock });
    rerender(<HomeClient />);
    await vi.waitFor(() => expect(screen.getByTestId("inspector").getAttribute("data-session")).toBe("ses-9"));
  });

  it("stops the inspector loading state when the list reports an error", () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("session=ses-9"));
    presenceMock.mockReturnValue({ members: [] });
    projectsMock.mockReturnValue({ projects: [], loading: false, error: null, addProject: vi.fn() });
    sessionsMock.mockReturnValue({ sessions: [], loading: false, error: "boom", refresh: refreshMock, hydrateSession: hydrateMock });
    eventsMock.mockReturnValue({ events: [] });
    render(<HomeClient />);
    fireEvent.click(screen.getByTestId("click-node"));
    const inspector = screen.getByTestId("inspector");
    expect(inspector.getAttribute("data-session")).toBe("");
    expect(inspector.getAttribute("data-loading")).toBe("false");
  });

  it("marks inspector context loading while the list loads", () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("session=ses-9"));
    presenceMock.mockReturnValue({ members: [] });
    projectsMock.mockReturnValue({ projects: [], loading: false, error: null, addProject: vi.fn() });
    sessionsMock.mockReturnValue({ sessions: [], loading: true, error: null, refresh: refreshMock, hydrateSession: hydrateMock });
    eventsMock.mockReturnValue({ events: [] });
    render(<HomeClient />);
    fireEvent.click(screen.getByTestId("click-node"));
    expect(screen.getByTestId("inspector").getAttribute("data-loading")).toBe("true");
  });
});
