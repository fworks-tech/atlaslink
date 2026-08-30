import Link from "next/link";

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      {/* ATLAS watermark */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden">
        <span className="text-[8rem] sm:text-[10rem] md:text-[12rem] font-black tracking-tighter text-foreground/[0.04] leading-none" aria-hidden>
          ATLAS
        </span>
      </div>

      <div className="relative z-10 text-center">
        <p className="font-mono text-sm tracking-widest text-accent">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Page not found</h1>
        <p className="mt-3 text-sm leading-6 text-muted">The sky you are looking for does not exist.</p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-lg bg-accent/15 px-4 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Back to Atlas
        </Link>
      </div>
    </div>
  );
}
