"use client";

import { useEffect, useState } from "react";
import Disc from "./room/Disc";
import LiveBadge from "./room/LiveBadge";

/**
 * Scripted choreography of a real Atlaslink session: a human asks, Atlas
 * delegates, a member reasons and calls a tool, Atlas asks for approval, the
 * human approves, the run succeeds — looping forever. Hand-built so the
 * landing stays light: percentage-anchored cards + an SVG edge layer with a
 * moving signal dot, driven by one timeline state. Reduced motion users get
 * the static end state via the global kill-switch.
 */

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** x/y in % of the canvas — every card anchors by center. Human and ask sit
 *  slightly inward so their cards clear the canvas edge and each other on
 *  narrow screens (cards shrink below sm, positions stay put). */
const NODES = {
  human: { x: 16, y: 16, label: "you · live", role: "Review my PR for security holes", tone: "gold", kind: "human" },
  atlas: { x: 48, y: 14, label: "ATLAS", role: "root · bearer of sessions", tone: "accent", kind: "agent" },
  member: { x: 80, y: 30, label: "the-reviewer", role: "five-axis review", tone: "accent", kind: "agent" },
  tool: { x: 76, y: 58, label: "tool · grep", role: "3 matches", tone: "accent", kind: "plain" },
  ask: { x: 38, y: 56, label: "Atlas asks", role: "Apply the suggested fix?", tone: "gold", kind: "plain" },
  done: { x: 16, y: 82, label: "session.succeeded", role: "3 members · 1 human · $0.04", tone: "ok", kind: "plain" },
} as const;

const EDGES: Array<{ from: keyof typeof NODES; to: keyof typeof NODES; showFrom: Step }> = [
  { from: "human", to: "atlas", showFrom: 1 },
  { from: "atlas", to: "member", showFrom: 2 },
  { from: "member", to: "tool", showFrom: 3 },
  { from: "tool", to: "ask", showFrom: 4 },
  { from: "ask", to: "done", showFrom: 6 },
];

const STEP_MS = 1900;
const HOLD_MS = 2800;
const CYCLE_MS = STEP_MS * 7 + HOLD_MS;

function useTimeline(): Step {
  const [step, setStep] = useState<Step>(0);
  useEffect(() => {
    // elapsed-driven so the loop is deterministic and never stalls at step 0
    const started = Date.now();
    const id = setInterval(() => {
      const elapsed = (Date.now() - started) % CYCLE_MS;
      setStep(Math.min(Math.floor(elapsed / STEP_MS), 6) as Step);
    }, 120);
    return () => clearInterval(id);
  }, []);
  return step;
}

type NodeTone = "accent" | "ok" | "gold";

/** Compact agent-card language shared with the Live Shared Room card: humans
 *  get an initial-disc row, agents an AI badge, system nodes stay two-line. */
function NodeCard({ x, y, label, role, tone, kind }: { x: number; y: number; label: string; role: string; tone: NodeTone; kind: "human" | "agent" | "plain" }) {
  const border = tone === "ok" ? "border-ok/40" : tone === "gold" ? "border-gold/50" : "border-accent/50";
  return (
    <div
      className={`absolute w-28 max-w-[40%] -translate-x-1/2 -translate-y-1/2 animate-[pop-in_.5s_ease-out_forwards] rounded-xl border ${border} bg-surface px-2.5 py-2 shadow-lg sm:w-40 sm:max-w-[46%] sm:px-3`}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      {kind === "human" ? (
        <div className="flex items-center gap-1.5">
          <Disc initials="you" tone="human" size="sm" />
          <div className="text-xs font-semibold text-foreground sm:text-sm" style={{ fontFamily: "var(--font-display)" }}>{label}</div>
        </div>
      ) : kind === "agent" ? (
        <div className="flex items-center gap-1.5">
          <span className="rounded-md bg-accent/15 px-1 py-px text-[10px] font-bold text-accent sm:text-[11px]">AI</span>
          <div className="truncate text-xs font-semibold text-foreground sm:text-sm" style={{ fontFamily: "var(--font-display)" }}>{label}</div>
        </div>
      ) : (
        <div className="text-xs font-semibold text-foreground sm:text-sm" style={{ fontFamily: "var(--font-display)" }}>{label}</div>
      )}
      <div className="mt-0.5 text-[10px] leading-snug text-muted sm:text-[11px]">{role}</div>
    </div>
  );
}

export default function LandingCanvas() {
  const step = useTimeline();

  return (
    <div
      data-testid="landing-canvas"
      role="img"
      aria-label="A shared room session: you ask for a PR review, Atlas delegates to the-reviewer, a grep tool finds matches, Atlas asks for approval, you approve, the session succeeds"
      className="relative h-[520px] w-full overflow-hidden rounded-2xl border border-line bg-surface/60 sm:h-[440px]"
    >
      {/* edge layer */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {EDGES.map((e) => {
          if (step < e.showFrom) return null;
          const a = NODES[e.from];
          const b = NODES[e.to];
          const d = `M ${a.x} ${a.y} C ${a.x} ${(a.y + b.y) / 2}, ${b.x} ${(a.y + b.y) / 2}, ${b.x} ${b.y}`;
          return (
            <g key={`${e.from}-${e.to}`}>
              <path d={d} fill="none" stroke="var(--accent)" strokeOpacity={0.5} strokeWidth={0.4} strokeDasharray="1.6 1.6" vectorEffect="non-scaling-stroke" />
              <circle r={0.8} fill="var(--gold)">
                <animateMotion dur="2.6s" repeatCount="indefinite" path={d} />
              </circle>
            </g>
          );
        })}
      </svg>

      {step >= 0 && <NodeCard {...NODES.human} />}
      {step >= 1 && <NodeCard {...NODES.atlas} />}
      {step >= 2 && <NodeCard {...NODES.member} />}
      {step >= 3 && <NodeCard {...NODES.tool} />}
      {step >= 4 && (
        <div
          className="absolute w-36 max-w-[44%] -translate-x-1/2 -translate-y-1/2 animate-[pop-in_.5s_ease-out_forwards] rounded-xl border border-gold/60 bg-surface px-2.5 py-2 shadow-lg sm:w-44 sm:max-w-[46%] sm:px-3"
          style={{ left: `${NODES.ask.x}%`, top: `${NODES.ask.y}%` }}
        >
          <div className="animate-[pulse-gold_1.5s_ease-in-out_infinite]">
            <div className="text-[10px] uppercase tracking-widest text-gold">Atlas asks · waiting on you</div>
            <div className="mt-0.5 text-xs text-foreground sm:text-sm">Apply the suggested fix?</div>
            <div className="mt-2 flex gap-2 text-[11px]">
              <span className="rounded border border-gold/50 px-2.5 py-1 font-medium text-gold">approve</span>
              <span className="rounded border border-line px-2.5 py-1 text-muted">reject</span>
            </div>
          </div>
        </div>
      )}
      {step >= 5 && (
        <div className="absolute left-[30%] top-[72%] animate-[pop-in_.4s_ease-out_forwards] text-[11px] text-gold">
          ✓ approved — run resumes
        </div>
      )}
      {step >= 6 && <NodeCard {...NODES.done} />}

      {/* the room is always alive */}
      <div className="absolute bottom-3 right-4 flex items-center gap-1.5 text-[11px] text-muted">
        <span className="h-1.5 w-1.5 animate-[pulse-gold_1.2s_ease-in-out_infinite] rounded-full bg-gold" />
        the-reviewer is typing
      </div>
      <div className="absolute left-4 top-3 flex items-center gap-2 text-[11px] text-muted">
        <span className="flex -space-x-1" aria-hidden>
          <Disc initials="you" tone="human" size="sm" />
          <Disc initials="AT" tone="agent" size="sm" />
        </span>
        <LiveBadge label="Live" />
        1 human · 2 agents in the room
      </div>
    </div>
  );
}
