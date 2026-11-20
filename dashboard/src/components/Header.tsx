"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { track } from "@vercel/analytics";
import { Burger, Drawer, Group, Stack } from "@mantine/core";
import ThemeToggle from "@/components/ThemeToggle";
import { NotificationBell } from "@/components/NotificationBell";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useNotifications";

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

  const router = useRouter();
  const { session, signOut } = useAuth();
  // bells poll only when signed in — anonymous visitors get no badge
  const { notifications, unreadCount, markRead } = useNotifications({ poll: session !== null });

  return (
    <nav className="border-b border-line">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="text-xl font-semibold tracking-tight text-foreground transition-colors hover:text-foreground/80 sm:text-2xl" style={{ fontFamily: "var(--font-display)" }}
          onClick={() => trackNav("atlaslink")}
        >
          atlaslink<span className="text-gold">.</span>
        </Link>

        <div className="flex items-center gap-2">
          <ThemeToggle className="hidden sm:block" />
          {session ? (
            <NotificationBell notifications={notifications} unreadCount={unreadCount} onMarkRead={(id) => void markRead(id)} onSelectSession={(sessionId) => router.push(`/?session=${encodeURIComponent(sessionId)}`)} />
          ) : null}
          <Group visibleFrom="md" gap="lg" c="dimmed" fz="sm">
          {session ? (
            <button
              type="button"
              onClick={() => {
                trackNav("signout");
                signOut();
              }}
              title="sign out"
              className="max-w-[180px] truncate rounded-lg border border-line bg-raised px-3 py-1.5 text-xs text-foreground transition-colors hover:border-accent/40"
            >
              {session.email} · sign out
            </button>
          ) : (
            <Link
              href="/login"
              onClick={() => trackNav("my-atlas")}
              className="rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
            >
              My Atlas
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
          <Link href="/" className="font-semibold tracking-tight text-foreground" style={{ fontFamily: "var(--font-display)" }}>
            atlaslink<span className="text-gold">.</span>
          </Link>
        }
      >
        <Stack gap="sm">
          <ThemeToggle />
          {session ? (
            <button
              type="button"
              onClick={() => signOut()}
              className="block rounded-lg border border-line bg-raised px-3 py-2 text-left text-xs text-foreground"
            >
              {session.email} · sign out
            </button>
          ) : (
            <Link
              href="/login"
              onClick={() => {
                trackNav("my-atlas");
                setMenuOpen(false);
              }}
              className="block rounded-lg bg-accent/15 px-3 py-2 text-center text-sm font-medium text-accent"
            >
              My Atlas
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
