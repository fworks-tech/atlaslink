const FLOW: {
  initials: string;
  name: string;
  role: string;
  state: "passed" | "running" | "waiting";
}[] = [
  { initials: "MED", name: "The Mediator", role: "route the request", state: "passed" },
  { initials: "DBG", name: "The Debugger", role: "root-cause the bug", state: "passed" },
  { initials: "BLD", name: "The Builder", role: "patch the guard", state: "running" },
  { initials: "TST", name: "The Tester", role: "regression coverage", state: "waiting" },
  { initials: "REV", name: "The Reviewer", role: "approve the diff", state: "waiting" },
];

const STATE_STYLES = {
  passed: "border-ok/40 text-ok",
  running: "border-accent/40 text-accent",
  waiting: "border-white/10 text-muted",
} as const;

const LEGEND = [
  { label: "running", dot: "bg-accent" },
  { label: "passed", dot: "bg-ok" },
  { label: "failed", dot: "bg-danger" },
  { label: "waiting", dot: "bg-white/15" },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-12">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Live Society Diagram
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Atlas holds the sky of sessions. Each session is a delegation graph the
          event bridge renders in real time — this page will stream it live from
          <code className="font-mono text-accent"> /api/events</code>.
        </p>
      </header>

      <section className="rounded-xl border border-white/5 bg-surface p-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="text-xs uppercase tracking-widest text-muted">
            sample flow
          </div>
          <div className="flex items-center gap-4 text-xs text-muted">
            {LEGEND.map((entry) => (
              <span key={entry.label} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${entry.dot}`} />
                {entry.label}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-center">
          <div className="w-64 rounded-lg border border-accent/30 bg-raised px-4 py-3 text-center">
            <div className="text-xs uppercase tracking-widest text-accent">Atlas</div>
            <div className="mt-1 text-sm text-muted">root node · bearer of sessions</div>
          </div>

          <div className="my-3 h-6 w-px bg-white/10" />

          <div className="w-72 rounded-lg border border-white/10 bg-raised px-4 py-3 text-center">
            <div className="flex items-center justify-center gap-2">
              <span className="text-xs text-muted">session</span>
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
                running
              </span>
            </div>
            <div className="mt-1.5 text-sm text-foreground">
              Fix issue #42 — login redirects to /dashboard
            </div>
          </div>

          <div className="my-3 h-6 w-px bg-white/10" />

          <div className="flex flex-wrap items-start justify-center gap-4">
            {FLOW.map((n, i) => (
              <div key={n.name} className="flex items-start gap-4">
                <div className="flex w-36 flex-col items-center gap-2">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-xl border bg-surface text-xs font-bold tracking-wider ${STATE_STYLES[n.state]}`}
                  >
                    {n.initials}
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-medium text-foreground">{n.name}</div>
                    <div className="mt-0.5 text-xs text-muted">{n.role}</div>
                  </div>
                </div>
                {i < FLOW.length - 1 && (
                  <div className="mt-6 text-muted" aria-hidden>
                    →
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <p className="mt-6 border-t border-white/5 pt-4 text-xs leading-5 text-muted">
          Preview of the M4 sample flow: “fix issue X” delegates route → triage →
          build → test → review. Live nodes and edges land in the next milestone —
          driven by the same SSE stream the backend already serves.
        </p>
      </section>
    </div>
  );
}