import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NodeConfigPanel } from "./NodeConfigPanel";
import type { AgentConfig } from "@/lib/config";

afterEach(cleanup);

function baseConfig(): AgentConfig {
  return { provider: "opencode", model: "claude-sonnet-4-20250514", temperature: 0.7, maxTokens: 4096, tools: [] };
}

describe("NodeConfigPanel", () => {
  it("renders read-only values for a live node", () => {
    render(<NodeConfigPanel config={baseConfig()} editable={false} onChange={() => {}} />);
    expect(screen.getByText("opencode")).toBeDefined();
    expect(screen.getByText("claude-sonnet-4-20250514")).toBeDefined();
    expect(screen.getByText("0.7")).toBeDefined();
    expect(screen.getByText("4096")).toBeDefined();
    expect(screen.queryByLabelText("provider")).toBeNull();
  });

  it("renders editable fields for a draft node", () => {
    render(<NodeConfigPanel config={baseConfig()} editable={true} onChange={() => {}} />);
    expect(screen.getByLabelText("provider")).toBeDefined();
    expect(screen.getByLabelText("model")).toBeDefined();
    expect(screen.getByLabelText("temperature")).toBeDefined();
    expect(screen.getByLabelText("max tokens")).toBeDefined();
  });

  it("emits a validated, partial change on field edit", () => {
    const onChange = vi.fn();
    render(<NodeConfigPanel config={baseConfig()} editable={true} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("temperature"), { target: { value: "0.2" } });
    expect(onChange).toHaveBeenCalledWith({ ...baseConfig(), temperature: 0.2 });
  });

  it("rejects an out-of-range temperature without emitting", () => {
    const onChange = vi.fn();
    render(<NodeConfigPanel config={baseConfig()} editable={true} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("temperature"), { target: { value: "5" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/temperature must be between 0 and 2/i)).toBeDefined();
  });

  it("shows current vs default for a drifted value", () => {
    render(<NodeConfigPanel config={{ ...baseConfig(), temperature: 0.2 }} editable={true} onChange={() => {}} />);
    expect(screen.getByText(/default: 0\.7/i)).toBeDefined();
  });
});
