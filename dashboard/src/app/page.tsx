import Link from "next/link";
import { IconEye, IconGitFork, IconShieldCheck, IconWallet } from "@tabler/icons-react";
import FadeIn from "@/components/FadeIn";
import LandingCanvas from "@/components/LandingCanvas";
import SharedRoomCard from "@/components/SharedRoomCard";

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
    title: "Approval gates keep you in the loop",
    body: "When a decision is required — apply the fix? call this tool? — the room waits on you. Approve, reject, or reply in place.",
  },
];

const evidence = [
  { icon: IconEye, label: "Live DAG", desc: "sessions, members, reasoning and tools as one diagram" },
  { icon: IconShieldCheck, label: "Human-in-the-loop", desc: "approval gates are part of the protocol, not a plugin" },
  { icon: IconGitFork, label: "Your providers", desc: "per-session provider and model picks, fast-failed if unknown" },
  { icon: IconWallet, label: "Costs by agent and day", desc: "LLM spend rolled up per agent, per day" },
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
                Bring people and AI agents into one shared session.
                Delegate work, follow what happens, steer a run, and make decisions
                together — without losing sight of the process.
              </p>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
                An experimental proof of concept built on{" "}
                <Link
                  href="https://github.com/fworks-tech/agenthood"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-accent/50 underline-offset-2 hover:text-foreground"
                >
                  Agenthood
                </Link>
                .
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
              Work alongside agents in a shared live session. See activity as it
              happens and step in when a decision is needed.
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
            Session activity, recorded for review.
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

      {/* Final CTA — hand the work to a shared room */}
      <FadeIn>
        <section>
          <div className="mx-auto max-w-6xl px-6 pb-24 pt-12 text-center">
            <h2
              className="mb-4 text-4xl font-semibold text-foreground sm:text-5xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Hand it to the room.
            </h2>
            <p className="mx-auto mb-8 max-w-2xl text-lg leading-relaxed text-muted">
              Hand a PR review to the room — humans and agents triage, fix, and
              verify together, with an approval gate at every decision.
            </p>
            <div className="mb-10 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/login"
                className="inline-block rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90"
              >
                Get Started
              </Link>
              <Link
                href="/atlas"
                className="inline-block rounded-lg border border-gold/60 px-6 py-3 text-sm font-medium text-foreground transition-colors hover:border-gold"
              >
                Request a Demo
              </Link>
            </div>
            <div className="text-left">
              <SharedRoomCard />
            </div>
          </div>
        </section>
      </FadeIn>
    </main>
  );
}
