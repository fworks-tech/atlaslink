import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NodePalette, DRAG_MIME } from "./NodePalette";

afterEach(cleanup);

describe("NodePalette touch support", () => {
  it("renders one tap target per palette agent as a button", () => {
    render(<NodePalette onSelect={() => {}} />);
    for (const label of ["Member", "Reasoning", "Tool", "Decision"]) {
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeDefined();
    }
  });

  it("calls onSelect with the agent type when tapped", () => {
    const onSelect = vi.fn();
    render(<NodePalette onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /tool/i }));
    expect(onSelect).toHaveBeenCalledWith("tool");
  });

  it("renders without onSelect and stays draggable for desktop", () => {
    render(<NodePalette />);
    const tool = screen.getByRole("button", { name: /tool/i });
    expect(tool.getAttribute("draggable")).toBe("true");
    expect(() => fireEvent.click(tool)).not.toThrow();
  });

  it("puts the agent type on the drag payload", () => {
    render(<NodePalette />);
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByRole("button", { name: /member/i }), {
      dataTransfer: { setData, effectAllowed: "" },
    });
    expect(setData).toHaveBeenCalledWith(DRAG_MIME, "member");
  });
});
