"use client";

import { AGENT_PALETTE } from "@/lib/draftFlow";

export const DRAG_MIME = "application/atlaslink-agent";

export function NodePalette() {
  return (
    <div aria-label="Agent palette" className="flex flex-wrap gap-2">
      {AGENT_PALETTE.map((agent) => (
        <div
          key={agent.type}
          role="listitem"
          aria-label={`Add ${agent.label} node`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_MIME, agent.type);
            e.dataTransfer.effectAllowed = "copy";
          }}
          className="cursor-grab rounded-md border border-white/10 bg-raised px-3 py-1.5 text-xs text-foreground active:cursor-grabbing"
        >
          + {agent.label}
        </div>
      ))}
    </div>
  );
}
