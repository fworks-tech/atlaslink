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
        <div className="flex min-h-screen">
          <main className="flex-1">{children}</main>
        </div>
        <div className="fixed bottom-4 right-4 z-50">
          <ConnectionStatus />
        </div>
      </body>
    </html>
  );
}
