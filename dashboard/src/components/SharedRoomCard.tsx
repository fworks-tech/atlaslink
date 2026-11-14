"use client";

import { IconCheck } from "@tabler/icons-react";
import Disc from "./room/Disc";
import LiveBadge from "./room/LiveBadge";

/**
 * Storyboard of a shared room resolving a PR security review — the visual
 * payoff of the landing's final CTA. Fully static (no timers): the hero
 * canvas already carries the page's motion, and the global reduced-motion
 * kill-switch covers the Live dot's pulse. Avatars are initial-discs, so the
 * card ships zero image assets and zero external requests.
 */

type Segment = { text: string; gold?: boolean };

interface ChatMessage {
  author?: string;
  initials: string;
  tone: "human" | "agent";
  segments: Segment[];
  pill?: string;
}

const CHAT: ChatMessage[] = [
  {
    author: "Human: Senior Reviewer",
    initials: "SR",
    tone: "human",
    segments: [
      { text: "@ATLAS", gold: true },
      { text: ", can you detail the specific file and line?" },
    ],
  },
  {
    initials: "AT",
    tone: "agent",
    segments: [
      { text: "@Senior Reviewer", gold: true },
      { text: ", it's in " },
      { text: "src/handlers/user.js", gold: true },
      { text: ", line 45." },
    ],
  },
  {
    author: "Human: Senior Reviewer",
    initials: "SR",
    tone: "human",
    segments: [
      { text: "@Implementer", gold: true },
      { text: " (another human), please review ATLAS's proposed fix and apply if good." },
    ],
  },
  {
    initials: "IM",
    tone: "human",
    segments: [
      { text: "@Senior Reviewer", gold: true },
      { text: ", reviewed. Looks good. Applying." },
    ],
  },
  {
    initials: "IM",
    tone: "human",
    segments: [{ text: "Fix applied. Rerunning security tests." }],
    pill: "✓ applied",
  },
  {
    author: "Agent: Triage",
    initials: "AT",
    tone: "agent",
    segments: [{ text: "Vulnerability no longer detected. Passing." }],
  },
];

const TIMELINE: Array<{ label: string; time: string; pill?: string; done?: boolean }> = [
  { label: "Vulnerability detected", time: "7:57 PM" },
  { label: "Fix proposed", time: "7:58 PM" },
  { label: "Fix reviewed", time: "8:01 PM", pill: "approval" },
  { label: "Fix applied", time: "8:03 PM" },
  { label: "Vulnerability resolved", time: "8:05 PM", done: true },
];

function AgentCard({ agent, member, children }: { agent: string; member: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-accent/40 bg-surface p-4">
      <div className="flex items-center gap-2.5">
        <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[11px] font-bold text-accent">AI</span>
        <div>
          <div className="text-sm font-semibold text-foreground">{agent}</div>
          <div className="text-xs text-muted">{member}</div>
        </div>
      </div>
      <div className="mt-3 border-t border-line pt-3 text-sm leading-relaxed text-foreground">{children}</div>
    </div>
  );
}

export default function SharedRoomCard() {
  return (
    <div
      aria-label="Example: a shared room resolving a PR security review"
      className="mx-auto max-w-5xl rounded-2xl border border-line bg-surface/70 p-4 shadow-xl sm:p-6"
    >
      {/* Room header: title, who's inside, live badge */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3
          className="text-lg font-semibold text-foreground"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Live Shared Room
        </h3>
        <div className="flex items-end gap-3" aria-hidden>
          {[
            { initials: "you", tone: "human", caption: "you" },
            { initials: "…", tone: "human", caption: "…" },
            { initials: "h2", tone: "human", caption: "human-2" },
            { initials: "…", tone: "agent", caption: "…" },
          ].map((a) => (
            <span key={a.caption + a.initials} className="flex flex-col items-center gap-1">
              <Disc initials={a.initials} tone={a.tone as "human" | "agent"} />
              <span className="text-[11px] text-muted">{a.caption}</span>
            </span>
          ))}
        </div>
        <LiveBadge />
      </div>

      {/* Room body: two agents flanking the collaboration chat */}
      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.25fr_1fr]">
        <div className="relative flex flex-col gap-4">
          <AgentCard agent="Agent: triage" member="ATLAS">
            Analyzed PR. Found potential SSRF vulnerability in user input handling. I propose a fix.
          </AgentCard>
          <div className="rounded-xl border border-line bg-surface p-4">
            <div className="text-sm font-semibold text-foreground">Triage</div>
            <div className="mt-2 text-sm leading-relaxed text-muted">
              Vulnerabilities detected: 1 (SSRF){" "}
              <span className="text-accent">&gt; details</span>
            </div>
          </div>
          <span aria-hidden className="absolute -right-4 top-1/4 hidden h-16 w-4 rounded-r border-y-2 border-r-2 border-gold/60 lg:block" />
        </div>

        <div className="rounded-xl border border-line bg-surface/40 p-4">
          <h4
            className="mb-3 text-sm font-semibold text-foreground"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Live Collaboration Chat
          </h4>
          <ol className="flex flex-col gap-2.5">
            {CHAT.map((m, i) => (
              <li key={i}>
                {m.author && <div className="mb-1 ml-9 text-xs text-muted">{m.author}</div>}
                <div className="flex items-start gap-2">
                  <Disc initials={m.initials} tone={m.tone} size="sm" />
                  <span className="rounded-lg bg-raised px-3 py-2 text-[13px] leading-relaxed text-foreground">
                    {m.segments.map((s, j) => (
                      <span key={j} className={s.gold ? "text-gold" : undefined}>
                        {s.text}
                      </span>
                    ))}
                  </span>
                  {m.pill && (
                    <span className="mt-1.5 shrink-0 rounded border border-gold/50 px-1.5 py-0.5 text-[11px] text-gold">
                      {m.pill}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="relative flex flex-col gap-4">
          <AgentCard agent="Agent: implementer" member="the-reviewer">
            Fix applied. Rerunning security tests.
          </AgentCard>
          <div className="rounded-xl border border-line bg-surface p-4">
            <div className="text-sm font-semibold text-foreground">Implementation</div>
            <div className="mt-2 text-sm leading-relaxed text-muted">
              Fix applied: user input validation <span className="text-accent">&gt; diff</span>
            </div>
          </div>
          <span aria-hidden className="absolute -left-4 top-1/4 hidden h-16 w-4 rounded-l border-y-2 border-l-2 border-gold/60 lg:block" />
        </div>
      </div>

      {/* Session history: the run's approval trail */}
      <div className="mt-4 rounded-xl border border-line bg-surface/40 p-4">
        <h4
          className="mb-3 text-sm font-semibold text-foreground"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Session History
        </h4>
        <ol className="flex items-stretch gap-2 overflow-x-auto">
          {TIMELINE.map((s, i) => (
            <li key={s.label} className="flex min-w-[130px] flex-1 items-stretch gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                  {s.done && <IconCheck size={15} className="shrink-0 text-ok" aria-label="resolved" />}
                  {s.label}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                  {s.time}
                  {s.pill && (
                    <span className="rounded border border-gold/50 px-1.5 py-px text-[11px] text-gold">
                      {s.pill}
                    </span>
                  )}
                </div>
              </div>
              {i < TIMELINE.length - 1 && (
                <span aria-hidden className="self-center text-gold/60">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
