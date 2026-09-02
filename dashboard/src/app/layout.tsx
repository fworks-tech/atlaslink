import type { ReactNode } from "react";
import type { Metadata } from "next";
import { MantineProvider, ColorSchemeScript, mantineHtmlProps } from "@mantine/core";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import theme from "../../mantine-theme.mjs";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { BackendWakingOverlay } from "@/components/BackendWakingOverlay";

export const metadata: Metadata = {
  title: "Atlaslink — Live Dashboard",
  description:
    "Live diagram of the Agenthood society's session provenance — Atlas holds the sky of sessions.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript defaultColorScheme="dark" />
      </head>
      <body className="flex min-h-screen flex-col">
        <MantineProvider theme={theme} defaultColorScheme="dark">
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Skip to content
          </a>
          <Header />
          <div className="flex flex-1 flex-col">
            <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none focus-visible:outline-none">
              {children}
            </main>
            <Footer />
          </div>
          <BackendWakingOverlay />
        </MantineProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
