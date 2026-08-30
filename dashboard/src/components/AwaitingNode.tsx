"use client";

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { Session } from "@/lib/types";

export function AwaitingNode(props: NodeProps) {
  const data = props.data as { session: Session };
  const prompt = data.session.nextStep?.prompt ?? "Awaiting input…";
  return (
    <div className="w-[260px] rounded-[18px] border border-dashed border-accent/60 bg-raised p-3 shadow-lg animate-[pulse_2s_ease-in-out_infinite]">
      <Handle type="target" position={Position.Top} className="!bg-accent/60" />
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-accent">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        awaiting input
      </div>
      <div className="mt-1.5 text-xs leading-snug text-foreground">{prompt.slice(0, 160)}</div>
      <div className="mt-2 text-[10px] text-muted">Reply in the thread below — the diagram will grow.</div>
      <Handle type="source" position={Position.Bottom} className="!bg-accent/40" />
    </div>
  );
}
