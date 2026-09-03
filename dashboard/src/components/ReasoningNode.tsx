"use client";

import { Handle, NodeResizer, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { BridgeEvent } from "@/lib/types";

export function ReasoningNode(props: NodeProps) {
  const data = props.data as { sessionId: string; step: number; events: BridgeEvent[] };
  const first = data.events[0];
  const content = typeof first.content === "string" ? (first.content as string) : typeof first.text === "string" ? (first.text as string) : "reasoning";
  const summary = typeof (first as Record<string, unknown>).summary === "string" ? (first as Record<string, unknown>).summary as string : undefined;
  return (
    <>
      <NodeResizer isVisible={props.selected} minWidth={140} minHeight={46} color="#fbbf24" />
      <div
        className="w-full min-w-[160px] overflow-hidden border border-amber-400/30 bg-amber-500/10 p-2.5 shadow-lg"
        style={{ clipPath: "polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)" }}
      >
        <Handle type="target" position={Position.Top} className="!bg-white/30" />
        <div className="text-[9px] uppercase tracking-widest text-amber-300">reasoning · step {data.step}</div>
        <div title={content} className="mt-1 line-clamp-2 text-[11px] leading-snug break-words text-foreground">{content.slice(0, 120)}</div>
        {summary && <div title={summary} className="mt-1 truncate text-[10px] text-muted">↳ {summary.slice(0, 80)}</div>}
        <Handle type="source" position={Position.Bottom} className="!bg-amber-400/60" />
      </div>
    </>
  );
}
