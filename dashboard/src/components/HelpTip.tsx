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
          className="cursor-help inline-flex items-center justify-center rounded-full border border-zinc-700 px-1.5 text-[10px] leading-4 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 transition-colors select-none"
          aria-label={`Help: ${text}`}
        >
          ?
        </span>
      </Tooltip>
    </span>
  );
}
