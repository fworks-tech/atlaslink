"use client";

export interface ErrorContext {
  component?: string;
  action?: string;
  userId?: string;
  sessionId?: string;
  [key: string]: unknown;
}

interface ErrorReport {
  message: string;
  stack?: string;
  componentStack?: string;
  context: ErrorContext;
  timestamp: string;
  url: string;
  userAgent: string;
}

const ERROR_KEY = "atlaslink:errors";
const MAX_ERRORS = 50;

function getStoredErrors(): ErrorReport[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(ERROR_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function storeError(report: ErrorReport): void {
  if (typeof window === "undefined") return;
  try {
    const errors = getStoredErrors();
    errors.push(report);
    if (errors.length > MAX_ERRORS) errors.splice(0, errors.length - MAX_ERRORS);
    sessionStorage.setItem(ERROR_KEY, JSON.stringify(errors));
  } catch {
    // sessionStorage full or unavailable — silent
  }
}

export function logError(error: Error, context: ErrorContext = {}, componentStack?: string): ErrorReport {
  const report: ErrorReport = {
    message: error.message,
    stack: error.stack,
    componentStack,
    context,
    timestamp: new Date().toISOString(),
    url: typeof window !== "undefined" ? window.location.href : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  };

  console.error("[Atlaslink Error]", {
    message: report.message,
    context: report.context,
    timestamp: report.timestamp,
  });

  storeError(report);

  return report;
}

export function getStoredErrorReports(): ErrorReport[] {
  return getStoredErrors();
}

export function clearStoredErrors(): void {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(ERROR_KEY);
  }
}
