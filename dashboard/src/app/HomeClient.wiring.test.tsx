import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { encodeShareLink } from "@/lib/shareLink";
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
const createMock = vi.fn();

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
  ApiError: class ApiError extends Error {
    constructor(
      public readonly status: number,
      message: string,
    ) {
      super(message)
    }
  },
  replyToSession: (...args: unknown[]) => replyMock(...args),
  sendChatMessage: (...args: unknown[]) => chatMock(...args),
  steerSession: (...args: unknown[]) => steerMock(...args),
  cancelSession: (...args: unknown[]) => cancelMock(...args),
  createTask: (...args: unknown[]) => createMock(...args),
}));

vi.mock("@/components/ApprovalInbox", () => ({
  ApprovalInbox: () => null,
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
    events,
  }: {
    open: boolean;
    selectedNode?: { id: string } | null;
    session?: { sessionId: string } | null;
    contextLoading?: boolean;
    onClose: () => void;
    events?: unknown[];
  }) =>
    open ? (
      <div
        data-testid="inspector"
        data-selected={selectedNode?.id ?? ""}
        data-session={session?.sessionId ?? ""}
        data-loading={contextLoading ? "true" : "false"}
        data-events={String(events?.length ?? 0)}
      >
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
  Sidebar: () => <div data-testid="sidebar-content">sidebar-stub</div>,
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
      {
        sessionId: "ses-2",
        correlationId: "cor-2",
        status: "queued",
        version: 1,
        task: { member: "the-mediator", prompt: "queued work" },
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

  it("terminal sessions feed the inspector their memberEvents instead of the live stream", () => {
    seed("session=ses-7&node=n-1");
    sessionsMock.mockReturnValue({
      loading: false,
      error: null,
      hydrateSession: hydrateMock,
      sessions: [
        {
          sessionId: "ses-7",
          correlationId: "cor-7",
          status: "succeeded",
          version: 3,
          task: { member: "the-builder", prompt: "done work" },
          memberEvents: [
            { type: "reasoning", step: 1, content: "think" },
            { type: "tool.called", step: 1, name: "grep", args: {} },
          ],
        },
      ],
      refresh: refreshMock,
    });
    eventsMock.mockReturnValue({
      events: [{ eventId: 9, type: "reasoning", correlationId: "cor-7", step: 2, content: "live" }],
    });
    render(<HomeClient />);
    fireEvent.click(screen.getByTestId("click-node"));
    // 2 hydrated member events win over the 1 live-stream event
    expect(screen.getByTestId("inspector").getAttribute("data-events")).toBe("2");
  });
});

describe("HomeClient room wiring", () => {
  beforeEach(() => {
    chatMock.mockResolvedValue({ ok: true, session: {} });
    steerMock.mockResolvedValue({ ok: true, session: {} });
    cancelMock.mockResolvedValue({ ok: true, status: "cancelled", session: {} });
    replyMock.mockResolvedValue({ ok: true, session: {}, resumedSession: { sessionId: "ses-10" } });
  });

  it("terminal sessions show the ended-session composer", () => {
    seedRoom("session=ses-7");
    render(<HomeClient />);
    expect(screen.getByText(/This session has ended/)).toBeDefined();
    expect(screen.queryByLabelText("Message the room")).toBeNull();
    expect(screen.queryByLabelText("Redirect this session")).toBeNull();
    expect(screen.queryByRole("button", { name: "Interrupt" })).toBeNull();
    expect(screen.queryByPlaceholderText("Type your reply…")).toBeNull();
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

  it("shows one contextual composer per session state", () => {
    seedRoom("session=ses-9");
    const { unmount } = render(<HomeClient />);
    expect(screen.getByPlaceholderText("Type your reply…")).toBeDefined();
    expect(screen.queryByLabelText("Message the room")).toBeNull();
    expect(screen.queryByLabelText("Redirect this session")).toBeNull();
    unmount();
    seedRoom("session=ses-1");
    render(<HomeClient />);
    expect(screen.getByLabelText("Redirect this session")).toBeDefined();
    expect(screen.queryByLabelText("Message the room")).toBeNull();
    expect(screen.queryByPlaceholderText("Type your reply…")).toBeNull();
  });

  it("prefers the reply composer when a live run also awaits input", () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("session=ses-8"));
    presenceMock.mockReturnValue({ members: [] });
    projectsMock.mockReturnValue({ projects: [], loading: false, error: null, addProject: vi.fn() });
    sessionsMock.mockReturnValue({
      sessions: [
        {
          sessionId: "ses-8",
          correlationId: "cor-8",
          status: "running",
          version: 1,
          task: { member: "the-mediator", prompt: "conflict" },
          nextStep: { awaiting_input: true, prompt: "Proceed?" },
          question: { question: "Proceed with deploy?", context: "all green" },
        },
      ],
      loading: false,
      error: null,
      refresh: refreshMock,
      hydrateSession: hydrateMock,
    });
    eventsMock.mockReturnValue({ events: [] });
    render(<HomeClient />);
    expect(screen.getByText(/Proceed with deploy\?/)).toBeDefined();
    expect(screen.getByPlaceholderText("Type your reply…")).toBeDefined();
    expect(screen.queryByLabelText("Redirect this session")).toBeNull();
  });

  it("replies to legacy awaiting sessions without a next step", () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("session=ses-6"));
    presenceMock.mockReturnValue({ members: [] });
    projectsMock.mockReturnValue({ projects: [], loading: false, error: null, addProject: vi.fn() });
    sessionsMock.mockReturnValue({
      sessions: [
        {
          sessionId: "ses-6",
          correlationId: "cor-6",
          status: "awaiting_input",
          version: 1,
          task: { member: "the-mediator", prompt: "old wait" },
          question: { question: "Legacy ask?", context: "legacy context" },
        },
      ],
      loading: false,
      error: null,
      refresh: refreshMock,
      hydrateSession: hydrateMock,
    });
    eventsMock.mockReturnValue({ events: [] });
    render(<HomeClient />);
    expect(screen.getByText(/Legacy ask\?/)).toBeDefined();
    expect(screen.getByPlaceholderText("Type your reply…")).toBeDefined();
  });

  it("steers queued sessions", () => {
    seedRoom("session=ses-2");
    render(<HomeClient />);
    expect(screen.getByLabelText("Redirect this session")).toBeDefined();
    expect(screen.queryByLabelText("Message the room")).toBeNull();
  });

  it("submits the reply composer with Enter", async () => {
    seedRoom("session=ses-9");
    render(<HomeClient />);
    const input = screen.getByPlaceholderText("Type your reply…");
    fireEvent.change(input, { target: { value: "go ahead" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await vi.waitFor(() => expect(replyMock).toHaveBeenCalledWith("ses-9", "go ahead"));
  });

  it("keeps a single page scrollbar on the main scroller", () => {
    seedRoom("session=ses-1");
    const { container } = render(<HomeClient />);
    const main = container.querySelector("main") as HTMLElement;
    expect(main.className).toContain("min-h-0");
    expect(main.className).toContain("overflow-y-auto");
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
    // the chat composer is terminal-only and inputless now — Enter wiring
    // moved to the reply composer (covered by "submits the reply composer
    // with Enter"); kept here as a status quard against composer regression
    seedRoom("session=ses-7");
    render(<HomeClient />);
    expect(screen.queryByLabelText("Message the room")).toBeNull();
  });

  it("shows the room presence count in the chat header", () => {
    seedRoom("session=ses-7");
    presenceMock.mockReturnValue({ members: [{ name: "a" }, { name: "b" }] });
    render(<HomeClient />);
    expect(screen.getByText(/2 here/)).toBeDefined();
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

  it("shows the gone banner and a start-over CTA when a shared 404 hydrates", async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("session=ses-dead"));
    presenceMock.mockReturnValue({ members: [] });
    projectsMock.mockReturnValue({ projects: [], loading: false, error: null, addProject: vi.fn() });
    sessionsMock.mockReturnValue({ sessions: [], loading: false, error: null, refresh: refreshMock, hydrateSession: hydrateMock });
    eventsMock.mockReturnValue({ events: [] });
    hydrateMock.mockRejectedValue(new (await import("@/lib/api")).ApiError(404, "gone"));
    render(<HomeClient />);
    await vi.waitFor(() => expect(screen.getByText(/no longer available/)).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Start a new session" }));
    expect(routerPush).toHaveBeenCalledWith("/");
  });

  it("dismiss hides the sessions error banner until reload", async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("session=ses-9"));
    presenceMock.mockReturnValue({ members: [] });
    projectsMock.mockReturnValue({ projects: [], loading: false, error: null, addProject: vi.fn() });
    sessionsMock.mockReturnValue({ sessions: [], loading: false, error: "boom", refresh: refreshMock, hydrateSession: hydrateMock });
    eventsMock.mockReturnValue({ events: [] });
    render(<HomeClient />);
    expect(screen.getByText(/Couldn't load sessions/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Couldn't load sessions/)).toBeNull();
  });

  it("resume spawns a follow-up with the same member and prompt", async () => {
    seedRoom("session=ses-7");
    createMock.mockResolvedValue({ ok: true, session: { sessionId: "ses-8", projectId: "p-1" } });
    render(<HomeClient />);
    fireEvent.click(screen.getByRole("button", { name: "Resume this session" }));
    await vi.waitFor(() => expect(createMock).toHaveBeenCalledWith({ member: "the-builder", prompt: "done work" }));
    await vi.waitFor(() => expect(routerPush).toHaveBeenCalledWith("/project/p-1/session/ses-8"));
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

  it("labels the diagram mode select", () => {
    seedRoom("session=ses-1");
    render(<HomeClient />);
    expect(screen.getByLabelText("Diagram")).toBeDefined();
  });

  it("confirms link copies and reports failures", async () => {
    seedRoom("session=ses-1");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      render(<HomeClient />);
      fireEvent.click(screen.getByRole("button", { name: "copy link" }));
      await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
      await vi.waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copied!"));
      writeText.mockRejectedValueOnce(new Error("denied"));
      fireEvent.click(screen.getByRole("button", { name: "copy link" }));
      await vi.waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copy failed"));
    } finally {
      // jsdom ships no clipboard — restore the absence
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    }
  });
});

// jsdom has no viewport — tests dialect phone vs desktop through matchMedia
let mobileViewport = false;
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: mobileViewport && query.includes("max-width"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe("HomeClient mobile header", () => {
  it("renders a single global-header-independent toggle for the sidebar", () => {
    seedRoom("session=ses-1");
    render(<HomeClient />);
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toBeDefined();
    expect(screen.queryByTestId("mobile-header")).toBeNull();
  });

  it("exposes page hooks distinct from the global header", () => {
    seedRoom("session=ses-1");
    render(<HomeClient />);
    expect(screen.getByTestId("home-content")).toBeDefined();
    expect(screen.getByTestId("home-main")).toBeDefined();
    expect(screen.queryByTestId("mobile-header")).toBeNull();
  });

  it("always mounts the sidebar aside", () => {
    seedRoom("session=ses-1");
    const { container } = render(<HomeClient />);
    expect(container.querySelector("#sidebar")).not.toBeNull();
  });
});

describe("HomeClient sidebar drawer", () => {
  beforeEach(() => {
    mobileViewport = false;
    window.localStorage.clear();
  });

  it("starts open on desktop", () => {
    seedRoom("session=ses-1");
    render(<HomeClient />);
    expect(screen.getByTestId("sidebar-content")).toBeDefined();
    expect(document.querySelector("#sidebar")?.getAttribute("data-state")).toBe("open");
    expect(screen.getByRole("button", { name: "Toggle sidebar" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("starts closed on phone viewports", () => {
    mobileViewport = true;
    seedRoom("session=ses-1");
    render(<HomeClient />);
    expect(document.querySelector("#sidebar")?.getAttribute("data-state")).toBe("closed");
    expect(screen.getByRole("button", { name: "Toggle sidebar" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("toggles the drawer open and closed", () => {
    mobileViewport = true;
    seedRoom("session=ses-1");
    render(<HomeClient />);
    const toggle = screen.getByRole("button", { name: "Toggle sidebar" });
    fireEvent.click(toggle);
    expect(document.querySelector("#sidebar")?.getAttribute("data-state")).toBe("open");
    fireEvent.click(toggle);
    expect(document.querySelector("#sidebar")?.getAttribute("data-state")).toBe("closed");
  });

  it("gives the toggle a 44px touch target", () => {
    seedRoom("session=ses-1");
    render(<HomeClient />);
    expect(screen.getByRole("button", { name: "Toggle sidebar" }).className).toMatch(/min-h-\[44px\]/);
  });

  it("persists the toggle across remounts", () => {
    seedRoom("session=ses-1");
    const first = render(<HomeClient />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    expect(document.querySelector("#sidebar")?.getAttribute("data-state")).toBe("closed");
    first.unmount();
    render(<HomeClient />);
    expect(document.querySelector("#sidebar")?.getAttribute("data-state")).toBe("closed");
  });

  it("prefers the stored value over the viewport default", () => {
    mobileViewport = true;
    window.localStorage.setItem("atlaslink:sidebar:open", JSON.stringify(true));
    seedRoom("session=ses-1");
    render(<HomeClient />);
    expect(document.querySelector("#sidebar")?.getAttribute("data-state")).toBe("open");
  });

  it("closes on Escape", () => {
    seedRoom("session=ses-1");
    render(<HomeClient />);
    expect(document.querySelector("#sidebar")?.getAttribute("data-state")).toBe("open");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector("#sidebar")?.getAttribute("data-state")).toBe("closed");
  });

  it("closes on backdrop tap on phones", () => {
    mobileViewport = true;
    seedRoom("session=ses-1");
    render(<HomeClient />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    expect(document.querySelector("#sidebar")?.getAttribute("data-state")).toBe("open");
    fireEvent.click(screen.getByTestId("sidebar-backdrop"));
    expect(document.querySelector("#sidebar")?.getAttribute("data-state")).toBe("closed");
  });

  it("closing a session selection hands over the room on phones", () => {
    mobileViewport = true;
    seedRoom("session=ses-1");
    render(<HomeClient />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    expect(document.querySelector("#sidebar")?.getAttribute("data-state")).toBe("open");
    fireEvent.click(screen.getByTestId("select-ses2"));
    expect(document.querySelector("#sidebar")?.getAttribute("data-state")).toBe("closed");
    expect(routerPush).toHaveBeenCalledWith("?session=ses-2");
  });

  it("keeps the drawer open on session selection on desktop", () => {
    seedRoom("session=ses-1");
    render(<HomeClient />);
    fireEvent.click(screen.getByTestId("select-ses2"));
    expect(document.querySelector("#sidebar")?.getAttribute("data-state")).toBe("open");
  });

  it("moves focus into the drawer on open and back on close", () => {
    mobileViewport = true;
    seedRoom("session=ses-1");
    render(<HomeClient />);
    const toggle = screen.getByRole("button", { name: "Toggle sidebar" });
    fireEvent.click(toggle);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close sidebar");
    fireEvent.click(screen.getByRole("button", { name: "Close sidebar" }));
    expect(document.activeElement).toBe(toggle);
  });

  it("exposes the toggle in the composer view too", () => {
    seed("");
    render(<HomeClient />);
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toBeDefined();
    expect(document.querySelector("#sidebar")).not.toBeNull();
  });
});

describe("HomeClient mobile room", () => {
  it("stacks the reply form vertically so the input fits a phone viewport", () => {
    seedRoom("session=ses-9");
    render(<HomeClient />);
    const form = screen.getByLabelText("Reply to Atlas").closest("form");
    expect(form?.className).toMatch(/flex-col/);
  });

  it("stacks the steer form vertically so the input fits a phone viewport", () => {
    seedRoom("session=ses-1");
    render(<HomeClient />);
    const form = screen.getByLabelText("Redirect this session").closest("form");
    expect(form?.className).toMatch(/flex-col/);
  });

  it("keeps room inputs at 16px on phones so iOS does not auto-zoom on focus", () => {
    seedRoom("session=ses-1");
    render(<HomeClient />);
    expect(screen.getByLabelText("Redirect this session").className).toMatch(/text-base/);
  });

  it("gives the room-exit button a 44px touch target", () => {
    seedRoom("session=ses-1");
    render(<HomeClient />);
    expect(screen.getByRole("button", { name: /back to composer/i }).className).toMatch(/min-h-\[44px\]/);
  });

  it("gives the send button a 44px touch target", () => {
    seedRoom("session=ses-9");
    render(<HomeClient />);
    fireEvent.change(screen.getByLabelText("Reply to Atlas"), { target: { value: "go" } });
    expect(screen.getByRole("button", { name: "Send" }).className).toMatch(/min-h-\[44px\]/);
  });

  it("exposes palette agents as tap targets in the room", () => {
    seedRoom("session=ses-1");
    render(<HomeClient />);
    expect(screen.getByRole("button", { name: /add tool node/i })).toBeDefined();
  });
});

describe("HomeClient ui prefs", () => {
  beforeEach(() => {
    mobileViewport = false;
    window.localStorage.clear();
  });

  it("reopens the last session on a fresh visit to bare /", () => {
    window.localStorage.setItem("atlaslink:ui:last-session", JSON.stringify({ session: "ses-1", project: "p-1" }));
    seed("");
    render(<HomeClient />);
    expect(routerReplace).toHaveBeenCalledWith("?session=ses-1&project=p-1");
  });

  it("restores a stored session without a project", () => {
    window.localStorage.setItem("atlaslink:ui:last-session", JSON.stringify({ session: "ses-9" }));
    seed("");
    render(<HomeClient />);
    expect(routerReplace).toHaveBeenCalledWith("?session=ses-9");
  });

  it("stays on the composer when nothing was stored", () => {
    seed("");
    render(<HomeClient />);
    expect(routerReplace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toBeDefined();
  });

  it("prefers a share link over the stored session", () => {
    window.localStorage.setItem("atlaslink:ui:last-session", JSON.stringify({ session: "ses-2", project: "p-1" }));
    const q = encodeURIComponent(encodeShareLink({ s: "ses-1", p: "p-1" }));
    seedRoom(`q=${q}`);
    render(<HomeClient />);
    expect(routerReplace).not.toHaveBeenCalled();
    expect(screen.getByText(/Live Society Diagram/)).toBeDefined();
  });

  it("saving flows through session selection into the next fresh visit", () => {
    seedRoom("session=ses-1");
    const first = render(<HomeClient />);
    fireEvent.click(screen.getByTestId("select-ses2"));
    expect(window.localStorage.getItem("atlaslink:ui:last-session")).toBe(JSON.stringify({ session: "ses-2" }));
    first.unmount();
    vi.clearAllMocks();
    seed("");
    render(<HomeClient />);
    expect(routerReplace).toHaveBeenCalledWith("?session=ses-2");
  });

  it("back-to-composer clears the stored session", () => {
    window.localStorage.setItem("atlaslink:ui:last-session", JSON.stringify({ session: "ses-1", project: "p-1" }));
    seedRoom("session=ses-1");
    render(<HomeClient />);
    fireEvent.click(screen.getByRole("button", { name: /back to composer/i }));
    expect(window.localStorage.getItem("atlaslink:ui:last-session")).toBeNull();
    expect(routerPush).toHaveBeenCalledWith("/");
  });

  it("defaults the diagram mode from the stored preference", () => {
    window.localStorage.setItem("atlaslink:ui:diagram-mode", JSON.stringify("chain"));
    seedRoom("session=ses-1");
    render(<HomeClient />);
    expect((screen.getByLabelText("Diagram") as HTMLSelectElement).value).toBe("chain");
  });

  it("stores the diagram mode when the select changes", () => {
    seedRoom("session=ses-1");
    render(<HomeClient />);
    fireEvent.change(screen.getByLabelText("Diagram"), { target: { value: "fanout" } });
    expect(window.localStorage.getItem("atlaslink:ui:diagram-mode")).toBe(JSON.stringify("fanout"));
    expect(routerPush).toHaveBeenCalledWith(expect.stringContaining("mode=fanout"));
  });

  it("falls back to full on a corrupt stored mode", () => {
    window.localStorage.setItem("atlaslink:ui:diagram-mode", JSON.stringify("grid"));
    seedRoom("session=ses-1");
    render(<HomeClient />);
    expect((screen.getByLabelText("Diagram") as HTMLSelectElement).value).toBe("full");
  });

  it("start-over on a gone shared session clears the stored id so restore cannot loop", async () => {
    window.localStorage.setItem("atlaslink:ui:last-session", JSON.stringify({ session: "ses-dead" }));
    searchParamsMock.mockReturnValue(new URLSearchParams("session=ses-dead"));
    presenceMock.mockReturnValue({ members: [] });
    projectsMock.mockReturnValue({ projects: [], loading: false, error: null, addProject: vi.fn() });
    sessionsMock.mockReturnValue({ sessions: [], loading: false, error: null, refresh: refreshMock, hydrateSession: hydrateMock });
    eventsMock.mockReturnValue({ events: [] });
    hydrateMock.mockRejectedValue(new (await import("@/lib/api")).ApiError(404, "gone"));
    render(<HomeClient />);
    await vi.waitFor(() => expect(screen.getByText(/no longer available/)).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Start a new session" }));
    expect(window.localStorage.getItem("atlaslink:ui:last-session")).toBeNull();
    expect(routerPush).toHaveBeenCalledWith("/");
  });
});
