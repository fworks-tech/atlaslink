"use client";

import { Handle, NodeResizer, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { Session } from "@/lib/types";

export function AwaitingNode(props: NodeProps) {
  const data = props.data as { session: Session };
  const prompt = data.session.nextStep?.prompt ?? "Awaiting input…";
  return (
    <>
      <NodeResizer isVisible={props.selected} minWidth={260} minHeight={92} color="#60a5fa" />
      <div className="w-full min-w-[260px] overflow-hidden rounded-[18px] border border-dashed border-accent/60 bg-raised p-3 shadow-lg animate-[pulse_2s_ease-in-out_infinite]">
        <Handle type="target" position={Position.Top} className="!bg-accent/60" />
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-accent">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          awaiting input
        </div>
        <div title={prompt} className="mt-1.5 line-clamp-4 text-xs leading-snug break-words text-foreground">{prompt.slice(0, 160)}</div>
        <div className="mt-2 text-[10px] text-muted">Reply in the thread below — the diagram will grow.</div>
        <Handle type="source" position={Position.Bottom} className="!bg-accent/40" />
      </div>
    </>
  );
}
