"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listProjects, createProject, ApiError } from "@/lib/api";
import type { Project } from "@/lib/types";

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await listProjects();
        if (cancelled) return;
        setProjects(res.projects);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "failed to load projects");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    const res = await listProjects();
    setProjects(res.projects);
    setError(null);
  }, []);

  // sessions always live in a project (spec: auth-app-flow §3) — when the
  // tenant has none (demo visitor, fresh account whose inbox seeding failed)
  // create the default one once so the composer can submit
  const ensuredInbox = useRef(false);
  const ensureInbox = useCallback(async (): Promise<void> => {
    if (ensuredInbox.current) return;
    const res = await listProjects();
    setProjects(res.projects);
    if (res.projects.length === 0) {
      const created = await createProject({ name: "inbox" });
      setProjects([created.project]);
    }
    ensuredInbox.current = true;
  }, []);

  const addProject = useCallback(
    async (name: string): Promise<Project | null> => {
      try {
        const res = await createProject({ name });
        setProjects((prev) => [res.project, ...prev]);
        return res.project;
      } catch (err) {
        const msg =
          err instanceof ApiError && err.status === 404
            ? "Project API not available — backend needs redeploy"
            : err instanceof Error
              ? err.message
              : "failed to create project";
        setError(msg);
        return null;
      }
    },
    [],
  );

  return { projects, loading, error, refresh, addProject, ensureInbox };
}
