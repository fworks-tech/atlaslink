"use client";

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { Session } from "@/lib/types";

export function TerminalNode(props: NodeProps) {
  const data = props.data as { session: Session };
  const ok = data.session.status === "succeeded";
  return (
    <div className={`flex w-32 items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 shadow-lg ${ok ? "border-ok/60 bg-ok/10 text-ok" : "border-danger/60 bg-danger/10 text-danger"}`}>
      <Handle type="target" position={Position.Top} className="!bg-white/30" />
      <span className="text-sm">{ok ? "✔" : "✖"}</span>
      <span className="text-[11px] font-medium">{ok ? "succeeded" : data.session.status}</span>
      <Handle type="source" position={Position.Bottom} className="!bg-white/20" />
    </div>
  );
}
