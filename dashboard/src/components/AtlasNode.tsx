"use client";

import { Handle, Position } from "@xyflow/react";

/** The root node holding the sky of sessions (ADR-003). */
export function AtlasNode() {
  return (
    <div className="w-44 rounded-xl border border-accent/30 bg-raised px-4 py-3 text-center shadow-lg">
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <div className="text-xs uppercase tracking-widest text-accent">Atlas</div>
      <div className="mt-1 text-xs text-muted">root · bearer of sessions</div>
      <Handle type="source" position={Position.Bottom} className="!bg-accent" />
    </div>
  );
}