"use client";

import { useCallback, useEffect, useState } from "react";
import {
  commitWorkspace,
  diffWorkspace,
  listWorkspaceFiles,
  logWorkspaceCommits,
  readWorkspaceFile,
  type WorkspaceCommit,
} from "@/lib/api";

// git's well-known empty-tree object — diffing the oldest commit against it
// shows the initial tree without teaching the server new rev syntax.
// Keep in sync with EMPTY_TREE in src/api/workspace.ts.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * Project workspace panel (Phase D): the shared git canvas — file browser,
 * inert viewer, commit history with diffs, and human commits attributed via
 * the `user:` trailer (agent runs carry `session:`). Content renders in
 * <pre>, never as HTML.
 */
export function WorkspacePanel({ projectId, sessionId }: { projectId: string; sessionId?: string }) {
  const [files, setFiles] = useState<string[]>([]);
  const [commits, setCommits] = useState<WorkspaceCommit[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffTitle, setDiffTitle] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Single loader for mount and manual refresh; the cancelled check keeps a
  // slow fetch for a previous project from overwriting the current one.
  const refresh = useCallback(async (isCancelled: () => boolean = () => false) => {
    try {
      const [f, l] = await Promise.all([listWorkspaceFiles(projectId), logWorkspaceCommits(projectId)]);
      if (isCancelled()) return;
      setFiles(f.files);
      setCommits(l.commits);
      setError(null);
    } catch (err) {
      if (isCancelled()) return;
      setError(err instanceof Error ? err.message : "workspace unavailable");
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refresh(() => cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const openFile = async (path: string): Promise<void> => {
    setSelectedFile(path);
    setDiff(null);
    try {
      const res = await readWorkspaceFile(projectId, path);
      setContent(res.content);
    } catch (err) {
      setContent(null);
      setError(err instanceof Error ? err.message : "cannot read file");
    }
  };

  const openCommit = async (index: number): Promise<void> => {
    const commit = commits[index];
    if (!commit) return;
    setSelectedFile(null);
    setContent(null);
    const parent = commits[index + 1]?.sha ?? EMPTY_TREE;
    setDiffTitle(`${parent.slice(0, 8)}…${commit.sha.slice(0, 8)} ${commit.message}`);
    try {
      const res = await diffWorkspace(projectId, parent, commit.sha);
      setDiff(res.diff.length > 0 ? res.diff : "(no changes)");
    } catch (err) {
      setDiff(null);
      setError(err instanceof Error ? err.message : "cannot load diff");
    }
  };

  const submitCommit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      await commitWorkspace(projectId, text, sessionId);
      setMessage("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "commit failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-4" data-testid="workspace-panel">
      <div className="text-sm font-medium text-foreground">Workspace · shared canvas</div>
      <p className="mt-1 text-xs text-muted">Every run pins its outcome here — browse, diff, and commit with attribution.</p>
      {error && (
        <div role="alert" className="mt-2 text-xs text-danger">
          {error}
        </div>
      )}
      <div className="mt-3 grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-widest text-muted">files</div>
          <ul className="mt-1 max-h-56 overflow-auto rounded-lg border border-line bg-raised p-1">
            {files.length === 0 && <li className="px-2 py-1 text-xs text-muted">No files yet — runs land here.</li>}
            {files.map((f) => (
              <li key={f}>
                <button
                  type="button"
                  onClick={() => void openFile(f)}
                  aria-label={`Open ${f}`}
                  className={`block w-full truncate rounded px-2 py-1 text-left font-mono text-xs hover:bg-line ${selectedFile === f ? "bg-line text-foreground" : "text-muted"}`}
                >
                  {f}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-[11px] uppercase tracking-widest text-muted">history</div>
          <ul className="mt-1 max-h-56 overflow-auto rounded-lg border border-line bg-raised p-1">
            {commits.length === 0 && <li className="px-2 py-1 text-xs text-muted">No commits yet.</li>}
            {commits.map((c, i) => (
              <li key={c.sha}>
                <button
                  type="button"
                  onClick={() => void openCommit(i)}
                  aria-label={`Show ${c.message}`}
                  className="block w-full truncate rounded px-2 py-1 text-left text-xs text-muted hover:bg-line hover:text-foreground"
                >
                  <span className="font-mono">{c.sha.slice(0, 8)}</span> {c.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          {diff !== null && (
            <div>
              <div className="text-[11px] uppercase tracking-widest text-muted" title={diffTitle}>diff</div>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-raised p-2 font-mono text-[11px] text-foreground">{diff}</pre>
            </div>
          )}
          {content !== null && selectedFile && (
            <div>
              <div className="truncate text-[11px] uppercase tracking-widest text-muted" title={selectedFile}>{selectedFile}</div>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-raised p-2 font-mono text-[11px] text-foreground">{content}</pre>
            </div>
          )}
          <form onSubmit={submitCommit} className="mt-3">
            <label htmlFor="workspace-commit-message" className="text-[11px] uppercase tracking-widest text-muted">
              commit working tree{sessionId ? " · linked to this session" : ""}
            </label>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <input
                id="workspace-commit-message"
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
                placeholder="What changed in the working tree…"
                className="flex-1 rounded-lg border border-line bg-raised px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted/50 focus:border-accent/50"
              />
              <button
                type="submit"
                disabled={busy || !message.trim()}
                className="min-h-[44px] rounded-lg bg-accent/15 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
              >
                {busy ? "committing…" : "Commit"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
