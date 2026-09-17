"use client";

import { Suspense, useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { SessionComposer } from "@/components/SessionComposer";
import { NodePalette } from "@/components/NodePalette";
import { SocietyDiagram } from "@/components/SocietyDiagram";
import { SessionList } from "@/components/SessionList";
import { SessionInspector } from "@/components/SessionInspector";
import { SessionThread } from "@/components/SessionThread";
import { ApprovalInbox } from "@/components/ApprovalInbox";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useProjects } from "@/hooks/useProjects";
import { useSessions } from "@/hooks/useSessions";
import { useDraftFlow } from "@/hooks/useDraftFlow";
import type { AgentConfig } from "@/lib/config";
import { useEvents } from "@/hooks/useEvents";
import { decodeShareLink, encodeShareLink, canonicalUrl } from "@/lib/shareLink";
import { hasStoredSidebarOpen, loadSidebarOpen, saveSidebarOpen } from "@/lib/sidebarState";
import { clearLastSession, isDiagramMode, loadDiagramMode, loadLastSession, saveDiagramMode, saveLastSession } from "@/lib/uiPrefs";
import { replyToSession, steerSession, cancelSession, createTask, ApiError } from "@/lib/api";
import { useRoomPresence } from "@/hooks/useRoomPresence";
import { useDeliveryReceipts } from "@/hooks/useDeliveryReceipts";
import type { GraphMode } from "@/lib/graph";
import type { BridgeEvent } from "@/lib/types";

// Typing heartbeats older than this drop out of the indicator.
const TYPING_FRESH_MS = 6000;

// Phones (<md) get the sidebar as an overlay drawer; matchMedia keeps the
// check mockable in jsdom, which has no viewport of its own.
function isPhoneViewport(): boolean {  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 767px)").matches
    );
  } catch {
    return false;
  }
}

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawSession = searchParams.get("session");
  const rawProject = searchParams.get("project");
  const rawQ = searchParams.get("q");
  const decoded = rawQ ? decodeShareLink(rawQ) : null;
  const selectedSessionId = rawSession ?? decoded?.s ?? undefined;
  const selectedProjectId = rawProject ?? decoded?.p ?? undefined;
  const selectedNodeId = searchParams.get("node") ?? decoded?.n ?? undefined;
  const rawMode = (searchParams.get("mode") ?? (decoded?.m as string) ?? loadDiagramMode("full")) as GraphMode;
  const mode: GraphMode = (["chain", "fanout", "full"].includes(rawMode) ? rawMode : "full") as GraphMode;
  const { projects, loading: projectsLoading, error: projectsError, addProject, ensureInbox } = useProjects();
  const { sessions, loading: sessionsLoading, error: sessionsError, refresh: refreshSessions, hydrateSession } = useSessions();
  const { events, sessionTyping = [] } = useEvents();
  const { members } = useRoomPresence(selectedSessionId);
  // Composer drafts are per-session overlay state — empty until the user
  // drops the first palette agent, so the live diagram renders untouched.
  const drafts = useDraftFlow(selectedSessionId ?? "");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyTimer = useRef<number | null>(null);
  // Sidebar drawer: open on desktop, closed on phones unless the user chose
  // otherwise. The phone default adjusts during render (React's "adjust
  // state during render" pattern, same as the thread's session reset) so the
  // committed output never flashes the desktop default on small screens.
  const [sidebarOpen, setSidebarOpen] = useState(() => loadSidebarOpen(true));
  const [phoneDefaultApplied, setPhoneDefaultApplied] = useState(false);
  if (!phoneDefaultApplied && !hasStoredSidebarOpen() && isPhoneViewport()) {
    setPhoneDefaultApplied(true);
    setSidebarOpen(false);
  }
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // the composer requires a project — a tenant with none gets its inbox on load
  useEffect(() => {
    if (!projectsLoading) void ensureInbox();
  }, [projectsLoading, ensureInbox]);
  useEffect(() => {
    saveSidebarOpen(sidebarOpen);
  }, [sidebarOpen]);
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSidebarOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);
  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
    toggleRef.current?.focus();
  }, []);
  const renderSidebarToggle = () => (
    <button
      ref={toggleRef}
      type="button"
      aria-label="Toggle sidebar"
      aria-expanded={sidebarOpen}
      aria-controls="sidebar"
      onClick={() => {
        const next = !sidebarOpen;
        setSidebarOpen(next);
        if (next) closeRef.current?.focus();
      }}
      className="inline-flex min-h-[44px] items-center rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-foreground hover:bg-raised/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors"
    >
      ☰
    </button>
  );

  const [inspectorNode, setInspectorNode] = useState<{ id: string; type: string; data: unknown } | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [steerContent, setSteerContent] = useState("");
  const [steerBusy, setSteerBusy] = useState(false);
  const [steerError, setSteerError] = useState<string | null>(null);

  const selectedSession = useMemo(() => sessions.find((s) => s.sessionId === selectedSessionId) ?? null, [sessions, selectedSessionId]);
  // Terminal sessions replay the durable memberEvents instead of the live
  // stream — past/failed runs must fill the inspector without an SSE replay;
  // non-terminal sessions keep the live feed exactly as before.
  const mergedEvents = useMemo<BridgeEvent[]>(() => {
    const s = selectedSession;
    const terminal = s !== null && (s.status === "succeeded" || s.status === "failed" || s.status === "cancelled");
    if (!terminal || !s.memberEvents || s.memberEvents.length === 0) return events;
    return s.memberEvents.map(
      (payload) =>
        ({
          ...payload,
          eventId: -1,
          type: typeof payload.type === "string" ? payload.type : "unknown",
          correlationId: s.correlationId,
          sessionId: s.sessionId,
        }) as BridgeEvent,
    );
  }, [selectedSession, events]);
  // Per-turn delivery ticks: tracks this tab's sends and correlates them
  // against the live SSE echoes (see useDeliveryReceipts).
  const { trackSend, settleSend, assign } = useDeliveryReceipts(mergedEvents);
  // Typing indicators (display-only — this client never publishes): fresh
  // heartbeats for the selected session, latest state per name wins. Render
  // stays pure: "now" is derived from the newest heartbeat until a timer
  // advances the clock state, and timers re-arm through clockNow so entries
  // drop out without any synchronous setState-in-effect.
  const [clockNow, setClockNow] = useState<number | null>(null);
  const typingNames = useMemo(() => {
    if (!selectedSessionId) return [];
    const latest = new Map<string, { typing: boolean; at: number }>();
    for (const t of sessionTyping) {
      if (t.sessionId !== selectedSessionId) continue;
      latest.set(t.name, { typing: t.typing, at: t.at });
    }
    const newest = [...latest.values()].reduce((m, s) => Math.max(m, s.at), 0);
    const now = clockNow ?? newest;
    return [...latest]
      .filter(([, s]) => s.typing && now - s.at < TYPING_FRESH_MS)
      .map(([name]) => name)
      .sort();
  }, [sessionTyping, selectedSessionId, clockNow]);
  useEffect(() => {
    if (!selectedSessionId) return;
    if (clockNow === null) {
      // seed the wall clock without a synchronous setState-in-effect — the
      // pre-seed paint derives "now" from the newest heartbeat instead
      const seed = window.setTimeout(() => setClockNow(Date.now()), 0);
      return () => window.clearTimeout(seed);
    }
    const remaining = sessionTyping
      .filter((t) => t.sessionId === selectedSessionId && t.typing)
      .map((t) => TYPING_FRESH_MS - (clockNow - t.at))
      .filter((ms) => ms > 0);
    if (remaining.length === 0) return;
    const timer = window.setTimeout(() => setClockNow(Date.now()), Math.min(...remaining));
    return () => window.clearTimeout(timer);
  }, [sessionTyping, selectedSessionId, clockNow]);
  // The inspector fallback must be transient-only: still resolving means the
  // list is loading or an unresolved deep link has no error yet — a reported
  // error means resolution failed and the fallback applies.
  const inspectorContextLoading = sessionsLoading || (!!selectedSessionId && !selectedSession && !sessionsError);
  const isSteerable = selectedSession?.status === "queued" || selectedSession?.status === "running";
  // One contextual composer, reply > steer > chat: the awaiting question
  // accepts the reply, a live run accepts a steer, anything else chats.
  const awaitingQuestion = selectedSession?.nextStep?.awaiting_input || selectedSession?.status === "awaiting_input"
    ? { prompt: selectedSession.question?.question ?? selectedSession.nextStep?.prompt ?? "Awaiting input", context: selectedSession.question?.context }
    : null;
  const composerMode = awaitingQuestion ? "reply" : isSteerable ? "steer" : "chat";

  // Deep-link hydration: a shared ?session= id may sit beyond the one-shot
  // list page, so fetch the single row instead of leaving context empty.
  // hydrateSession records failures in the sessions error state, which the
  // banner below renders while no session is selected.
  // A 404 means the shared id no longer exists (Render's ephemeral disk
  // wipes SQLite on every restart) — the page must say so once instead of
  // letting hydrate failures bounce generic reload hints forever.
  const [dismissedSessionsError, setDismissedSessionsError] = useState(false);
  const [sharedSessionGoneId, setSharedSessionGoneId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedSessionId || selectedSession || sessionsLoading) return;
    hydrateSession(selectedSessionId).catch((err) => {
      // hydrateSession records non-404 failures in the sessions error state;
      // a 404 here means the shared id no longer exists
      if (err instanceof ApiError && err.status === 404) setSharedSessionGoneId(selectedSessionId);
    });
  }, [selectedSessionId, selectedSession, sessionsLoading, hydrateSession]);
  const sharedSessionGone = sharedSessionGoneId !== null && sharedSessionGoneId === selectedSessionId;

  // Fresh visits to bare `/` reopen the last session instead of stranding a
  // returning user at the composer — explicit back-to-composer clears the
  // stored id first (so no restore loop), and share links win over the
  // stored default. replace keeps the restore out of back-button history.
  useEffect(() => {
    if (selectedSessionId || rawQ || searchParams.get("node")) return;
    const last = loadLastSession();
    if (!last) return;
    router.replace(last.project ? `?session=${last.session}&project=${last.project}` : `?session=${last.session}`);
  }, [selectedSessionId, rawQ, searchParams, router]);

  const handleSelectSession = useCallback(
    (id: string) => {
      const projectOfSession = sessions.find((s) => s.sessionId === id)?.projectId;
      const params = new URLSearchParams(searchParams.toString());
      params.set("session", id);
      if (projectOfSession) params.set("project", projectOfSession);
      params.delete("q");
      // The inspector shows another session's node payload otherwise.
      params.delete("node");
      router.push(`?${params.toString()}`);
      setInspectorNode(null);
      saveLastSession(id, projectOfSession);
      // On phones the drawer hands over the room on selection.
      if (isPhoneViewport()) setSidebarOpen(false);
    },
    [router, searchParams, sessions]
  );

  const handleCloseSession = useCallback(() => {
    clearLastSession();
    const params = new URLSearchParams(searchParams.toString());
    params.delete("session");
    params.delete("project");
    params.delete("node");
    params.delete("q");
    const qs = params.toString();
    router.push(qs ? `?${qs}` : "/");
    setInspectorNode(null);
  }, [router, searchParams]);

  const handleNodeConfigChange = useCallback((nodeId: string, config: AgentConfig) => {
    drafts.updateNodeConfig(nodeId, config);
  }, [drafts]);

  // Touch fallback for the palette: phones have no drag-and-drop, so a tap
  // drops the agent at a cascade offset through the same draft path as a
  // drop — the user drags it into place on the canvas afterwards.
  const handleAddAgent = useCallback((agentType: string) => {
    const slot = drafts.draftNodes.length % 8;
    drafts.addDraftNode(agentType, { x: 48 * slot, y: 48 * slot });
  }, [drafts]);

  const handleNodeClick = useCallback(
    (id: string, type: string, data: unknown) => {
      setInspectorNode({ id, type, data });
      const params = new URLSearchParams(searchParams.toString());
      params.set("node", id);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const handleCloseInspector = useCallback(() => {
    setInspectorNode(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("node");
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  // Copy feedback: clipboard denial (permissions, insecure context) surfaces
  // as Copy failed instead of a silent no-op.
  const handleCopyLink = useCallback(async () => {
    if (!selectedSessionId) return;
    const share = selectedProjectId ? canonicalUrl(selectedProjectId, selectedSessionId) : `?session=${selectedSessionId}`;
    const q = encodeShareLink({ p: selectedProjectId, s: selectedSessionId, n: selectedNodeId ?? undefined, m: mode });
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${share} or ${window.location.origin}/?q=${q}`);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyState("idle"), 2000);
  }, [selectedProjectId, selectedSessionId, selectedNodeId, mode]);

  useEffect(() => () => {
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
  }, []);

  const sendReply = useCallback(async (content: string) => {
    if (!selectedSessionId || !content.trim()) return;
    const trimmed = content.trim();
    const receiptKey = trackSend(selectedSessionId, trimmed);
    setReplyBusy(true);
    setReplyError(null);
    try {
      const res = await replyToSession(selectedSessionId, trimmed);
      settleSend(receiptKey, true);
      setReplyContent("");
      // the parked original keeps its state server-side, but the list holds a
      // stale copy until refetch — refresh before following the follow-up
      await refreshSessions();
      // linked-session resume: follow the follow-up, the parked original stays behind
      if (res?.resumedSession?.sessionId) handleSelectSession(res.resumedSession.sessionId);
    } catch (e) {
      settleSend(receiptKey, false);
      setReplyError(e instanceof Error ? e.message : "Reply failed — retry or check the session state.");
    } finally {
      setReplyBusy(false);
    }
  }, [selectedSessionId, handleSelectSession, refreshSessions, trackSend, settleSend]);

  const handleReply = useCallback(() => {
    void sendReply(replyContent);
  }, [sendReply, replyContent]);

  const handleSteer = useCallback(async () => {
    if (!selectedSessionId || !steerContent.trim()) return;
    const trimmed = steerContent.trim();
    const receiptKey = trackSend(selectedSessionId, trimmed);
    setSteerBusy(true);
    setSteerError(null);
    try {
      await steerSession(selectedSessionId, trimmed);
      settleSend(receiptKey, true);
      setSteerContent("");
      await refreshSessions();
    } catch (e) {
      settleSend(receiptKey, false);
      setSteerError(e instanceof Error ? e.message : "Steer failed — retry or check the session state.");
    } finally {
      setSteerBusy(false);
    }
  }, [selectedSessionId, steerContent, refreshSessions, trackSend, settleSend]);

  const handleInterrupt = useCallback(async () => {
    if (!selectedSessionId) return;
    setSteerBusy(true);
    setSteerError(null);
    try {
      await cancelSession(selectedSessionId);
      await refreshSessions();
    } catch (e) {
      setSteerError(e instanceof Error ? e.message : "Interrupt failed — retry or check the session state.");
    } finally {
      setSteerBusy(false);
    }
  }, [selectedSessionId, refreshSessions]);

  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  // Spin up a follow-up carrying the same member/prompt/project/provider
  // instead of making pasted-prompt surgery on a terminal corpse.
  const handleResume = useCallback(async () => {
    if (!selectedSession) return;
    setResumeBusy(true);
    setResumeError(null);
    try {
      const res = await createTask({
        member: selectedSession.task.member,
        prompt: selectedSession.task.prompt,
        ...(selectedSession.projectId !== undefined ? { projectId: selectedSession.projectId } : {}),
        ...(selectedSession.tweaks !== undefined ? { tweaks: selectedSession.tweaks } : {}),
      });
      router.push(res.session.projectId ? canonicalUrl(res.session.projectId, res.session.sessionId) : `/`);
      await refreshSessions();
    } catch (e) {
      setResumeError(e instanceof Error ? e.message : "Could not resume — start a new session instead.");
    } finally {
      setResumeBusy(false);
    }
  }, [selectedSession, router, refreshSessions]);

  return (
    <div className="flex min-h-[60vh] flex-1 overflow-hidden" data-testid="home-content">
      <aside
        id="sidebar"
        data-state={sidebarOpen ? "open" : "closed"}
        className={`fixed md:static inset-y-0 left-0 z-40 flex w-64 max-w-[85vw] shrink-0 flex-col border-r border-line bg-surface overflow-hidden transition-[transform,width] ${
          sidebarOpen ? "translate-x-0 md:w-64" : "-translate-x-full md:translate-x-0 md:w-0 md:border-0"
        }`}
        aria-label="Sidebar"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={closeSidebar}
          aria-label="Close sidebar"
          className="inline-flex min-h-[44px] items-center justify-end px-4 py-1.5 text-sm text-muted hover:text-foreground md:hidden"
        >
          ✕
        </button>
        <ErrorBoundary>
          <Sidebar
            projects={projects}
            projectsLoading={projectsLoading}
            projectsError={projectsError}
            onCreateProject={addProject}
            selectedSessionId={selectedSessionId}
            onSelectSession={handleSelectSession}
          />
        </ErrorBoundary>
      </aside>
      {sidebarOpen && (
        <button
          type="button"
          onClick={closeSidebar}
          aria-label="Dismiss sidebar"
          data-testid="sidebar-backdrop"
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      )}
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden" data-testid="home-main">
        {selectedSessionId ? (
          <div className="mx-auto max-w-6xl px-4 sm:px-8 py-4 sm:py-12">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {renderSidebarToggle()}
              <button
                type="button"
                onClick={handleCloseSession}
      className="inline-flex min-h-[44px] items-center rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-foreground hover:bg-raised/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors md:hidden"
              >
                ← Back to composer
              </button>
              <span className="rounded bg-line px-2 py-1 font-mono text-xs text-muted">{selectedSessionId.slice(0, 20)}…</span>
              {(() => {
                const tweakProvider = selectedSession?.tweaks?.provider;
                const tweakModel = (selectedSession?.tweaks?.member as Record<string, unknown> | undefined)?.model;
                return typeof tweakProvider === "string" && tweakProvider.length > 0 ? (
                  <span data-testid="session-provider-badge" className="rounded bg-line px-2 py-1 text-xs text-muted">
                    {tweakProvider}
                    {typeof tweakModel === "string" && tweakModel.length > 0 ? ` · ${tweakModel}` : ""}
                  </span>
                ) : null;
              })()}
              <label htmlFor="diagram-mode" className="text-xs text-muted">Diagram</label>
              <select
                id="diagram-mode"
                value={mode}
                onChange={(e) => {
                  const p = new URLSearchParams(searchParams.toString());
                  p.set("mode", e.target.value);
                  if (isDiagramMode(e.target.value)) saveDiagramMode(e.target.value);
                  router.push(`?${p.toString()}`);
                }}
                className="rounded border border-line bg-raised px-2 py-1 text-xs text-foreground"
              >
                <option value="chain">chain</option>
                <option value="fanout">fanout</option>
                <option value="full">full DAG</option>
              </select>
              <button
                onClick={() => void handleCopyLink()}
                className="rounded bg-accent px-2 py-1 text-xs text-background hover:bg-accent/80"
              >
                copy link
              </button>
              <span role="status" aria-live="polite" className="text-xs text-muted">
                {copyState === "copied" ? "Copied!" : copyState === "failed" ? "Copy failed" : ""}
              </span>
              {selectedProjectId && <span className="text-xs text-muted">project {selectedProjectId.slice(0, 8)}…</span>}
            </div>
            <header className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground" style={{ fontFamily: "var(--font-display)" }}>The room, live.</h1>
              <p className="mt-2 text-sm leading-6 text-muted">The session as a live diagram — reasoning, tools, decisions, all on the record. Click any card to inspect. {selectedSession?.status === "awaiting_input" ? "Atlas is awaiting your input — reply below." : ""}</p>
            </header>
            {sharedSessionGone ? (
              <div role="alert" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-gold/40 bg-gold/10 p-4 text-sm text-gold">
                <span>That room is gone — demo storage resets when the backend restarts. Start fresh and invite the room back.</span>
                <button type="button" onClick={handleCloseSession} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background transition-opacity hover:opacity-90">Start a new session</button>
              </div>
            ) : sessionsError && !selectedSession && !dismissedSessionsError ? (
              <div role="alert" className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                <span className="flex flex-wrap items-center gap-2">
                  {sessionsError.includes("Server is starting") ? "Backend is waking — retrying automatically…" : `Couldn't load sessions (${sessionsError}).`}
                </span>
                <button type="button" onClick={() => void refreshSessions()} className="underline hover:text-danger">Retry</button>
                <button type="button" onClick={() => setDismissedSessionsError(true)} className="ml-2 underline hover:text-green-400">Dismiss</button>
              </div>
            ) : null}
            <div className="space-y-6">
              <ErrorBoundary>
                <NodePalette onSelect={handleAddAgent} />
                <SocietyDiagram
                  selectedSessionId={selectedSessionId}
                  mode={mode}
                  onNodeClick={handleNodeClick}
                  selectedNodeId={selectedNodeId}
                  draftNodes={drafts.draftNodes}
                  draftEdges={drafts.draftEdges}
                  onDraftDrop={drafts.addDraftNode}
                  onDraftConnect={drafts.connectDraft}
                  onDraftNodesChange={drafts.applyDraftChanges}
                />
              </ErrorBoundary>
              <ApprovalInbox onSelect={handleSelectSession} />
              {typingNames.length > 0 ? (
                <div role="status" aria-live="polite" data-testid="typing-indicator" className="text-xs text-muted">
                  {typingNames.length === 1
                    ? `${typingNames[0]} is typing…`
                    : `${typingNames.join(", ")} are typing…`}
                </div>
              ) : null}
              <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                <SessionList onSelect={handleSelectSession} />
                <SessionThread session={selectedSession} events={mergedEvents} members={members} onJump={(id) => handleNodeClick(id, "thread", {})} assignReceipts={selectedSession ? (turns) => assign(selectedSession.sessionId, selectedSession.correlationId, turns) : undefined} />
              </div>
              {composerMode === "reply" && awaitingQuestion ? (
                <div className="rounded-xl border border-accent/30 bg-accent/10 p-4">
                  <div className="text-sm font-medium text-accent">Atlas asks · {awaitingQuestion.prompt}</div>
                  {awaitingQuestion.context ? (
                    <div className="mt-1 text-xs text-muted">{awaitingQuestion.context}</div>
                  ) : null}
                  <form onSubmit={(e) => { e.preventDefault(); handleReply(); }} className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input value={replyContent} onChange={(e) => setReplyContent(e.target.value)} placeholder="Type your reply…" aria-label="Reply to Atlas" className="flex-1 rounded border border-line bg-surface px-3 py-2 text-base text-foreground placeholder:text-muted sm:text-sm" />
                    <button type="submit" disabled={replyBusy || !replyContent.trim()} className="min-h-[44px] rounded bg-accent px-4 py-2 text-sm text-background disabled:opacity-50">Send</button>
                  </form>
                  {replyError ? <div role="alert" className="mt-2 text-xs text-danger">{replyError}</div> : null}
                </div>
              ) : null}
              {composerMode === "steer" ? (
                <div className="rounded-xl border border-line bg-surface p-4">
                  <div className="text-sm font-medium text-foreground">Steer {selectedSession?.status === "running" ? "· interrupts the live run first" : "· rewrites the queued prompt"}</div>
                  <form onSubmit={(e) => { e.preventDefault(); void handleSteer(); }} className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input value={steerContent} onChange={(e) => setSteerContent(e.target.value)} placeholder="Redirect this session…" aria-label="Redirect this session" className="flex-1 rounded border border-line bg-raised px-3 py-2 text-base text-foreground placeholder:text-muted sm:text-sm" />
                    <button type="submit" disabled={steerBusy || !steerContent.trim()} className="min-h-[44px] rounded bg-accent px-4 py-2 text-sm text-background disabled:opacity-50">Steer</button>
                    <button type="button" onClick={handleInterrupt} disabled={steerBusy} className="min-h-[44px] rounded border border-danger/40 px-4 py-2 text-sm text-danger disabled:opacity-50">Interrupt</button>
                  </form>
                  {steerError ? <div role="alert" className="mt-2 text-xs text-danger">{steerError}</div> : null}
                </div>
              ) : null}
              {composerMode === "chat" ? (
                <div className="rounded-xl border border-line bg-surface p-4">
                  <div className="text-sm font-medium text-foreground">Room chat · visible to everyone here{members.length > 0 ? ` · ${members.length} here` : ""}</div>
                  {/* chat mode = terminal session; the daemon rejects every
                      append with 409, so the composer offers a next step
                      instead of a type-then-fail loop */}
                  <div className="mt-3 text-sm text-muted">
                    This session has ended
                    {selectedSession ? ` (${selectedSession.status})` : ""}. Resume it with the same member and
                    prompt, or start a new session to continue the conversation.
                  </div>
                  <button type="button" onClick={() => void handleResume()} disabled={resumeBusy || !selectedSession} className="mt-3 min-h-[44px] rounded bg-accent px-4 py-2 text-sm text-background disabled:opacity-50">
                    {resumeBusy ? "Resuming…" : "Resume this session"}
                  </button>
                  {resumeError ? <div role="alert" className="mt-2 text-xs text-danger">{resumeError}</div> : null}
                </div>
              ) : null}
            </div>
            <SessionInspector open={Boolean(inspectorNode)} onClose={handleCloseInspector} session={selectedSession} events={mergedEvents} selectedNode={inspectorNode} contextLoading={inspectorContextLoading} onConfigChange={handleNodeConfigChange} />
          </div>
        ) : (
          <div className="px-4 pt-4 sm:px-8 sm:pt-8">
            <div className="mx-auto max-w-2xl">
              {renderSidebarToggle()}
            </div>
            <ErrorBoundary>
              <SessionComposer projects={projects} onCreateSession={handleSelectSession} />
            </ErrorBoundary>
          </div>
        )}
      </main>
      </div>
  );
}

export default function HomeClient() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted">Loading…</div>}>
      <HomeInner />
    </Suspense>
  );
}
