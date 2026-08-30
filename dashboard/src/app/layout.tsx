import type { ReactNode } from "react";
import type { Metadata } from "next";
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
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Skip to content
        </a>
        <div className="flex min-h-screen">
          <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none focus-visible:outline-none">
            {children}
          </main>
        </div>
        <div className="fixed bottom-4 right-4 z-50">
          <ConnectionStatus />
        </div>
      </body>
    </html>
  );
}
