"use client";

import { useCallback, useEffect, useState } from "react";
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

  const addProject = useCallback(
    async (name: string): Promise<Project | null> => {
      try {
        const res = await createProject({ name });
        setProjects((prev) => [res.project, ...prev]);
        return res.project;
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "failed to create project");
        return null;
      }
    },
    [],
  );

  return { projects, loading, error, refresh, addProject };
}
