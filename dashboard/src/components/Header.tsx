"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { track } from "@vercel/analytics";
import { Badge, Burger, Button, Drawer, Group, Stack } from "@mantine/core";
import HelpTip from "./HelpTip";

interface NavLink {
  href: string;
  label: string;
  highlight?: boolean;
  external?: boolean;
}

const navLinks: NavLink[] = [
  { href: "https://github.com/fworks-tech/atlaslink/blob/main/README.md", label: "Docs", external: true },
  { href: "https://github.com/fworks-tech/atlaslink/releases", label: "Releases", external: true },
];

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const trackNav = useCallback((label: string) => {
    try {
      track("nav_click", { target: label.toLowerCase() });
    } catch {
      // analytics not configured — no-op
    }
  }, []);

  return (
    <nav className="border-b border-zinc-800 bg-zinc-650">
      <div className="mx-auto flex max-w-7xl items-center justify-between py-4">
        <Link
          href="/"
          className="font-semibold tracking-tight text-white transition-colors hover:text-zinc-200 text-xl sm:text-2xl"
          onClick={() => trackNav("atlaslink")}
        >
          atlaslink
        </Link>

        <Group visibleFrom="md" gap="lg" c="dimmed" fz="sm">
          {navLinks.map((link) =>
            link.highlight ? (
              link.external ? (
                <a
                  key={link.href + link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackNav(link.label)}
                  className="flex items-center gap-1.5 font-medium text-emerald-400 transition-colors hover:text-emerald-300"
                >
                  {link.label}
                  <Badge
                    size="xs"
                    variant="outline"
                    color="emerald"
                    rightSection={
                      <HelpTip
                        text="Live Society Diagram — Atlas holds the sky of sessions. Watch the DAG in real time."
                        side="top"
                      />
                    }
                    styles={{ label: { textTransform: "uppercase", letterSpacing: "0.05em" } }}
                  >
                    New
                  </Badge>
                </a>
              ) : (
                <Link
                  key={link.href + link.label}
                  href={link.href}
                  onClick={() => trackNav(link.label)}
                  className="flex items-center gap-1.5 font-medium text-emerald-400 transition-colors hover:text-emerald-300"
                >
                  {link.label}
                  <Badge
                    size="xs"
                    variant="outline"
                    color="emerald"
                    rightSection={
                      <HelpTip
                        text="Live Society Diagram — Atlas holds the sky of sessions. Watch the DAG in real time."
                        side="top"
                      />
                    }
                    styles={{ label: { textTransform: "uppercase", letterSpacing: "0.05em" } }}
                  >
                    New
                  </Badge>
                </Link>
              )
            ) : link.external ? (
              <a
                key={link.href + link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackNav(link.label)}
                className="transition-colors hover:text-white"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href + link.label}
                href={link.href}
                onClick={() => trackNav(link.label)}
                className="transition-colors hover:text-white"
              >
                {link.label}
              </Link>
            )
          )}
          <Button
            component="a"
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
            size="sm"
            disabled
          >
            My Atlas
          </Button>
        </Group>

        <Burger
          opened={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          hiddenFrom="md"
          color="gray"
          aria-label="Toggle menu"
        />
      </div>

      <Drawer
        opened={menuOpen}
        onClose={() => setMenuOpen(false)}
        size="xs"
        padding="md"
        hiddenFrom="md"
        title={
          <Link href="/" className="font-semibold tracking-tight text-white" onClick={() => setMenuOpen(false)}>
            atlaslink
          </Link>
        }
      >
        <Stack gap="sm">
          {navLinks.map((link) =>
            link.highlight ? (
              link.external ? (
                <a
                  key={link.href + link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    trackNav(link.label);
                    setMenuOpen(false);
                  }}
                  className="flex items-center gap-2 font-medium text-emerald-400 transition-colors hover:text-emerald-300"
                >
                  {link.label}
                  <Badge
                    size="xs"
                    variant="outline"
                    color="emerald"
                    rightSection={<HelpTip text="Live Society Diagram — Atlas holds the sky of sessions." side="top" />}
                    styles={{ label: { textTransform: "uppercase", letterSpacing: "0.05em" } }}
                  >
                    New
                  </Badge>
                </a>
              ) : (
                <Link
                  key={link.href + link.label}
                  href={link.href}
                  onClick={() => {
                    trackNav(link.label);
                    setMenuOpen(false);
                  }}
                  className="flex items-center gap-2 font-medium text-emerald-400 transition-colors hover:text-emerald-300"
                >
                  {link.label}
                  <Badge
                    size="xs"
                    variant="outline"
                    color="emerald"
                    rightSection={<HelpTip text="Live Society Diagram — Atlas holds the sky of sessions." side="top" />}
                    styles={{ label: { textTransform: "uppercase", letterSpacing: "0.05em" } }}
                  >
                    New
                  </Badge>
                </Link>
              )
            ) : link.external ? (
              <a
                key={link.href + link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  trackNav(link.label);
                  setMenuOpen(false);
                }}
                className="block text-zinc-400 transition-colors hover:text-white"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href + link.label}
                href={link.href}
                onClick={() => {
                  trackNav(link.label);
                  setMenuOpen(false);
                }}
                className="block text-zinc-400 transition-colors hover:text-white"
              >
                {link.label}
              </Link>
            )
          )}
          <Button
            component="a"
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
            color="emerald"
            fullWidth
          >
            My Atlas
          </Button>
        </Stack>
      </Drawer>
    </nav>
  );
}
