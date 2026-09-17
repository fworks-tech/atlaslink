"use client";

import { Tooltip } from "@mantine/core";

interface HelpTipProps {
  text: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

export default function HelpTip({ text, side = "top", className = "" }: HelpTipProps) {
  return (
    <span className={className}>
      <Tooltip label={text} position={side} withArrow openDelay={300}>
        <span
          className="cursor-help inline-flex items-center justify-center rounded-full border border-line px-1.5 text-[10px] leading-4 text-muted hover:text-foreground hover:border-line transition-colors select-none"
          aria-label={`Help: ${text}`}
        >
          ?
        </span>
      </Tooltip>
    </span>
  );
}
