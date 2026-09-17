"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { login, registerAccount, ApiError } from "@/lib/api";
import FadeIn from "@/components/FadeIn";

type Mode = "login" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "register" && password !== confirm) {
      setError("passwords do not match");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") await login(email.trim(), password);
      else await registerAccount(email.trim(), password);
      router.push("/atlas");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong — try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center px-4 py-10">
      <FadeIn className="w-full max-w-sm">
        <div className="rounded-xl border border-line bg-surface/80 p-6 backdrop-blur-sm">
          <h1 className="text-xl font-semibold text-foreground">
            {mode === "login" ? "Welcome back" : "Create your Atlas"}
          </h1>
          <p className="mt-1 text-xs text-muted">
            {mode === "login" ? "Your sessions, projects and costs, per tenant." : "One account — your own Atlas workspace."}
          </p>

          <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="min-h-[44px] rounded-lg border border-line bg-raised px-3 py-2 text-base text-foreground outline-none focus:border-accent/50"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              password
              <input
                type="password"
                required
                minLength={8}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="min-h-[44px] rounded-lg border border-line bg-raised px-3 py-2 text-base text-foreground outline-none focus:border-accent/50"
              />
            </label>
            {mode === "register" && (
              <label className="flex flex-col gap-1 text-xs text-muted">
                confirm password
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-line bg-raised px-3 py-2 text-base text-foreground outline-none focus:border-accent/50"
                />
              </label>
            )}

            <button
              type="submit"
              disabled={busy || !email.trim() || password.length === 0}
              className="min-h-[44px] rounded-lg bg-accent/15 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
            >
              {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
            </button>
            {error && <div role="alert" className="rounded bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
          </form>

          <p className="mt-4 text-xs text-muted">
            {mode === "login" ? (
              <>
                No account yet?{" "}
                <button type="button" onClick={() => { setMode("register"); setError(null); }} className="text-accent underline">
                  Create one
                </button>
              </>
            ) : (
              <>
                Already registered?{" "}
                <button type="button" onClick={() => { setMode("login"); setError(null); }} className="text-accent underline">
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
        <p className="mt-4 text-center text-xs text-muted">
          Just looking around?{" "}
          <Link href="/atlas" className="text-accent underline">
            Try the demo — no account needed
          </Link>
        </p>
      </FadeIn>
    </main>
  );
}
