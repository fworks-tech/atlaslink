"use client";

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { StatusBadge } from "@/components/StatusBadge";
import type { SessionGraphNode } from "@/lib/graph";

/** One delegation map hanging from Atlas: prompt, live status, member chain. */
export function SessionNode({ data }: NodeProps<SessionGraphNode>) {
  const { session, members } = data;
  return (
    <div className="w-60 rounded-xl border border-white/10 bg-surface p-3 shadow-lg">
      <Handle type="target" position={Position.Top} className="!bg-white/30" />
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-muted">session</div>
        <StatusBadge status={session.status} />
      </div>
      <div className="mt-1.5 line-clamp-2 text-sm leading-snug text-foreground">
        {session.task.prompt}
      </div>
      <div className="mt-1 font-mono text-[10px] text-muted">
        {session.sessionId.slice(0, 14)}…
      </div>
      {members.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 border-t border-white/5 pt-2">
          {members.map((member) => (
            <span
              key={member}
              className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-accent"
            >
              {member.replace(/^the-/, "")}
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
}