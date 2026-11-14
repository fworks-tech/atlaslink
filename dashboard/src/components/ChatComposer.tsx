"use client";

import { useMemo, useRef, useState } from "react";
import { sendChatMessage } from "@/lib/api";
import type { MemberDirectoryEntry } from "@/lib/types";

export interface ReplyTarget {
  /** Full-list turn index; the wire id is `m-{index}` (opaque to the server). */
  index: number;
  excerpt: string;
}

function mentionQuery(value: string, caret: number): string | null {
  const before = value.slice(0, caret);
  const match = /(^|\s)@([A-Za-z0-9._%+-]*)$/.exec(before);
  return match ? (match[2] ?? "") : null;
}

/**
 * Room chat composer (Phase B): anytime human↔human messages with thread
 * replies (`m-{index}` parentIds, resolved against the full turn list) and
 * @mention autocomplete from the tenant directory. Content posts raw — the
 * thread renders it as inert text (react-markdown, no raw HTML).
 */
export function ChatComposer({
  sessionId,
  directory,
  replyTo,
  onClearReply,
  onSent,
}: {
  sessionId: string;
  directory: MemberDirectoryEntry[];
  replyTo: ReplyTarget | null;
  onClearReply: () => void;
  onSent: () => void;
}) {
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [mentionOpen, setMentionOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const query = useMemo(() => (mentionOpen ? mentionQuery(content, caret) : null), [content, caret, mentionOpen]);
  const suggestions = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return directory.filter((m) => m.email.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q)).slice(0, 5);
  }, [query, directory]);

  const pickMention = (email: string): void => {
    const before = content.slice(0, caret);
    const replaced = before.replace(/(^|\s)@[A-Za-z0-9._%+-]*$/, `$1@${email} `);
    const next = replaced + content.slice(caret);
    setContent(next);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(replaced.length, replaced.length);
      }
    });
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || busy) return;
    // mentions are directory emails referenced as @email in the text.
    // Boundary-aware: `@bob@example.com` must not fire inside
    // `@bob@example.com.evil.com`.
    const mentioned = new Set<string>();
    const boundary = (text: string, token: string): boolean => {
      let from = 0;
      for (;;) {
        const at = text.indexOf(token, from);
        if (at < 0) return false;
        const after = text[at + token.length];
        if (after === undefined || /[\s,;:!?)\]}>]/.test(after)) return true;
        from = at + token.length;
      }
    };
    for (const m of directory) {
      if (boundary(trimmed, `@${m.email}`)) mentioned.add(m.email);
      else if (boundary(trimmed, `@${m.id}`)) mentioned.add(m.id);
    }
    setBusy(true);
    setError(null);
    try {
      await sendChatMessage(sessionId, trimmed, {
        ...(replyTo ? { parentId: `m-${replyTo.index}` } : {}),
        ...(mentioned.size > 0 ? { mentions: [...mentioned] } : {}),
      });
      setContent("");
      onClearReply();
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to send");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-surface p-3">
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-accent/10 px-2 py-1 text-xs text-accent">
          <span aria-hidden>↳</span>
          <span className="truncate">replying to: {replyTo.excerpt}</span>
          <button type="button" onClick={onClearReply} aria-label="Cancel reply" className="ml-auto opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>
      )}
      <div className="relative">
        <textarea
          ref={inputRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setMentionOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setMentionOpen(false);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onBlur={() => setTimeout(() => setMentionOpen(false), 150)}
          placeholder="Chat with the room… @ to mention"
          aria-label="Room chat message"
          rows={2}
          maxLength={10000}
          className="w-full resize-none rounded-lg border border-line bg-raised px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted/50 focus:border-accent/50"
        />
        {mentionOpen && query !== null && suggestions.length > 0 && (
          <ul
            role="listbox"
            aria-label="Mention suggestions"
            className="absolute bottom-full left-0 z-10 mb-1 w-64 overflow-auto rounded-lg border border-line bg-surface py-1 shadow-xl"
          >
            {suggestions.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(m.email);
                  }}
                  className="block w-full truncate px-3 py-1.5 text-left text-sm text-foreground hover:bg-raised"
                >
                  <span className="font-medium">@{m.displayName}</span>
                  <span className="ml-2 text-xs text-muted">{m.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {error && (
          <span role="alert" className="text-xs text-danger">
            {error}
          </span>
        )}
        <button
          type="submit"
          disabled={busy || !content.trim()}
          className="ml-auto min-h-[44px] rounded-lg bg-accent/15 px-4 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
        >
          {busy ? "sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}
