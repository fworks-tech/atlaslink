"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { track } from "@vercel/analytics";
import { Burger, Drawer, Group, Stack } from "@mantine/core";

interface NavLink {
  href: string;
  label: string;
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
    <nav className="border-b border-zinc-800">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="font-semibold tracking-tight text-white transition-colors hover:text-zinc-200 text-xl sm:text-2xl"
          onClick={() => trackNav("atlaslink")}
        >
          atlaslink
        </Link>

        <Group visibleFrom="md" gap="lg" c="dimmed" fz="sm">
          {navLinks.map((link) =>
            link.external ? (
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
        </Stack>
      </Drawer>
    </nav>
  );
}
