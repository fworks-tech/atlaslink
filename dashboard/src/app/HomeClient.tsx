"use client";

import { Suspense, useState, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { SessionComposer } from "@/components/SessionComposer";
import { SocietyDiagram } from "@/components/SocietyDiagram";
import { SessionList } from "@/components/SessionList";
import { SessionInspector } from "@/components/SessionInspector";
import { SessionThread } from "@/components/SessionThread";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useProjects } from "@/hooks/useProjects";
import { useSessions } from "@/hooks/useSessions";
import { useEvents } from "@/hooks/useEvents";
import { decodeShareLink, encodeShareLink, canonicalUrl } from "@/lib/shareLink";
import { replyToSession, sendChatMessage, steerSession, cancelSession } from "@/lib/api";
import { useRoomPresence } from "@/hooks/useRoomPresence";
import type { GraphMode } from "@/lib/graph";

const hideSidebarTemporarily = true; // TODO: remove this once the sidebar is ready for production

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
  const rawMode = (searchParams.get("mode") ?? (decoded?.m as string) ?? "full") as GraphMode;
  const mode: GraphMode = (["chain", "fanout", "full"].includes(rawMode) ? rawMode : "full") as GraphMode;
  const { projects, loading: projectsLoading, error: projectsError, addProject } = useProjects();
  const { sessions, refresh: refreshSessions } = useSessions();
  const { events } = useEvents();
  const { members } = useRoomPresence(selectedSessionId);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [inspectorNode, setInspectorNode] = useState<{ id: string; type: string; data: unknown } | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [chatContent, setChatContent] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [steerContent, setSteerContent] = useState("");
  const [steerBusy, setSteerBusy] = useState(false);
  const [steerError, setSteerError] = useState<string | null>(null);

  const selectedSession = useMemo(() => sessions.find((s) => s.sessionId === selectedSessionId) ?? null, [sessions, selectedSessionId]);
  const isTerminal = selectedSession?.status === "succeeded" || selectedSession?.status === "failed" || selectedSession?.status === "cancelled";
  const isSteerable = selectedSession?.status === "queued" || selectedSession?.status === "running";

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
      setMobileSidebarOpen(false);
    },
    [router, searchParams, sessions]
  );

  const handleCloseSession = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("session");
    params.delete("project");
    params.delete("node");
    params.delete("q");
    const qs = params.toString();
    router.push(qs ? `?${qs}` : "/");
    setInspectorNode(null);
  }, [router, searchParams]);

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

  const sendReply = useCallback(async (content: string) => {
    if (!selectedSessionId || !content.trim()) return;
    setReplyBusy(true);
    setReplyError(null);
    try {
      const res = await replyToSession(selectedSessionId, content.trim());
      setReplyContent("");
      // the parked original keeps its state server-side, but the list holds a
      // stale copy until refetch — refresh before following the follow-up
      await refreshSessions();
      // linked-session resume: follow the follow-up, the parked original stays behind
      if (res?.resumedSession?.sessionId) handleSelectSession(res.resumedSession.sessionId);
    } catch (e) {
      setReplyError(e instanceof Error ? e.message : "Reply failed — retry or check the session state.");
    } finally {
      setReplyBusy(false);
    }
  }, [selectedSessionId, handleSelectSession, refreshSessions]);

  const handleReply = useCallback(() => {
    void sendReply(replyContent);
  }, [sendReply, replyContent]);

  const handleChat = useCallback(async () => {
    if (!selectedSessionId || !chatContent.trim()) return;
    setChatBusy(true);
    setChatError(null);
    try {
      await sendChatMessage(selectedSessionId, chatContent.trim());
      setChatContent("");
      // the turn lands in the thread via the session.message SSE event; the
      // refresh keeps the list copy (version) from going stale
      await refreshSessions();
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Chat failed — retry or check the session state.");
    } finally {
      setChatBusy(false);
    }
  }, [selectedSessionId, chatContent, refreshSessions]);

  const handleSteer = useCallback(async () => {
    if (!selectedSessionId || !steerContent.trim()) return;
    setSteerBusy(true);
    setSteerError(null);
    try {
      await steerSession(selectedSessionId, steerContent.trim());
      setSteerContent("");
      await refreshSessions();
    } catch (e) {
      setSteerError(e instanceof Error ? e.message : "Steer failed — retry or check the session state.");
    } finally {
      setSteerBusy(false);
    }
  }, [selectedSessionId, steerContent, refreshSessions]);

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

  return (
    <div className="flex min-h-[60vh] flex-1 overflow-hidden">
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      )}
          {!hideSidebarTemporarily && 
      <aside
        id="sidebar"
        className={`${
          mobileSidebarOpen ? "flex" : "hidden"
        } md:flex fixed md:static inset-y-0 left-0 z-40 w-64 max-w-[85vw] shrink-0 flex-col border-r border-white/5 bg-surface overflow-hidden`}
        aria-label="Sidebar"
      >
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
}
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/5 bg-background px-4 py-2 md:hidden">
          <button
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={mobileSidebarOpen}
            aria-controls="sidebar"
            onClick={() => setMobileSidebarOpen((v) => !v)}
            className="rounded-md p-2 text-muted hover:bg-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span aria-hidden="true" className="block h-5 w-5">
              <span className="block h-0.5 w-5 bg-current mt-1" />
              <span className="block h-0.5 w-5 bg-current mt-1.5" />
              <span className="block h-0.5 w-5 bg-current mt-1.5" />
            </span>
          </button>
          <span className="text-sm font-medium tracking-tight text-foreground">Atlaslink</span>
        </div>
        {selectedSessionId ? (
          <div className="mx-auto max-w-6xl px-4 sm:px-8 py-8 sm:py-12">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCloseSession}
                className="inline-flex items-center rounded-md border border-white/10 bg-raised px-3 py-1.5 text-sm text-foreground hover:bg-raised/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors"
              >
                ← Back to composer
              </button>
              <span className="rounded bg-white/5 px-2 py-1 font-mono text-xs text-muted">{selectedSessionId.slice(0, 20)}…</span>
              <select
                value={mode}
                onChange={(e) => {
                  const p = new URLSearchParams(searchParams.toString());
                  p.set("mode", e.target.value);
                  router.push(`?${p.toString()}`);
                }}
                className="rounded border border-white/10 bg-raised px-2 py-1 text-xs text-foreground"
                aria-label="Diagram mode"
              >
                <option value="chain">chain</option>
                <option value="fanout">fanout</option>
                <option value="full">full DAG</option>
              </select>
              <button
                onClick={() => {
                  const share = selectedProjectId ? canonicalUrl(selectedProjectId, selectedSessionId) : `?session=${selectedSessionId}`;
                  const q = encodeShareLink({ p: selectedProjectId, s: selectedSessionId, n: selectedNodeId ?? undefined, m: mode });
                  navigator.clipboard.writeText(`${window.location.origin}${share} or ${window.location.origin}/?q=${q}`);
                }}
                className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent/80"
              >
                copy link
              </button>
              {selectedProjectId && <span className="text-xs text-muted">project {selectedProjectId.slice(0, 8)}…</span>}
            </div>
            <header className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Live Society Diagram</h1>
              <p className="mt-2 text-sm leading-6 text-muted">Atlas holds the sky of sessions. Click any card to inspect reasoning, tools, decisions. {selectedSession?.status === "awaiting_input" ? "Atlas is awaiting your input — reply below." : ""}</p>
            </header>
            <div className="space-y-6">
              <ErrorBoundary>
                <SocietyDiagram selectedSessionId={selectedSessionId} mode={mode} onNodeClick={handleNodeClick} selectedNodeId={selectedNodeId} />
              </ErrorBoundary>
              <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                <SessionList onSelect={handleSelectSession} />
                <SessionThread session={selectedSession} events={events} members={members} onJump={(id) => handleNodeClick(id, "thread", {})} />
              </div>
              {!isTerminal ? (
                <div className="rounded-xl border border-white/10 bg-surface p-4">
                  <div className="text-sm font-medium text-foreground">Room chat · visible to everyone here</div>
                  <div className="mt-3 flex gap-2">
                    <input value={chatContent} onChange={(e) => setChatContent(e.target.value)} placeholder="Message the room…" aria-label="Message the room" className="flex-1 rounded border border-white/10 bg-raised px-3 py-2 text-sm text-foreground placeholder:text-muted" />
                    <button onClick={handleChat} disabled={chatBusy || !chatContent.trim()} className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-50">Send</button>
                  </div>
                  {chatError ? <div className="mt-2 text-xs text-red-400">{chatError}</div> : null}
                </div>
              ) : null}
              {isSteerable ? (
                <div className="rounded-xl border border-white/10 bg-surface p-4">
                  <div className="text-sm font-medium text-foreground">Steer {selectedSession?.status === "running" ? "· interrupts the live run first" : "· rewrites the queued prompt"}</div>
                  <div className="mt-3 flex gap-2">
                    <input value={steerContent} onChange={(e) => setSteerContent(e.target.value)} placeholder="Redirect this session…" aria-label="Redirect this session" className="flex-1 rounded border border-white/10 bg-raised px-3 py-2 text-sm text-foreground placeholder:text-muted" />
                    <button onClick={handleSteer} disabled={steerBusy || !steerContent.trim()} className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-50">Steer</button>
                    <button onClick={handleInterrupt} disabled={steerBusy} className="rounded border border-red-400/40 px-4 py-2 text-sm text-red-300 disabled:opacity-50">Interrupt</button>
                  </div>
                  {steerError ? <div className="mt-2 text-xs text-red-400">{steerError}</div> : null}
                </div>
              ) : null}
              {selectedSession?.nextStep?.awaiting_input ? (
                <div className="rounded-xl border border-accent/30 bg-accent/10 p-4">
                  <div className="text-sm font-medium text-accent">Atlas asks · {selectedSession.question?.question ?? selectedSession.nextStep.prompt}</div>
                  {selectedSession.question?.context ? (
                    <div className="mt-1 text-xs text-muted">{selectedSession.question.context}</div>
                  ) : null}
                  <div className="mt-3 flex gap-2">
                    <input value={replyContent} onChange={(e) => setReplyContent(e.target.value)} placeholder="Type your reply…" className="flex-1 rounded border border-white/10 bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted" />
                    <button onClick={handleReply} disabled={replyBusy || !replyContent.trim()} className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-50">Send</button>
                  </div>
                  {replyError ? <div className="mt-2 text-xs text-red-400">{replyError}</div> : null}
                </div>
              ) : selectedSession?.status === "awaiting_input" ? (
                <div className="rounded-xl border border-accent/30 bg-accent/10 p-4">
                  <div className="text-sm font-medium text-accent">Awaiting input{selectedSession.question?.question ? ` · ${selectedSession.question.question}` : ""}</div>
                  {selectedSession.question?.context ? (
                    <div className="mt-1 text-xs text-muted">{selectedSession.question.context}</div>
                  ) : null}
                  <div className="mt-3 flex gap-2">
                    <input value={replyContent} onChange={(e) => setReplyContent(e.target.value)} placeholder="Reply to continue…" className="flex-1 rounded border border-white/10 bg-surface px-3 py-2 text-sm" />
                    <button onClick={handleReply} disabled={replyBusy || !replyContent.trim()} className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-50">Send</button>
                  </div>
                  {replyError ? <div className="mt-2 text-xs text-red-400">{replyError}</div> : null}
                </div>
              ) : null}
            </div>
            <SessionInspector open={Boolean(inspectorNode)} onClose={handleCloseInspector} session={selectedSession} events={events} selectedNode={inspectorNode} />
          </div>
        ) : (
          <ErrorBoundary>
            <SessionComposer projects={projects} onCreateSession={handleSelectSession} />
          </ErrorBoundary>
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
