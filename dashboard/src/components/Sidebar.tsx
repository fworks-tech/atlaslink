"use client";

import { useMemo, useState } from "react";
import { useSessions } from "@/hooks/useSessions";
import { useEvents } from "@/hooks/useEvents";
import { StatusBadge } from "@/components/StatusBadge";
import { withLiveUpdates } from "@/lib/sessionProjection";
import type { Project, Session } from "@/lib/types";

export function groupByDate(sessions: Session[]): Map<string, Session[]> {
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  const groups = new Map<string, Session[]>();
  const older: Session[] = [];

  for (const s of sessions) {
    const dateStr = s.createdAt ? new Date(s.createdAt).toDateString() : "";
    if (dateStr === todayStr) {
      const arr = groups.get("Today") ?? [];
      arr.push(s);
      groups.set("Today", arr);
    } else if (dateStr === yesterdayStr) {
      const arr = groups.get("Yesterday") ?? [];
      arr.push(s);
      groups.set("Yesterday", arr);
    } else {
      older.push(s);
    }
  }

  if (older.length > 0) groups.set("Older", older);
  return groups;
}

export function Sidebar({
  projects,
  projectsLoading,
  projectsError,
  onCreateProject,
  selectedSessionId,
  onSelectSession,
}: {
  projects: Project[];
  projectsLoading: boolean;
  projectsError: string | null;
  onCreateProject: (name: string) => Promise<Project | null>;
  selectedSessionId?: string;
  onSelectSession: (id: string) => void;
}) {
  const { sessions } = useSessions();
  const { events } = useEvents();
  const live = useMemo(() => withLiveUpdates(sessions, events), [sessions, events]);

  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newProjectName.trim();
    if (!trimmed) return;
    if (trimmed.length > 200) {
      setCreateError("Project name must be ≤200 characters");
      return;
    }
    setCreateError(null);
    const project = await onCreateProject(trimmed);
    if (project) {
      setNewProjectName("");
      setShowNewProject(false);
      setExpandedProjects((prev) => new Set(prev).add(project.id));
    }
  };

  const { projectMap, unassigned } = useMemo(() => {
    const map = new Map<string, Session[]>();
    const unassignedList: Session[] = [];
    for (const s of live) {
      if (s.projectId) {
        const arr = map.get(s.projectId) ?? [];
        arr.push(s);
        map.set(s.projectId, arr);
      } else {
        unassignedList.push(s);
      }
    }
    return { projectMap: map, unassigned: unassignedList };
  }, [live]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-widest text-muted">Projects</span>
        <button
          onClick={() => setShowNewProject(!showNewProject)}
          className="text-muted hover:text-foreground transition-colors"
        >
          +
        </button>
      </div>

      {showNewProject && (
        <form onSubmit={handleCreateProject} className="border-b border-white/5 px-4 py-3">
          <input
            autoFocus
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="Project name"
            maxLength={200}
            className="w-full rounded-md border border-white/10 bg-raised px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted/70 focus:border-accent/50"
          />
          {createError && <p className="mt-1 text-xs text-danger">{createError}</p>}
        </form>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {projectsLoading ? (
          <p className="px-2 py-4 text-xs text-muted">Loading…</p>
        ) : projectsError ? (
          <p className="px-2 py-4 text-xs text-danger">{projectsError}</p>
        ) : (
          <>
            {projects.map((project) => {
              const projectSessions = projectMap.get(project.id) ?? [];
              const groups = groupByDate(projectSessions);
              const expanded = expandedProjects.has(project.id);

              return (
                <div key={project.id} className="mb-1">
                  <button
                    onClick={() => toggle(project.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-raised transition-colors"
                  >
                    <span className="text-muted text-xs">{expanded ? "▼" : "▶"}</span>
                    <span className="truncate">{project.name}</span>
                    <span className="ml-auto font-mono text-xs text-muted">{projectSessions.length}</span>
                  </button>
                  {expanded && (
                    <div className="ml-3">
                      {Array.from(groups.entries()).map(([label, items]) => (
                        <SessionGroup
                          key={label}
                          label={label}
                          sessions={items}
                          selectedSessionId={selectedSessionId}
                          onSelectSession={onSelectSession}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {unassigned.length > 0 && (
              <div className="mt-2 border-t border-white/5 pt-2">
                {Array.from(groupByDate(unassigned).entries()).map(([label, items]) => (
                  <SessionGroup
                    key={label}
                    label={label}
                    sessions={items}
                    selectedSessionId={selectedSessionId}
                    onSelectSession={onSelectSession}
                  />
                ))}
              </div>
            )}

            {projects.length === 0 && unassigned.length === 0 && (
              <p className="px-2 py-8 text-center text-xs text-muted">
                No sessions yet. Create a project or start a task.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SessionGroup({
  label,
  sessions,
  selectedSessionId,
  onSelectSession,
}: {
  label: string;
  sessions: Session[];
  selectedSessionId?: string;
  onSelectSession: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mb-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs font-medium text-muted hover:text-foreground transition-colors"
      >
        <span className="text-[10px]">{expanded ? "▼" : "▶"}</span>
        {label}
        <span className="ml-auto font-mono text-[10px]">{sessions.length}</span>
      </button>
      {expanded && (
        <div className="ml-1">
          {sessions.map((s) => (
            <button
              key={s.sessionId}
              onClick={() => onSelectSession(s.sessionId)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors ${
                s.sessionId === selectedSessionId
                  ? "bg-accent/15 text-accent"
                  : "text-foreground hover:bg-raised"
              }`}
            >
              <StatusBadge status={s.status} />
              <span className="truncate">{s.task.prompt || s.sessionId}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
