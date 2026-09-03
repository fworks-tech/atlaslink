"use client";

import { Handle, NodeResizer, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { BridgeEvent } from "@/lib/types";

export function ToolNode(props: NodeProps) {
  const data = props.data as { pair: { called: BridgeEvent; result: BridgeEvent | null }; sessionId: string };
  const name = typeof data.pair.called.name === "string" ? (data.pair.called.name as string) : "tool";
  const hasResult = data.pair.result !== null;
  return (
    <>
      <NodeResizer isVisible={props.selected} minWidth={140} minHeight={46} color="#38bdf8" />
      <div className="w-full min-w-[160px] overflow-hidden border border-sky-400/30 bg-sky-500/10 p-2.5 shadow-lg" style={{ clipPath: "polygon(10% 0,100% 0,90% 100%,0 100%)" }}>
        <Handle type="target" position={Position.Top} className="!bg-white/30" />
        <div className="flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-widest text-sky-300">tool</span>
          <span className={`h-1.5 w-1.5 rounded-full ${hasResult ? "bg-ok" : "bg-amber-400 animate-pulse"}`} />
        </div>
        <div title={name} className="mt-1 truncate text-[11px] font-medium text-foreground">{name}</div>
        <div className="text-[10px] text-muted">{hasResult ? "✓ result" : "running…"}</div>
        <Handle type="source" position={Position.Bottom} className="!bg-sky-400/60" />
      </div>
    </>
  );
}
