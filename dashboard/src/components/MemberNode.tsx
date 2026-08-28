"use client";

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { MemberGraphNode } from "@/lib/graph";

/** One member who held the podium for a session; pulses while it runs. */
export function MemberNode({ data }: NodeProps<MemberGraphNode>) {
  const { member, active } = data;
  return (
    <div
      className={
        active
          ? "flex w-32 items-center gap-1.5 rounded-full border border-ok/60 bg-raised px-3 py-1.5 shadow-lg"
          : "flex w-32 items-center gap-1.5 rounded-full border border-white/10 bg-raised px-3 py-1.5 shadow-lg"
      }
    >
      <Handle type="target" position={Position.Top} className="!bg-white/30" />
      <span
        className={
          active ? "h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-ok" : "h-1.5 w-1.5 shrink-0 rounded-full bg-muted/50"
        }
      />
      <span className={`truncate text-[11px] ${active ? "text-ok" : "text-foreground/80"}`}>
        {member.replace(/^the-/, "")}
      </span>
      <Handle type="source" position={Position.Bottom} className="!bg-accent/60" />
    </div>
  );
}