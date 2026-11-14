"use client";

/**
 * Initial-disc avatar shared by the landing storyboard surfaces (hero canvas
 * presence + Live Shared Room card). Zero image assets, zero external
 * requests — humans read gold, agents read accent.
 */
export default function Disc({ initials, tone, size = "md" }: { initials: string; tone: "human" | "agent"; size?: "md" | "sm" }) {
  const dims = size === "md" ? "h-9 w-9 text-xs" : "h-7 w-7 text-[10px]";
  const palette =
    tone === "human"
      ? "border-gold/50 bg-gold/10 text-gold"
      : "border-accent/50 bg-accent/10 text-accent";
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full border font-semibold ${dims} ${palette}`}
    >
      {initials}
    </span>
  );
}
