import { NewTaskForm } from "@/components/NewTaskForm";
import { SessionList } from "@/components/SessionList";
import { SocietyDiagram } from "@/components/SocietyDiagram";

export default function Home() {
  return (
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

      <div className="space-y-6">
        <SocietyDiagram />
        <NewTaskForm />
        <SessionList />
      </div>
    </div>
  );
}