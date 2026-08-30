"use client";

import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { SessionComposer } from "@/components/SessionComposer";
import { SocietyDiagram } from "@/components/SocietyDiagram";
import { SessionList } from "@/components/SessionList";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useProjects } from "@/hooks/useProjects";

export default function Home() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const { projects, loading: projectsLoading, error: projectsError, addProject } = useProjects();

  return (
    <div className="flex h-screen">
      <aside className="w-64 shrink-0 border-r border-white/5 bg-surface overflow-hidden">
        <ErrorBoundary>
          <Sidebar
            projects={projects}
            projectsLoading={projectsLoading}
            projectsError={projectsError}
            onCreateProject={addProject}
            selectedSessionId={selectedSessionId}
            onSelectSession={setSelectedSessionId}
          />
        </ErrorBoundary>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-8 py-12">
          <header className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Live Society Diagram
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted">
              Atlas holds the sky of sessions. Start a task and watch its delegation
              map appear under Atlas and update live from the event bridge.
            </p>
          </header>

          {selectedSessionId ? (
            <div className="space-y-6">
              <ErrorBoundary>
                <SocietyDiagram />
              </ErrorBoundary>
              <SessionList onSelect={setSelectedSessionId} />
            </div>
          ) : (
            <ErrorBoundary>
              <SessionComposer
                projects={projects}
                onCreateSession={setSelectedSessionId}
              />
            </ErrorBoundary>
          )}
        </div>
      </main>
    </div>
  );
}
