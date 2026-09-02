"use client";

import { useEffect, useRef, useState } from "react";
import { createTask, ApiError } from "@/lib/api";
import type { Project } from "@/lib/types";
import FadeIn from "./FadeIn";

const SAMPLE_PROMPTS = [
  "Review my pull request for security vulnerabilities",
  "Write a summary of the last 10 commits",
  "Generate a test plan for the new feature",
  "Explain the architecture of the new module",
  "What are the potential risks of this implementation?",
  "Identify performance bottlenecks in the code",
  "List the dependencies of the project and their versions",
  "Create a checklist for code review",
  "Suggest improvements for test coverage",
  "Plan the implementation for the new feature",
  "Draft a design document for the upcoming release",
  "Analyze the code for potential memory leaks",
  "Why did the DAG fan out here? Explain the handoff",
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
      <FadeIn className="relative z-10 mb-8 max-w-7xl text-center">
        <div className="inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden">
        <span
          className="text-[8rem] sm:text-[10rem] md:text-[12rem] font-black tracking-tighter text-foreground/[0.04] leading-none"
          aria-hidden
        >
          ATLAS
        </span>
      </div>
        {/* <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
          Ask Atlas. Watch the Society work.
        </h1> */}
        <p className="mt-3 text-sm leading-6 text-muted">
          Ask Atlas. See how the AI and human members of the Society collaborate to solve your problem.
        </p>
      </FadeIn>

      <div className="relative z-10 w-full max-w-2xl">
        {/* AnimatedMessage above Ask Atlas input */}

        <form onSubmit={submit} className="rounded-xl border border-white/5 bg-surface/80 backdrop-blur-sm p-6">
          <div className="flex flex-col gap-4">
            <textarea
              id="composer-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={SAMPLE_PROMPTS[cycleIdx]}
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
            {toast.message || 'An error occurred'}
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
    </div>
  );
}
