import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NodePalette, DRAG_MIME } from "./NodePalette";

afterEach(cleanup);

describe("NodePalette", () => {
  it("lists one draggable entry per agent type", () => {
    render(<NodePalette />);
    expect(screen.getByLabelText("Agent palette")).toBeDefined();
    for (const label of ["Member", "Reasoning", "Tool", "Decision"]) {
      const item = screen.getByLabelText(`Add ${label} node`);
      expect(item.getAttribute("draggable")).toBe("true");
    }
  });

  it("puts the agent type on the drag payload", () => {
    render(<NodePalette />);
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByLabelText("Add Member node"), {
      dataTransfer: { setData, effectAllowed: "" },
    });
    expect(setData).toHaveBeenCalledWith(DRAG_MIME, "member");
  });
});
