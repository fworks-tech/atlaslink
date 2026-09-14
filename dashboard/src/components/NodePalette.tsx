"use client";

import { AGENT_PALETTE } from "@/lib/draftFlow";

export const DRAG_MIME = "application/atlaslink-agent";

export function NodePalette({ onSelect }: { onSelect?: (agentType: string) => void }) {
  return (
    <div aria-label="Agent palette" className="flex flex-wrap gap-2">
      {AGENT_PALETTE.map((agent) => (
        <button
          key={agent.type}
          type="button"
          aria-label={`Add ${agent.label} node`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_MIME, agent.type);
            e.dataTransfer.effectAllowed = "copy";
          }}
          // touch has no drag-and-drop — a tap drops the agent at the
          // canvas cascade position via the same draft path as a drop
          onClick={() => onSelect?.(agent.type)}
          className="min-h-[44px] cursor-grab rounded-md border border-white/10 bg-raised px-3 py-1.5 text-xs text-foreground active:cursor-grabbing"
        >
          + {agent.label}
        </button>
      ))}
    </div>
  );
}
