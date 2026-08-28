import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { ConnectionStatus } from "@/components/ConnectionStatus";

export const metadata: Metadata = {
  title: "Atlaslink — Live Dashboard",
  description:
    "Live diagram of the Agenthood society's session provenance — Atlas holds the sky of sessions.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">
        <div className="flex min-h-screen">
          <aside className="fixed inset-y-0 left-0 flex w-60 flex-col border-r border-white/5 bg-surface">
            <Link href="/" className="border-b border-white/5 px-5 py-5">
              <div className="text-lg font-semibold tracking-wide text-foreground">
                Atlaslink
              </div>
              <div className="mt-0.5 text-xs text-muted">live society provenance</div>
            </Link>
            <nav className="flex-1 space-y-1 px-2 py-4 text-sm">
              <Link
                href="/"
                className="block rounded-md bg-raised px-3 py-2 text-foreground"
              >
                Atlas
              </Link>
            </nav>
            <div className="border-t border-white/5 px-5 py-4 font-mono text-xs text-muted">
              <ConnectionStatus />
            </div>
          </aside>
          <main className="ml-60 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}