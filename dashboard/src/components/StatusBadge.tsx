import type { SessionStatus } from "@/lib/types";

const STATUS_STYLE: Record<SessionStatus, string> = {
  queued: "border-warn/30 bg-warn/15 text-warn",
  running: "border-accent/30 bg-accent/15 text-accent",
  awaiting_input: "border-accent/30 bg-accent/10 text-accent animate-pulse",
  succeeded: "border-ok/30 bg-ok/15 text-ok",
  failed: "border-danger/30 bg-danger/15 text-danger",
  cancelled: "border-white/10 bg-white/10 text-muted",
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}