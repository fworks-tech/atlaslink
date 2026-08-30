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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const handleSelectSession = (id: string) => {
    setSelectedSessionId(id);
    setMobileSidebarOpen(false);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile drawer overlay */}
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      )}
      <aside
        className={`${
          mobileSidebarOpen ? "flex" : "hidden"
        } md:flex fixed md:static inset-y-0 left-0 z-40 w-64 max-w-[85vw] shrink-0 flex-col border-r border-white/5 bg-surface overflow-hidden`}
        aria-label="Sidebar"
      >
        <ErrorBoundary>
          <Sidebar
            projects={projects}
            projectsLoading={projectsLoading}
            projectsError={projectsError}
            onCreateProject={addProject}
            selectedSessionId={selectedSessionId}
            onSelectSession={handleSelectSession}
          />
        </ErrorBoundary>
      </aside>
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* Mobile top bar with hamburger */}
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/5 bg-background px-4 py-2 md:hidden">
          <button
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={mobileSidebarOpen}
            aria-controls="sidebar"
            onClick={() => setMobileSidebarOpen((v) => !v)}
            className="rounded-md p-2 text-muted hover:bg-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span aria-hidden="true" className="block h-5 w-5">
              <span className="block h-0.5 w-5 bg-current mt-1" />
              <span className="block h-0.5 w-5 bg-current mt-1.5" />
              <span className="block h-0.5 w-5 bg-current mt-1.5" />
            </span>
          </button>
          <span className="text-sm font-medium tracking-tight text-foreground">Atlaslink</span>
        </div>
        {selectedSessionId ? (
          <div className="mx-auto max-w-5xl px-4 sm:px-8 py-8 sm:py-12">
            <button
              type="button"
              onClick={() => setSelectedSessionId(undefined)}
              className="mb-6 inline-flex items-center rounded-md border border-white/10 bg-raised px-3 py-1.5 text-sm text-foreground hover:bg-raised/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors"
            >
              ← Back to composer
            </button>
            <header className="mb-8">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Live Society Diagram
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted">
                Atlas holds the sky of sessions. Start a task and watch its delegation map appear
                under Atlas and update live from the event bridge.
              </p>
              <p className="mt-3 font-mono text-xs text-accent" aria-live="polite">
                Viewing session <span className="break-all">{selectedSessionId}</span>
              </p>
            </header>
            <div className="space-y-6">
              <ErrorBoundary>
                <SocietyDiagram />
              </ErrorBoundary>
              <SessionList onSelect={handleSelectSession} />
            </div>
          </div>
        ) : (
          <ErrorBoundary>
            <SessionComposer projects={projects} onCreateSession={handleSelectSession} />
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}
