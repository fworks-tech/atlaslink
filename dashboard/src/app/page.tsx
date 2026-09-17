import Link from "next/link";
import { IconEye, IconGitFork, IconShieldCheck, IconWallet } from "@tabler/icons-react";
import FadeIn from "@/components/FadeIn";
import LandingCanvas from "@/components/LandingCanvas";
import AskTerminal from "@/components/AskTerminal";

/**
 * Marketing surface for visitors — the app lives at /atlas (spec:
 * docs/spec/auth-app-flow.md). Atlas identity: deep navy, violet + gold,
 * Space Grotesk display type, the giant watermark, and a live choreography
 * of an actual session as the hero. Deliberately NOT agenthood-site's
 * structure: no stats bar, no members grid, no 3-step "how it works".
 */

const collab = [
  {
    title: "One room, one run",
    body: "Humans and agents share a live session — presence, typing indicators, delivery receipts. You see members thinking while they think.",
  },
  {
    title: "Steer mid-flight",
    body: "Redirect a running session without killing it, rewrite a queued prompt, or interrupt entirely. The room reacts instantly.",
  },
  {
    title: "Nothing acts unapproved",
    body: "When Atlas asks — apply the fix? call this tool? — the room waits on you. Approve, reject, or reply in place.",
  },
];

const evidence = [
  { icon: IconEye, label: "Live DAG", desc: "sessions, members, reasoning and tools as one diagram" },
  { icon: IconShieldCheck, label: "Human-in-the-loop", desc: "approval gates are part of the protocol, not a plugin" },
  { icon: IconGitFork, label: "Your providers", desc: "per-session provider and model picks, fast-failed if unknown" },
  { icon: IconWallet, label: "Honest costs", desc: "LLM spend rolled up per agent, per day — in the open" },
];

export default function LandingPage() {
  return (
    <main className="font-sans">
      {/* Hero — watermark + display type + live canvas */}
      <section>
        <div className="mx-auto max-w-6xl px-6 pb-16 pt-14 sm:pt-20">
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.15fr]">
            <FadeIn>
              <span className="mb-5 inline-block rounded-full border border-gold/40 px-3 py-1 text-xs uppercase tracking-widest text-gold">
                humans + agents · one room · live
              </span>
              <h1
                className="text-5xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-6xl"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Ask Atlas.
                <br />
                <span className="text-muted">Together, live.</span>
              </h1>
              <p className="mt-5 max-w-md text-lg leading-relaxed text-muted">
                See how agents and humans solve it — in the same room, in real
                time. Chat, delegate, steer, approve. Every step visible the
                moment it happens.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href="/atlas"
                  className="inline-block rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90"
                >
                  Open Atlas — live demo
                </Link>
                <Link
                  href="/login"
                  className="inline-block rounded-lg border border-line px-6 py-3 text-sm font-medium text-foreground transition-colors hover:border-accent/40"
                >
                  My Atlas — sign in
                </Link>
              </div>
            </FadeIn>

            <FadeIn delay={150}>
              <LandingCanvas />
            </FadeIn>
          </div>
        </div>
      </section>

      {/* The room — what live collaboration means here */}
      <FadeIn>
        <section className="border-y border-line bg-surface/40">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2
              className="mb-3 text-3xl font-semibold text-foreground"
              style={{ fontFamily: "var(--font-display)" }}
            >
              The room, not the queue.
            </h2>
            <p className="mb-10 max-w-2xl leading-relaxed text-muted">
              You don&apos;t file a ticket and wait. You&apos;re in the room while it
              runs — presence, typing, receipts, and the steering wheel when
              you want it.
            </p>
            <div className="grid gap-5 md:grid-cols-3">
              {collab.map((c) => (
                <div key={c.title} className="rounded-xl border border-line bg-surface/70 p-5">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="h-2 w-2 animate-[pulse-gold_1.6s_ease-in-out_infinite] rounded-full bg-gold" />
                    <h3 className="font-semibold text-foreground" style={{ fontFamily: "var(--font-display)" }}>{c.title}</h3>
                  </div>
                  <p className="text-sm leading-relaxed text-muted">{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </FadeIn>

      {/* Evidence band */}
      <FadeIn>
        <section className="mx-auto max-w-6xl px-6 py-16">
          <h2
            className="mb-3 text-3xl font-semibold text-foreground"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Every step, on the record.
          </h2>
          <p className="mb-10 max-w-2xl leading-relaxed text-muted">
            Sessions are durable events, not chat scrollback. Reasoning,
            decisions, tool calls and costs — inspectable after the fact,
            shareable with one link.
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {evidence.map((f) => (
              <div key={f.label} className="rounded-xl border border-line bg-surface/50 p-5">
                <f.icon size={24} className="mb-3 text-accent" />
                <div className="text-sm font-semibold text-foreground">{f.label}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted">{f.desc}</div>
              </div>
            ))}
          </div>
        </section>
      </FadeIn>

      {/* Final CTA — the terminal speaks for itself */}
      <FadeIn>
        <section>
          <div className="mx-auto max-w-6xl px-6 pb-24 pt-12 text-center">
            <h2
              className="mb-4 text-4xl font-semibold text-foreground"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Hand it to the room.
            </h2>
            <p className="mx-auto mb-8 max-w-lg text-muted">
              Watch the room earn it — live — or claim your own Atlas with
              your projects, your sessions, your costs.
            </p>
            <div className="mx-auto mb-10 max-w-2xl">
              <AskTerminal />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/atlas"
                className="inline-block rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90"
              >
                Open Atlas
              </Link>
              <Link
                href="/login"
                className="inline-block rounded-lg border border-line px-6 py-3 text-sm font-medium text-foreground transition-colors hover:border-accent/40"
              >
                Create your Atlas
              </Link>
            </div>
          </div>
        </section>
      </FadeIn>
    </main>
  );
}
