import "@testing-library/jest-dom/vitest";

// jsdom has no ResizeObserver — stub for virtualized SessionList
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
