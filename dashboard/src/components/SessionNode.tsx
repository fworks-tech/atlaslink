"use client";

import { Handle, NodeResizer, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { StatusBadge } from "@/components/StatusBadge";
import type { SessionGraphNode } from "@/lib/graph";

/** One delegation map hanging from Atlas: prompt, live status, member chain. */
export function SessionNode({ data, selected }: NodeProps<SessionGraphNode>) {
  const { session, members } = data;
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={240} minHeight={100} color="#60a5fa" />
      <div className="w-full min-w-60 overflow-hidden rounded-xl border border-white/10 bg-surface p-3 shadow-lg">
        <Handle type="target" position={Position.Top} className="!bg-white/30" />
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-widest text-muted">session</div>
          <StatusBadge status={session.status} />
        </div>
        <div title={session.task.prompt} className="mt-1.5 line-clamp-2 text-sm leading-snug break-words text-foreground">
          {session.task.prompt}
        </div>
        <div className="mt-1 font-mono text-[10px] text-muted">
          {session.sessionId.slice(0, 14)}…
        </div>
        {members.length > 0 && (
          <div className="mt-1 font-mono text-[10px] text-accent">
            ↓ delegated × {members.length}
          </div>
        )}
        <Handle type="source" position={Position.Bottom} className="!bg-accent/60" />
      </div>
    </>
  );
}