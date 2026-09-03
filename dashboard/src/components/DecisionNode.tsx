"use client";

import { Handle, NodeResizer, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { BridgeEvent } from "@/lib/types";

export function DecisionNode(props: NodeProps) {
  const data = props.data as { event: BridgeEvent; sessionId: string };
  const outcome = typeof (data.event as Record<string, unknown>).outcome === "string" ? String((data.event as Record<string, unknown>).outcome) : "decision";
  return (
    <>
      <NodeResizer isVisible={props.selected} minWidth={80} minHeight={80} keepAspectRatio color="#a78bfa" />
      <div className="flex min-h-[80px] w-full min-w-[80px] items-center justify-center overflow-hidden border border-violet-400/40 bg-violet-500/10 p-2 shadow-lg" style={{ clipPath: "polygon(50% 0,100% 50%,50% 100%,0 50%)" }}>
        <Handle type="target" position={Position.Top} className="!bg-white/30" />
        <div className="text-center">
          <div className="text-[8px] uppercase tracking-widest text-violet-300">decision</div>
          <div title={outcome} className="mt-0.5 line-clamp-2 text-[10px] leading-tight break-words text-foreground">{outcome.slice(0, 40)}</div>
        </div>
        <Handle type="source" position={Position.Bottom} className="!bg-violet-400/60" />
      </div>
    </>
  );
}
