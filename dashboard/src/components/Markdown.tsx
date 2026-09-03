"use client";

import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Studio parity (agenthood-site WorkspaceTurnCard): long payloads clamp with
// an expander instead of hard slices; raw HTML stays inert (no rehype-raw),
// so the no-dangerouslySetInnerHTML contract holds.
const MAX_CHARS = 2200;
const MAX_LINES = 50;

const mdComponents: Components = {
  h1: ({ children }) => <h1 className="text-sm font-semibold text-foreground">{children}</h1>,
  h2: ({ children }) => <h2 className="text-[13px] font-semibold text-foreground">{children}</h2>,
  h3: ({ children }) => <h3 className="text-xs font-semibold text-foreground">{children}</h3>,
  p: ({ children }) => <p className="my-1 leading-snug break-words whitespace-pre-wrap">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent underline">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-snug break-words whitespace-pre-wrap">{children}</li>,
  // block code arrives wrapped in pre; bare code is inline
  pre: ({ children }) => <pre className="max-h-[420px] overflow-auto rounded bg-black/40 p-2 font-mono text-[11px] leading-snug">{children}</pre>,
  code: ({ children }) => <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[11px] break-words">{children}</code>,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="my-1 w-full border-collapse text-[11px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-white/15 bg-white/5 px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-white/10 px-2 py-1 break-words">{children}</td>,
  blockquote: ({ children }) => <blockquote className="my-1 border-l-2 border-accent/50 pl-2 text-muted">{children}</blockquote>,
  hr: () => <hr className="my-2 border-white/10" />,
};

export function Markdown({ text, className }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const clippable = text.length > MAX_CHARS || lines.length > MAX_LINES;
  const shown = !expanded && clippable ? lines.slice(0, MAX_LINES).join("\n").slice(0, MAX_CHARS) : text;
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {shown}
      </ReactMarkdown>
      {clippable && !expanded && (
        <button type="button" onClick={() => setExpanded(true)} className="mt-1 text-xs text-accent hover:underline">
          View more
        </button>
      )}
      {clippable && expanded && (
        <button type="button" onClick={() => setExpanded(false)} className="mt-1 text-xs text-accent hover:underline">
          View less
        </button>
      )}
    </div>
  );
}
