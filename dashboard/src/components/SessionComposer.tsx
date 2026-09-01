"use client";

import { useEffect, useRef, useState } from "react";
import { createTask, ApiError } from "@/lib/api";
import type { Project } from "@/lib/types";
import AnimatedMessage from "./AnimatedMessage";
import FadeIn from "./FadeIn";

const SAMPLE_PROMPTS = [
  "Review my pull request for security vulnerabilities",
  "Suggest improvements for test coverage",
  "Plan the implementation for the new feature",
  "Why did the DAG fan out here? Explain the handoff",
  "Summarize the session where the Architect delegated to the Builder",
  "What is Atlas holding in the sky of sessions?",
];

const SOCIETY_MEMBERS = [
  { id: "the-mediator", label: "The Mediator", desc: "Routes intent → specialist", icon: "◈" },
  { id: "the-architect", label: "The Architect", desc: "Plans before coding", icon: "⬢" },
  { id: "the-builder", label: "The Builder", desc: "Implements & fixes", icon: "▣" },
  { id: "the-reviewer", label: "The Reviewer", desc: "5-axis code review", icon: "◎" },
  { id: "the-tester", label: "The Tester", desc: "TDD & coverage", icon: "◐" },
  { id: "the-debugger", label: "The Debugger", desc: "Root-cause traces", icon: "⚡" },
  { id: "the-auditor", label: "The Auditor", desc: "Security & deps", icon: "⬣" },
  { id: "the-librarian", label: "The Librarian", desc: "Docs & memory", icon: "⬔" },
];

export function SessionComposer({
  projects,
  onCreateSession,
}: {
  projects: Project[];
  onCreateSession: (sessionId: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: "success" | "error" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cycleIdx, setCycleIdx] = useState(0);

  useEffect(() => {
    if (!toast) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [toast]);

  useEffect(() => {
    const id = setInterval(() => setCycleIdx((i) => (i + 1) % SAMPLE_PROMPTS.length), 3200);
    return () => clearInterval(id);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) return;
    if (trimmed.length > 10000) {
      setError("Prompt must be ≤10000 characters");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await createTask({
        member: "the-mediator",
        prompt: trimmed,
        ...(projectId ? { projectId } : {}),
      });
      setPrompt("");
      setToast({ message: "Task created", kind: "success" });
      onCreateSession(res.session.sessionId);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "failed to create task";
      setError(msg);
      setToast({ message: msg, kind: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex flex-col items-center justify-center min-h-[70vh] px-4 py-10">
      {/* Hero watermark */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden">
        <span
          className="text-[8rem] sm:text-[10rem] md:text-[12rem] font-black tracking-tighter text-foreground/[0.04] leading-none"
          aria-hidden
        >
          ATLAS
        </span>
      </div>

      <FadeIn className="relative z-10 mb-8 max-w-2xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
          Live Society Diagram · Atlas holds the sky of sessions
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Ask Atlas. Watch the Society work.
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          A shared thread, a live DAG, and the full provenance of every handoff — from The Mediator to The Reviewer.
        </p>
      </FadeIn>

      <div className="relative z-10 w-full max-w-2xl">
        {/* AnimatedMessage above Ask Atlas input */}
        <AnimatedMessage key={cycleIdx} className="mb-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2.5 font-mono text-xs text-zinc-400 backdrop-blur-sm">
            <span className="text-emerald-400">$</span> {SAMPLE_PROMPTS[cycleIdx]}
          </div>
        </AnimatedMessage>

        <form onSubmit={submit} className="rounded-xl border border-white/5 bg-surface/80 backdrop-blur-sm p-6">
          <div className="flex flex-col gap-4">
            <textarea
              id="composer-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask Atlas anything..."
              rows={3}
              maxLength={10000}
              autoFocus
              className="w-full rounded-lg border border-white/10 bg-raised px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted/50 focus:border-accent/50 resize-none"
            />
            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_PROMPTS.slice(0, 4).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPrompt(p)}
                  className="rounded-full border border-white/10 bg-raised px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-accent/30 hover:text-foreground"
                >
                  {p.slice(0, 32)}…
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              {projects.length > 0 && (
                <select
                  id="composer-project"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="rounded-lg border border-white/10 bg-raised px-2.5 py-1.5 text-xs text-muted outline-none focus:border-accent/50"
                >
                  <option value="">no project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="submit"
                disabled={submitting || !prompt.trim()}
                className="ml-auto rounded-lg bg-accent/15 px-4 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
              >
                {submitting ? "sending…" : "Ask Atlas"}
              </button>
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}
          </div>
        </form>
        {toast && (
          <div
            role="status"
            aria-live="polite"
            className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2 text-sm shadow-lg backdrop-blur-sm ${
              toast.kind === "success"
                ? "border-ok/20 bg-ok/10 text-ok"
                : "border-danger/20 bg-danger/10 text-danger"
            }`}
          >
            {toast.message}
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className="ml-3 text-xs opacity-70 hover:opacity-100"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* Society strip — Atlas identity, agenthood-society parity */}
      <FadeIn delay={120} className="relative z-10 mt-10 w-full max-w-5xl">
        <div id="society" className="rounded-xl border border-white/5 bg-surface/50 p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">The Society</h2>
            <span className="text-xs text-muted">{SOCIETY_MEMBERS.length} members · any runtime</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SOCIETY_MEMBERS.map((m) => (
              <div key={m.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 transition-colors hover:border-zinc-700">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-800 text-xs text-zinc-300" aria-hidden>
                    {m.icon}
                  </span>
                  <span className="text-xs font-medium text-zinc-200">{m.label}</span>
                </div>
                <p className="mt-1.5 text-[11px] leading-4 text-zinc-500">{m.desc}</p>
              </div>
            ))}
          </div>
          <div id="how-it-works" className="mt-6 grid gap-3 sm:grid-cols-3 text-xs text-zinc-500">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
              <span className="font-medium text-zinc-300">1 · Ask</span> — You prompt The Mediator; it holds the sky.
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
              <span className="font-medium text-zinc-300">2 · Society acts</span> — DAG fans out · chain · full.
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
              <span className="font-medium text-zinc-300">3 · Inspect</span> — Click any node → thread & provenance.
            </div>
          </div>
        </div>
      </FadeIn>
    </div>
  );
}
