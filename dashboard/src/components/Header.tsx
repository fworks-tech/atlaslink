"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { usePathname } from "next/navigation";
import { track } from "@vercel/analytics";
import { Burger, Drawer, Group, Stack } from "@mantine/core";
import ThemeToggle from "@/components/ThemeToggle";
import { useCost } from "@/hooks/useCost";

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

  const pathname = usePathname();
  // the /cost page already polls useCost + useCostHistory — skip a second
  // interval there so the header never duplicates pollers on that route
  const { total, error } = useCost({ poll: pathname !== "/cost" });
  // compact on purpose: the badge keeps 2 decimals while /cost shows 4 —
  // intentional precision split, the header stays narrow on small screens
  const hasCost = !error && total.stepCost > 0;
  const costTotal = total.stepCost > 0 ? `$${total.stepCost.toFixed(2)}` : "—";

  return (
    <nav className="border-b border-line">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="font-semibold tracking-tight text-foreground transition-colors hover:text-foreground/80 text-xl sm:text-2xl"
          onClick={() => trackNav("atlaslink")}
        >
          atlaslink
        </Link>

        <div className="flex items-center gap-2">
          <ThemeToggle className="hidden sm:block" />
          <Group visibleFrom="md" gap="lg" c="dimmed" fz="sm">
          {hasCost && (
            <Link href="/cost" onClick={() => trackNav("cost")} className="flex items-center gap-1.5 text-sm text-muted">
              <span>cost</span>
              <span className="rounded bg-raised px-2 py-0.5 font-medium text-accent">{costTotal}</span>
            </Link>
          )}
          {navLinks.map((link) =>
            link.external ? (
              <a
                key={link.href + link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackNav(link.label)}
                className="transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href + link.label}
                href={link.href}
                onClick={() => trackNav(link.label)}
                className="transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            )
          )}
          </Group>
        </div>

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
          <Link href="/" className="font-semibold tracking-tight text-foreground">
            atlaslink
          </Link>
        }
      >
        <Stack gap="sm">
          <ThemeToggle />
          {hasCost && (
            <Link
              href="/cost"
              onClick={() => {
                trackNav("cost");
                setMenuOpen(false);
              }}
              className="block text-sm font-medium text-accent"
            >
              {costTotal}
            </Link>
          )}
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
                className="block text-muted transition-colors hover:text-foreground"
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
                className="block text-muted transition-colors hover:text-foreground"
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
