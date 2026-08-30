"use client";

import { useState } from "react";
import { createTask, ApiError } from "@/lib/api";
import { QUICK_MEMBERS } from "@/lib/constants";

export function NewTaskForm() {
  const [member, setMember] = useState<string>("the-mediator");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createTask({ member, prompt: prompt.trim() });
      setPrompt("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-xl border border-white/5 bg-surface p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="task-member" className="text-xs text-muted">
            member
          </label>
          <select
            id="task-member"
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
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="task-prompt" className="text-xs text-muted">
            prompt
          </label>
          <input
            id="task-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='e.g. "Fix issue #42 — login redirects to /dashboard"'
            className="rounded-lg border border-white/10 bg-raised px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted/70 focus:border-accent/50"
          />
        </div>
        <button
          type="submit"
          disabled={submitting || !prompt.trim()}
          className="rounded-lg bg-accent/15 px-4 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
        >
          {submitting ? "creating…" : "Start task"}
        </button>
      </div>
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
    </form>
  );
}