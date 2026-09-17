"use client";

import { useEffect, useRef, useState } from "react";
import { createTask, getProviders, ApiError } from "@/lib/api";
import type { ProviderChoice } from "@/lib/api";
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
  // Provider pick (#145): options from the daemon's roster, model prefilled
  // from the selected provider's default and reset when the pick changes.
  // Bad provider input 400s server-side too — this is just a nicer snapshot.
  const [providers, setProviders] = useState<ProviderChoice[] | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async (attempt: number): Promise<void> => {
      try {
        const res = await getProviders();
        if (cancelled) return;
        setProviders(res.providers);
        if (res.default) {
          setProvider(res.default);
          const def = res.providers.find((p) => p.name === res.default);
          if (def?.model) setModel(def.model);
        }
      } catch {
        // transient backend hiccups (cold start, proxy blip) must not
        // permanently disable the picker — retry, then fall back silently:
        // the form works with the daemon default without a roster
        if (cancelled) return;
        if (attempt < 3) {
          setTimeout(() => {
            if (!cancelled) void load(attempt + 1);
          }, 2000 * attempt);
        }
      }
    };
    void load(0);
    return () => {
      cancelled = true;
    };
  }, []);

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
        ...(provider ? { tweaks: { provider, member: model ? { model } : {} } } : {}),
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
        <div className="flex items-center justify-center pointer-events-none select-none overflow-hidden">
        <span
          className="text-[8rem] sm:text-[10rem] md:text-[12rem] font-black tracking-tighter text-foreground/[0.04] leading-none"
          aria-hidden
        >
          ATLAS
        </span>
      </div>
        <p className="mt-3 text-sm leading-6 text-muted">
          Ask Atlas. See how the AI and human members of the Society collaborate to solve your problem.
        </p>
      </FadeIn>

      <div className="relative z-10 w-full max-w-2xl">

        <form onSubmit={submit} className="rounded-xl border border-line bg-surface/80 backdrop-blur-sm p-6">
          <div className="flex flex-col gap-4">
            <textarea
              id="composer-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={SAMPLE_PROMPTS[cycleIdx]}
              rows={3}
              maxLength={10000}
              autoFocus
              className="w-full rounded-lg border border-line bg-raised px-4 py-3 text-base text-foreground outline-none placeholder:text-muted/50 focus:border-accent/50 resize-none sm:text-sm"
            />
            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_PROMPTS.slice(0, 4).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPrompt(p)}
                  className="rounded-full border border-line bg-raised px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-accent/30 hover:text-foreground"
                >
                  {p.slice(0, 32)}…
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {providers && providers.length > 0 ? (
                <>
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    provider
                    <select
                      aria-label="provider"
                      value={provider}
                      onChange={(e) => {
                        const next = e.target.value;
                        setProvider(next);
                        const def = providers.find((p) => p.name === next);
                        setModel(def?.model ?? "");
                      }}
                      className="min-h-[44px] rounded-lg border border-line bg-raised px-2.5 py-1.5 text-base text-foreground outline-none focus:border-accent/50 sm:text-sm"
                    >
                      {providers.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                          {p.configured === false ? " (no key)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-1 items-center gap-1.5 text-xs text-muted sm:flex-none">
                    model
                    <input
                      aria-label="model"
                      value={model}
                      onChange={(e) => setModel(e.target.value.slice(0, 200))}
                      placeholder="default"
                      className="min-h-[44px] w-40 rounded-lg border border-line bg-raised px-2.5 py-1.5 text-base text-foreground outline-none placeholder:text-muted/50 focus:border-accent/50 sm:text-sm"
                    />
                  </label>
                </>
              ) : null}

              {/* sessions always live in a project (spec: auth-app-flow §3);
                  with no projects yet the submit stays disabled — the inbox
                  is auto-created by the app shell */}
              <select
                id="composer-project"
                aria-label="project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="rounded-lg border border-line bg-raised px-2.5 py-1.5 text-xs text-muted outline-none focus:border-accent/50"
              >
                <option value="" disabled>
                  {projects.length > 0 ? "select project" : "no projects yet"}
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                disabled={submitting || !prompt.trim() || !projectId}
                className="ml-auto min-h-[44px] rounded-lg bg-accent/15 px-4 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
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
