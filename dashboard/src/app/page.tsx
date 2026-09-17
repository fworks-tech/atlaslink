import Link from "next/link";
import { IconEye, IconGitFork, IconShieldCheck, IconWallet } from "@tabler/icons-react";
import FadeIn from "@/components/FadeIn";

/**
 * Marketing surface for visitors — the app lives at /atlas (spec:
 * docs/spec/auth-app-flow.md). Server component; only FadeIn is a client
 * island. Member list is a curated snapshot of the Agenthood registry.
 */

const stats = [
  { value: "20", label: "specialized members", tip: "The full Agenthood society — architect, builder, reviewer, auditor, and more." },
  { value: "1", label: "live provenance graph", tip: "Every delegation, decision and tool call streams into one sky of sessions." },
  { value: "0", label: "hidden steps", tip: "Every step is a durable event — reasoning, tools, decisions, costs." },
];

const features = [
  { icon: IconEye, label: "Live society diagram", desc: "watch sessions unfold as a DAG — reasoning, tools, decisions", tip: "Atlas holds the sky of sessions: every card is clickable evidence." },
  { icon: IconShieldCheck, label: "Human-in-the-loop", desc: "approve or reject tool calls and answers mid-run", tip: "The room waits for you before acting — approval gates are first-class." },
  { icon: IconGitFork, label: "Providers + models", desc: "per-session provider and model picks", tip: "Pick opencode-go, groq, and more — the daemon fast-fails on unknown picks." },
  { icon: IconWallet, label: "Cost tracking", desc: "LLM spend rolled up per agent and per day", tip: "Durable daily cost buckets — see exactly what a session cost." },
];

const steps = [
  { step: "01", title: "Hand Atlas a task", body: "Describe the problem in the composer. The mediator delegates to the right members." },
  { step: "02", title: "Watch the sky", body: "A live DAG of the society at work — every reasoning step, tool call and decision as it happens." },
  { step: "03", title: "Inspect and steer", body: "Click any card for evidence. Steer mid-run, approve tool calls, or interrupt — then share the link." },
];

const members = [
  { group: "Plan & build", items: ["the-architect · specs and ADRs", "the-builder · smallest verified change", "the-strategist · goals into specs", "the-scribe · commits and PRs"] },
  { group: "Review & secure", items: ["the-reviewer · five-axis review", "the-auditor · assumes breach", "the-warden · smells and complexity", "the-sentinel · society integrity"] },
  { group: "Run & operate", items: ["the-operator · deploys and incidents", "the-doorman · validation gates", "the-warden · boundary enforcement", "the-debugger · root causes"] },
  { group: "Coordinate", items: ["the-mediator · intent routing", "the-steward · context economy", "the-oracle · institutional knowledge", "the-herald · releases"] },
];

export default function LandingPage() {
  return (
    <main>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-16 text-center sm:pt-24">
        <FadeIn>
          <span className="mb-6 inline-block rounded-full border border-line px-3 py-1 text-xs uppercase tracking-widest text-muted">
            Live provenance · AI dev tools
          </span>
          <h1 className="mb-6 text-5xl font-semibold leading-tight tracking-tight text-foreground md:text-6xl">
            Atlas holds the sky
            <br />
            <span className="text-muted">of sessions.</span>
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-xl leading-relaxed text-muted">
            Atlaslink is the live provenance view of the Agenthood society — a 20-member AI team
            that plans, builds, reviews and audits. Watch every session unfold as a diagram:
            reasoning, tools, decisions, costs. Nothing hidden.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
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
      </section>

      {/* Stats bar */}
      <section className="border-y border-line bg-surface/50">
        <div className="mx-auto grid max-w-6xl grid-cols-1 divide-y px-6 py-8 text-center sm:grid-cols-3 sm:divide-x sm:divide-y-0" style={{ borderColor: "var(--line)" }}>
          {stats.map((s) => (
            <div key={s.label} className="px-6 py-4 sm:py-0" title={s.tip}>
              <div className="text-3xl font-semibold text-foreground">{s.value}</div>
              <div className="mt-1 text-sm text-muted">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Preview band */}
      <FadeIn>
        <section className="border-y border-line bg-gradient-to-b from-surface/30 to-transparent">
          <div className="mx-auto max-w-6xl px-6 py-20 text-center">
            <h2 className="mb-4 text-3xl font-semibold text-foreground">Watch the Society work</h2>
            <p className="mx-auto mb-8 max-w-2xl leading-relaxed text-muted">
              Open the live diagram, hand over a task, and watch members collaborate in
              real time. No install, no setup.
            </p>
            <div className="mb-10 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/atlas"
                className="inline-block rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90"
              >
                Open the live diagram
              </Link>
              <Link
                href="/cost"
                className="inline-block rounded-lg border border-line px-6 py-3 text-sm font-medium text-muted transition-colors hover:text-foreground"
              >
                See live cost rollups
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {features.map((f) => (
                <div key={f.label} className="rounded-xl border border-line bg-surface/50 p-5 text-left" title={f.tip}>
                  <f.icon size={26} className="mb-3 text-accent" />
                  <div className="mb-1.5 text-sm font-semibold text-foreground">{f.label}</div>
                  <div className="text-xs leading-relaxed text-muted">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </FadeIn>

      {/* Members grid */}
      <FadeIn>
        <section id="members" className="mx-auto max-w-6xl px-6 pb-12 pt-8">
          <h2 className="mb-4 text-3xl font-semibold text-foreground">Meet the team</h2>
          <p className="mb-12 max-w-2xl text-muted">
            Every role a real software team needs — each one a skill file with
            impeccable standards, running on your providers.
          </p>
          <div className="grid gap-6 sm:grid-cols-2">
            {members.map((m) => (
              <div key={m.group} className="rounded-xl border border-line bg-surface/50 p-5">
                <div className="mb-3 flex items-center gap-2">
                  <div className="h-5 w-1 rounded-full bg-accent" />
                  <h3 className="font-semibold text-foreground">{m.group}</h3>
                </div>
                <ul className="space-y-1.5 text-xs leading-relaxed text-muted">
                  {m.items.map((i) => (
                    <li key={i} className="font-mono">{i}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </FadeIn>

      {/* How it works */}
      <FadeIn>
        <section id="how" className="mx-auto max-w-6xl px-6 py-10">
          <h2 className="mb-4 text-3xl font-semibold text-foreground">How it works</h2>
          <p className="mb-12 max-w-2xl text-muted">
            Atlaslink is the dashboard of the Agenthood — sessions run through a durable
            event log, projected live into the diagram, and mirrored into per-user tenants
            when you sign in.
          </p>
          <div className="relative grid gap-6 md:grid-cols-3">
            <div className="absolute left-[17%] right-[17%] top-8 hidden h-px bg-line md:block" />
            {steps.map((s) => (
              <div key={s.step} className="relative rounded-xl border border-line border-l-2 border-l-accent bg-surface/50 p-6">
                <div className="mb-3 font-mono text-xl font-bold text-accent">{s.step}</div>
                <div className="mb-2 font-medium text-foreground">{s.title}</div>
                <div className="text-sm leading-relaxed text-muted">{s.body}</div>
              </div>
            ))}
          </div>
        </section>
      </FadeIn>

      {/* Final CTA */}
      <FadeIn>
        <section className="mx-auto max-w-6xl px-6 pb-24 pt-10 text-center">
          <h2 className="mb-4 text-3xl font-semibold text-foreground">Your task deserves a full team.</h2>
          <p className="mx-auto mb-8 max-w-xl text-muted">
            Open the demo and watch the Society earn it — or claim your own Atlas.
          </p>
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
        </section>
      </FadeIn>
    </main>
  );
}
