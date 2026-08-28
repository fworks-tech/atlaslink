"use client";

import { useEvents } from "@/hooks/useEvents";
import type { ConnectionState } from "@/hooks/useEvents";

const STATE_LABEL: Record<ConnectionState, { text: string; dot: string }> = {
  connecting: { text: "connecting…", dot: "bg-warn" },
  connected: { text: "connected", dot: "bg-ok" },
  disconnected: { text: "reconnecting…", dot: "bg-danger" },
};

export function ConnectionStatus() {
  const { connection, events } = useEvents();
  const state = STATE_LABEL[connection];
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${state.dot}`} />
        {state.text}
      </span>
      <span className="font-mono text-muted">{events.length} events</span>
    </div>
  );
}