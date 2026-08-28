"use client";

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { MemberGraphNode } from "@/lib/graph";

/** One member who held the podium for a session; pulses while it runs. */
export function MemberNode({ data }: NodeProps<MemberGraphNode>) {
  const { member, active } = data;
  const dot = active ? "bg-ok animate-pulse" : "bg-muted/50";
  return (
    <div
      className={`flex w-32 items-center gap-1.5 rounded-full border bg-raised px-3 py-1.5 shadow-lg ${
        active ? "border-ok/60" : "border-white/10"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-white/30" />
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <span className={`truncate text-[11px] ${active ? "text-ok" : "text-foreground/80"}`}>
        {member.replace(/^the-/, "")}
      </span>
      <Handle type="source" position={Position.Bottom} className="!bg-accent/60" />
    </div>
  );
}