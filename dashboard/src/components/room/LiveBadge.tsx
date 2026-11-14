"use client";

/**
 * Gold "Live" pill shared by the landing storyboard surfaces. The pulse is
 * covered by the global reduced-motion kill-switch in globals.css.
 */
export default function LiveBadge({ label = "Live" }: { label?: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-gold/10 px-3 py-1 text-xs font-medium text-gold">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
      {label}
    </span>
  );
}
