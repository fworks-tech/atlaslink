"use client";

import { useState } from "react";
import { createTask, ApiError } from "@/lib/api";
import type { Project } from "@/lib/types";

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
      onCreateSession(res.session.sessionId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex items-center justify-center min-h-[70vh]">
      {/* Hero watermark */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden">
        <span
          className="text-[8rem] sm:text-[10rem] md:text-[12rem] font-black tracking-tighter text-foreground/[0.04] leading-none"
          aria-hidden
        >
          ATLAS
        </span>
      </div>

      <div className="relative z-10 w-full max-w-2xl">
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
      </div>
    </div>
  );
}
