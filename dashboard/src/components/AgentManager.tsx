"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createAgent,
  deleteAgent,
  getAgents,
  notifyAgentsChanged,
  updateAgent,
  ApiError,
} from "@/lib/api";
import type { CustomAgent } from "@/lib/types";

// Mirrors NAME_PATTERN in src/api/agents.ts — the server re-validates.
const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

const EMPTY_FORM = { name: "", displayName: "", persona: "", baseMember: "", provider: "", model: "" };

function errMsg(err: unknown): string {
  return err instanceof ApiError ? err.message : "request failed";
}

/**
 * Custom agent manager (#402): the dashboard half of the Phase C CRUD.
 * Lists tenant customs, creates/edits/deletes through /agents; changes apply
 * to new sessions (persona bakes at create) and notify the composer picker.
 */
export function AgentManager() {
  const [agents, setAgents] = useState<CustomAgent[]>([]);
  const [builtIn, setBuiltIn] = useState<string[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<string | null>(null);
  const [editPersona, setEditPersona] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Single loader for mount and manual refreshes. The cancelled check keeps
  // a slow fetch for a previous mount from overwriting the current one.
  const refresh = useCallback(async (isCancelled: () => boolean = () => false) => {
    try {
      const res = await getAgents();
      if (isCancelled()) return;
      setAgents(res.agents);
      setBuiltIn(res.builtIn);
      setError(null);
    } catch (err) {
      if (isCancelled()) return;
      setError(errMsg(err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refresh(() => cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!NAME_PATTERN.test(name)) {
      setError("name must be lowercase alphanumeric with dashes");
      return;
    }
    if (form.persona.trim().length === 0) {
      setError("persona is required");
      return;
    }
    setBusy(true);
    setError(null);
    // the base defaults to the first built-in until the user picks one
    const baseMember = form.baseMember || builtIn[0] || "";
    try {
      await createAgent({
        name,
        ...(form.displayName.trim() ? { displayName: form.displayName.trim() } : {}),
        persona: form.persona.trim(),
        baseMember,
        ...(form.provider.trim() ? { provider: form.provider.trim() } : {}),
        ...(form.model.trim() ? { model: form.model.trim().slice(0, 200) } : {}),
      });
      setForm({ ...EMPTY_FORM, baseMember });
      await refresh();
      notifyAgentsChanged();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  // Persona-only edit by design: name/base are the agent's identity, and
  // provider/model can already be overridden per session in the composer.
  const submitEdit = async (name: string) => {
    if (editPersona.trim().length === 0) {
      setError("persona is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateAgent(name, { persona: editPersona.trim() });
      setEditing(null);
      await refresh();
      notifyAgentsChanged();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name: string) => {
    if (confirmDelete !== name) {
      setConfirmDelete(name);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteAgent(name);
      setConfirmDelete(null);
      await refresh();
      notifyAgentsChanged();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="custom agents" className="rounded-xl border border-line bg-surface p-4">
      <details>
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          Custom agents{agents.length > 0 ? ` (${agents.length})` : ""}
        </summary>
        <p className="mt-2 text-xs leading-5 text-muted">
          Changes apply to new sessions — the persona bakes into the prompt at creation. Deleting an
          agent fails its queued runs; in-flight runs keep working.
        </p>
        <ul className="mt-3 space-y-2">
          {agents.map((a) => (
            <li key={a.name} className="rounded-lg border border-line bg-raised px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-foreground">{a.displayName || a.name}</span>
                <span className="rounded bg-line px-2 py-0.5 font-mono text-[11px] text-muted">
                  {`${a.name} · ${a.baseMember}`}
                </span>
                <span className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(editing === a.name ? null : a.name);
                      setEditPersona(a.persona);
                    }}
                    className="text-xs text-muted hover:text-foreground"
                  >
                    edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(a.name)}
                    aria-label={confirmDelete === a.name ? "confirm delete" : `delete ${a.name}`}
                    className="text-xs text-danger/80 hover:text-danger"
                  >
                    {confirmDelete === a.name ? "confirm delete" : "delete"}
                  </button>
                </span>
              </div>
              {editing === a.name ? (
                <div className="mt-2 flex flex-col gap-2">
                  <label className="flex flex-col gap-1 text-xs text-muted">
                    Persona
                    <textarea
                      value={editPersona}
                      onChange={(e) => setEditPersona(e.target.value)}
                      rows={3}
                      maxLength={4000}
                      className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent/50"
                    />
                  </label>
                  <div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void submitEdit(a.name)}
                      className="rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25 disabled:opacity-40"
                    >
                      save
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {agents.length === 0 ? (
          <p className="mt-3 text-xs text-muted">No custom agents yet — create one below.</p>
        ) : null}
        <form onSubmit={submitCreate} className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex flex-wrap gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
              Name
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="reviewer"
                maxLength={64}
                className="min-h-[44px] rounded-lg border border-line bg-raised px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted/50 focus:border-accent/50"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
              Display name
              <input
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                placeholder="Reviewer"
                maxLength={200}
                className="min-h-[44px] rounded-lg border border-line bg-raised px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted/50 focus:border-accent/50"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Base member
              <select
                value={form.baseMember || builtIn[0] || ""}
                onChange={(e) => setForm({ ...form, baseMember: e.target.value })}
                className="min-h-[44px] rounded-lg border border-line bg-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent/50"
              >
                {builtIn.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Persona
            <textarea
              value={form.persona}
              onChange={(e) => setForm({ ...form, persona: e.target.value })}
              placeholder="you review diffs carefully"
              rows={3}
              maxLength={4000}
              className="rounded-lg border border-line bg-raised px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted/50 focus:border-accent/50"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
              Provider (optional)
              <input
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                placeholder="default"
                maxLength={200}
                className="min-h-[44px] rounded-lg border border-line bg-raised px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted/50 focus:border-accent/50"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
              Model (optional)
              <input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="default"
                maxLength={200}
                className="min-h-[44px] rounded-lg border border-line bg-raised px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted/50 focus:border-accent/50"
              />
            </label>
          </div>
          <div>
            <button
              type="submit"
              disabled={busy}
              className="min-h-[44px] rounded-lg bg-accent/15 px-4 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
            >
              {busy ? "saving…" : "create agent"}
            </button>
          </div>
        </form>
        {error ? <p role="alert" className="mt-2 text-xs text-danger">{error}</p> : null}
      </details>
    </section>
  );
}
