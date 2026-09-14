export function sidebarStorageKey(): string {
  return "atlaslink:sidebar:open";
}

function isStorageAvailable(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function hasStoredSidebarOpen(): boolean {
  if (!isStorageAvailable()) return false;
  try {
    return window.localStorage.getItem(sidebarStorageKey()) !== null;
  } catch {
    return false;
  }
}

export function loadSidebarOpen(fallback: boolean): boolean {
  if (!isStorageAvailable()) return fallback;
  try {
    const raw = window.localStorage.getItem(sidebarStorageKey());
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "boolean" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function saveSidebarOpen(open: boolean): void {
  if (!isStorageAvailable()) return;
  try {
    window.localStorage.setItem(sidebarStorageKey(), JSON.stringify(open));
  } catch {
    // a full or blocked store must not break navigation
  }
}
