import type { GraphMode } from "./graph";

export interface LastSession {
  session: string;
  project?: string;
}

const LAST_SESSION_KEY = "atlaslink:ui:last-session";
const DIAGRAM_MODE_KEY = "atlaslink:ui:diagram-mode";

function isStorageAvailable(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function readRaw(key: string): string | null {
  if (!isStorageAvailable()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  if (!isStorageAvailable()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // a full or blocked store must not break navigation
  }
}

function removeRaw(key: string): void {
  if (!isStorageAvailable()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // a blocked store must not break navigation
  }
}

export function loadLastSession(): LastSession | null {
  const raw = readRaw(LAST_SESSION_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const session = (parsed as { session?: unknown }).session;
    if (typeof session !== "string" || session.length === 0) return null;
    const project = (parsed as { project?: unknown }).project;
    return typeof project === "string" && project.length > 0 ? { session, project } : { session };
  } catch {
    return null;
  }
}

export function saveLastSession(session: string, project?: string): void {
  writeRaw(LAST_SESSION_KEY, JSON.stringify(project ? { session, project } : { session }));
}

export function clearLastSession(): void {
  removeRaw(LAST_SESSION_KEY);
}

export function isDiagramMode(value: unknown): value is GraphMode {
  return value === "chain" || value === "fanout" || value === "full";
}

export function loadDiagramMode(fallback: GraphMode): GraphMode {
  const raw = readRaw(DIAGRAM_MODE_KEY);
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isDiagramMode(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function saveDiagramMode(mode: GraphMode): void {
  writeRaw(DIAGRAM_MODE_KEY, JSON.stringify(mode));
}
