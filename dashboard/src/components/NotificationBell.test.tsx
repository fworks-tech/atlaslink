import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NotificationBell } from "./NotificationBell";
import type { Notification } from "@/lib/types";

afterEach(cleanup);

const NOTIFS: Notification[] = [
  { id: "n-1", userId: "u-1", sessionId: "ses-abc", kind: "mention", excerpt: "hey you", readAt: null, createdAt: "2026-11-14T10:00:00Z" },
  { id: "n-2", userId: "u-1", sessionId: "ses-def", kind: "reply", excerpt: "<img src=x onerror=alert(1)>", readAt: "2026-11-14T11:00:00Z", createdAt: "2026-11-14T11:00:00Z" },
];

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the unread badge count and hides it at zero", () => {
    const { rerender } = render(
      <NotificationBell notifications={NOTIFS} unreadCount={1} onMarkRead={() => {}} />
    );
    expect(screen.getByTestId("notification-badge")).toHaveTextContent("1");
    rerender(<NotificationBell notifications={[]} unreadCount={0} onMarkRead={() => {}} />);
    expect(screen.queryByTestId("notification-badge")).toBeNull();
  });

  it("marks a bell read and navigates to the session on click", () => {
    const onMarkRead = vi.fn();
    const onSelectSession = vi.fn();
    render(
      <NotificationBell notifications={NOTIFS} unreadCount={1} onMarkRead={onMarkRead} onSelectSession={onSelectSession} />
    );
    fireEvent.click(screen.getByRole("button", { name: /notifications, 1 unread/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /hey you/ }));
    expect(onMarkRead).toHaveBeenCalledWith("n-1");
    expect(onSelectSession).toHaveBeenCalledWith("ses-abc");
  });

  it("renders stored markup as inert text, never as an element (XSS)", () => {
    render(<NotificationBell notifications={NOTIFS} unreadCount={1} onMarkRead={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    // the payload is visible as text but never becomes a DOM element
    expect(screen.getByRole("menuitem", { name: /reply/ }).textContent).toContain("<img src=x onerror=alert(1)>");
    expect(document.querySelector("img")).toBeNull();
  });
});
