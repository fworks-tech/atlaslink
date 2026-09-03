"use client";

import { Handle, NodeResizer, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { Session } from "@/lib/types";

export function TerminalNode(props: NodeProps) {
  const data = props.data as { session: Session };
  const ok = data.session.status === "succeeded";
  return (
    <>
      <NodeResizer isVisible={props.selected} minWidth={128} minHeight={40} color={ok ? "#34d399" : "#f87171"} />
      <div className={`flex w-full min-w-32 items-center justify-center gap-1.5 overflow-hidden rounded-full border px-3 py-1.5 shadow-lg ${ok ? "border-ok/60 bg-ok/10 text-ok" : "border-danger/60 bg-danger/10 text-danger"}`}>
        <Handle type="target" position={Position.Top} className="!bg-white/30" />
        <span className="text-sm">{ok ? "✔" : "✖"}</span>
        <span title={data.session.status} className="truncate text-[11px] font-medium">{ok ? "succeeded" : data.session.status}</span>
        <Handle type="source" position={Position.Bottom} className="!bg-white/20" />
      </div>
    </>
  );
}
