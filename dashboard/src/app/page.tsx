import { NewTaskForm } from "@/components/NewTaskForm";
import { SessionList } from "@/components/SessionList";

export default function Home() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Live Society Diagram
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Atlas holds the sky of sessions. Start a task and watch it flow through
          the delegation chain — statuses update live from the event bridge.
        </p>
      </header>

      <div className="space-y-6">
        <NewTaskForm />
        <SessionList />
      </div>
    </div>
  );
}