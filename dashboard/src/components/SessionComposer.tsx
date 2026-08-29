"use client";

import { useState } from "react";
import { createTask, ApiError } from "@/lib/api";
import { QUICK_MEMBERS } from "@/components/NewTaskForm";
import type { Project } from "@/lib/types";

export function SessionComposer({
  projects,
  onCreateSession,
}: {
  projects: Project[];
  onCreateSession: (sessionId: string) => void;
}) {
  const [member, setMember] = useState<string>("the-mediator");
  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await createTask({
        member,
        prompt: prompt.trim(),
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
    <div className="flex items-center justify-center min-h-[60vh]">
      <form
        onSubmit={submit}
        className="w-full max-w-2xl rounded-xl border border-white/5 bg-surface p-6"
      >
        <h2 className="mb-4 text-lg font-medium text-foreground">New Session</h2>
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="composer-member" className="text-xs text-muted">
              member
            </label>
            <select
              id="composer-member"
              value={member}
              onChange={(e) => setMember(e.target.value)}
              className="rounded-lg border border-white/10 bg-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent/50"
            >
              {QUICK_MEMBERS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {projects.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="composer-project" className="text-xs text-muted">
                project
              </label>
              <select
                id="composer-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="rounded-lg border border-white/10 bg-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent/50"
              >
                <option value="">none</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="composer-prompt" className="text-xs text-muted">
              prompt
            </label>
            <textarea
              id="composer-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder='e.g. "Fix issue #42 — login redirects to /dashboard"'
              rows={3}
              className="rounded-lg border border-white/10 bg-raised px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted/70 focus:border-accent/50 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !prompt.trim()}
            className="w-full rounded-lg bg-accent/15 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
          >
            {submitting ? "creating…" : "Start session"}
          </button>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      </form>
    </div>
  );
}
