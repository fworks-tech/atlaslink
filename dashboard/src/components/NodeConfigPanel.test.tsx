import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NodeConfigPanel } from "./NodeConfigPanel";
import type { AgentConfig } from "@/lib/config";

const getProvidersMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getProviders: (...args: unknown[]) => getProvidersMock(...args),
  };
});

const ROSTER = {
  ok: true,
  default: "opencode-go",
  providers: [
    { name: "opencode-go", model: "muse-spark-1.3", models: ["muse-spark-1.3", "muse-flow-1.0"], configured: true },
    { name: "groq", model: "mixtral-8x7b", models: [], configured: false },
  ],
};

function baseConfig(): AgentConfig {
  return { provider: "opencode", model: "claude-sonnet-4-20250514", temperature: 0.7, maxTokens: 4096, tools: [] };
}

beforeEach(() => {
  getProvidersMock.mockResolvedValue(ROSTER);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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

  it("rejects a non-integer maxTokens without emitting", () => {
    const onChange = vi.fn()
    render(<NodeConfigPanel config={baseConfig()} editable={true} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText("max tokens"), { target: { value: "3.5" } })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText(/must be a whole number/i)).toBeDefined()
  })

  it("shows current vs default for a drifted value", () => {
    render(<NodeConfigPanel config={{ ...baseConfig(), temperature: 0.2 }} editable={true} onChange={() => {}} />);
    expect(screen.getByText(/default: 0\.7/i)).toBeDefined();
  });

  it("fills the provider select from the live roster once loaded", async () => {
    render(<NodeConfigPanel config={baseConfig()} editable={true} onChange={() => {}} />);
    const select = screen.getByLabelText("provider") as HTMLSelectElement;
    await waitFor(() => {
      const names = Array.from(select.options).map((o) => o.value);
      expect(names).toContain("opencode-go");
    });
    // saved value not in roster stays selectable so the display stays truthful
    expect(names().includes("opencode")).toBe(true);
    function names() {
      return Array.from(select.options).map((o) => o.value);
    }
  });

  it("switching provider resets model to the roster default and emits both", async () => {
    const onChange = vi.fn();
    render(<NodeConfigPanel config={baseConfig()} editable={true} onChange={onChange} />);
    const select = (await waitFor(() => {
      const s = screen.getByLabelText("provider") as HTMLSelectElement;
      expect(Array.from(s.options).some((o) => o.value === "groq")).toBe(true);
      return s;
    })) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "groq" } });
    expect(onChange).toHaveBeenCalledWith({ ...baseConfig(), provider: "groq", model: "mixtral-8x7b" });
  });

  it("model becomes a strict select for providers with roster models", async () => {
    render(<NodeConfigPanel config={{ ...baseConfig(), provider: "opencode-go", model: "muse-spark-1.3" }} editable={true} onChange={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText("provider") as HTMLSelectElement).options.length).toBeGreaterThan(1));
    const model = screen.getByLabelText("model") as HTMLSelectElement;
    expect(model.tagName).toBe("SELECT");
    const values = Array.from(model.options).map((o) => o.value);
    expect(values).toEqual(["muse-spark-1.3", "muse-flow-1.0"]);
  });

  it("model stays a text input for providers without roster models", async () => {
    render(<NodeConfigPanel config={{ ...baseConfig(), provider: "groq", model: "mixtral-8x7b" }} editable={true} onChange={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText("provider") as HTMLSelectElement).options.length).toBeGreaterThan(1));
    const model = screen.getByLabelText("model") as HTMLInputElement;
    expect(model.tagName).toBe("INPUT");
    expect(model.maxLength).toBe(200);
    fireEvent.change(model, { target: { value: "llama-4" } });
    expect((model as HTMLInputElement).value).toBe("llama-4");
  });

  it("falls back to text model and saved provider when the roster fetch fails", async () => {
    getProvidersMock.mockRejectedValue(new Error("down"));
    render(<NodeConfigPanel config={baseConfig()} editable={true} onChange={() => {}} />);
    await waitFor(() => expect(getProvidersMock).toHaveBeenCalled());
    const select = screen.getByLabelText("provider") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["opencode"]);
    const model = screen.getByLabelText("model") as HTMLInputElement;
    expect(model.tagName).toBe("INPUT");
  });
});
