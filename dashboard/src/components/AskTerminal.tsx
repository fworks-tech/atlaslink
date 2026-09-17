"use client";

import { useEffect, useState } from "react";

/**
 * Terminal-style loop of real Atlas session moments — the Atlas-identity
 * answer to agenthood-site's TypingTerminal. Each example types its
 * command, reveals the outcome lines, holds, and hands over to the next.
 * One elapsed-driven interval derives (example, typed chars, revealed
 * lines) from a module-level schedule so the loop is deterministic and
 * never stalls; reduced motion is covered by the global CSS kill-switch.
 */

const TYPE_MS = 26;
const LINE_MS = 420;
const HOLD_MS = 2400;

interface Example {
  command: string;
  lines: Array<{ text: string; tone: "ok" | "ask" | "info" }>;
}

const EXAMPLES: Example[] = [
  {
    command: 'atlas run "fix issue #42 — login redirects to /dashboard"',
    lines: [
      { text: "the-debugger traced it to a stale redirect cache", tone: "info" },
      { text: "the-builder patched it and added the regression test", tone: "ok" },
      { text: "✓ session.succeeded — 3 members · 1 human · on record", tone: "ok" },
    ],
  },
  {
    command: 'atlas run the-reviewer "review my PR for security holes"',
    lines: [
      { text: "2 blocking findings — one is an unbounded query", tone: "info" },
      { text: "● Atlas asks — apply the suggested fix?", tone: "ask" },
      { text: "✓ you approved in the room — run resumed", tone: "ok" },
    ],
  },
  {
    command: 'atlas steer "skip the refactor, ship the hotfix"',
    lines: [
      { text: "room acknowledged — run redirected mid-flight", tone: "info" },
      { text: "✓ session.succeeded — hotfix out, refactor parked", tone: "ok" },
    ],
  },
];

interface Entry {
  ex: Example;
  typeAt: number;
  linesAt: number;
  next: number;
}

const SCHEDULE: Entry[] = [];
for (let acc = 0, i = 0; i < EXAMPLES.length; i++) {
  const entry: Entry = {
    ex: EXAMPLES[i],
    typeAt: acc,
    linesAt: acc + EXAMPLES[i].command.length * TYPE_MS,
    next: 0,
  };
  entry.next = entry.linesAt + EXAMPLES[i].lines.length * LINE_MS + HOLD_MS;
  acc = entry.next;
  SCHEDULE.push(entry);
}
const CYCLE = SCHEDULE[SCHEDULE.length - 1].next;

export default function AskTerminal() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - started) % CYCLE), 70);
    return () => clearInterval(id);
  }, []);

  const entry = SCHEDULE.find((e) => elapsed < e.next) ?? SCHEDULE[SCHEDULE.length - 1];
  const typed = Math.min(
    entry.ex.command.length,
    Math.max(0, Math.floor((elapsed - entry.typeAt) / TYPE_MS)),
  );
  const revealed = Math.floor(Math.max(0, elapsed - entry.linesAt) / LINE_MS);

  return (
    <div
      data-testid="ask-terminal"
      className="mx-auto overflow-hidden rounded-xl border border-line bg-surface text-left"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-2 text-[11px] text-muted">
        <span className="flex items-center gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-warn/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-ok/60" />
        </span>
        <span className="font-mono">atlas://the-room</span>
      </div>
      <div className="px-4 py-4 font-mono text-[13px] leading-6 sm:px-5">
        <div>
          <span className="text-gold">$</span>{" "}
          <span className="text-foreground">{entry.ex.command.slice(0, typed) || " "}</span>
          {typed < entry.ex.command.length && <span className="animate-pulse text-gold">▍</span>}
        </div>
        {entry.ex.lines
          .slice(0, revealed)
          .map((line) => (
            <div
              key={line.text}
              className={line.tone === "ask" ? "text-gold" : line.tone === "ok" ? "text-accent" : "text-muted"}
            >
              {line.text}
            </div>
          ))}
      </div>
    </div>
  );
}
