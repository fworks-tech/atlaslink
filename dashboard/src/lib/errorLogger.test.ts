import { describe, it, expect, beforeEach, vi } from "vitest";
import { logError, getStoredErrorReports, clearStoredErrors } from "./errorLogger";

describe("errorLogger", () => {
  beforeEach(() => {
    clearStoredErrors();
    vi.clearAllMocks();
  });

  it("logs error to console", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("test error");

    logError(error, { component: "TestComponent" });

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toBe("[Atlaslink Error]");
    spy.mockRestore();
  });

  it("stores error in sessionStorage", () => {
    const error = new Error("storage test");

    logError(error, { action: "click" });

    const reports = getStoredErrorReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].message).toBe("storage test");
    expect(reports[0].context.action).toBe("click");
    expect(reports[0].timestamp).toBeDefined();
    expect(reports[0].url).toBeDefined();
  });

  it("includes component stack when provided", () => {
    const error = new Error("stack test");

    logError(error, {}, "at Component (file.tsx:10:5)");

    const reports = getStoredErrorReports();
    expect(reports[0].componentStack).toBe("at Component (file.tsx:10:5)");
  });

  it("limits stored errors to 50", () => {
    for (let i = 0; i < 60; i++) {
      logError(new Error(`error ${i}`));
    }

    const reports = getStoredErrorReports();
    expect(reports).toHaveLength(50);
    expect(reports[0].message).toBe("error 10");
    expect(reports[49].message).toBe("error 59");
  });

  it("clears stored errors", () => {
    logError(new Error("to clear"));
    expect(getStoredErrorReports()).toHaveLength(1);

    clearStoredErrors();
    expect(getStoredErrorReports()).toHaveLength(0);
  });

  it("returns the error report", () => {
    const error = new Error("return test");

    const report = logError(error, { component: "Test" });

    expect(report.message).toBe("return test");
    expect(report.context.component).toBe("Test");
    expect(report.stack).toBeDefined();
  });
});
