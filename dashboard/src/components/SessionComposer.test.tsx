import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { SessionComposer } from "./SessionComposer";

const getProvidersMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    createTask: vi.fn(async () => ({ ok: true, session: { sessionId: "ses-123", correlationId: "cor-1", status: "queued", version: 1, task: { member: "the-mediator", prompt: "hi" } } })),
    getProviders: (...args: unknown[]) => getProvidersMock(...args),
  };
});

import { createTask } from "@/lib/api";

const PROVIDERS = {
  ok: true,
  default: "opencode-go",
  providers: [
    { name: "opencode-go", model: "muse-spark-1.3", models: ["muse-spark-1.3", "muse-flow-1.0"], configured: true },
    { name: "groq", model: "mixtral-8x7b", models: [], configured: false },
  ],
};

beforeEach(() => {
  getProvidersMock.mockResolvedValue(PROVIDERS);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionComposer provider selector", () => {
  it("loads the roster from the backend and defaults to it", async () => {
    render(<SessionComposer projects={[]} onCreateSession={vi.fn()} />);
    const select = await screen.findByLabelText("provider");
    expect((select as HTMLSelectElement).value).toBe("opencode-go");
    const model = screen.getByLabelText("model") as HTMLInputElement;
    expect(model.value).toBe("muse-spark-1.3");
    expect((select as HTMLSelectElement).options[1].textContent).toMatch(/groq \(no key\)/);
  });

  it("shows nothing while the roster loads, errors fall back quietly", async () => {
    getProvidersMock.mockRejectedValue(new Error("down"));
    render(<SessionComposer projects={[]} onCreateSession={vi.fn()} />);
    expect(screen.queryByLabelText("provider")).toBeNull();
    await waitFor(() => expect(getProvidersMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText(/provider list unavailable/i)).toBeNull();
  });

  it("switching providers resets the model to the new provider default", async () => {
    render(<SessionComposer projects={[]} onCreateSession={vi.fn()} />);
    const select = await screen.findByLabelText("provider");
    fireEvent.change(select, { target: { value: "groq" } });
    expect((screen.getByLabelText("model") as HTMLInputElement).value).toBe("mixtral-8x7b");
  });

  it("submits tweaks with provider and model alongside the task", async () => {
    render(<SessionComposer projects={[]} onCreateSession={vi.fn()} />);
    const select = await screen.findByLabelText("provider");
    fireEvent.change(select, { target: { value: "groq" } });
    fireEvent.change(screen.getByLabelText("model"), { target: { value: "llama-4" } });
    fireEvent.change(screen.getByPlaceholderText(/review my pull request/i), { target: { value: "do thing" } });
    fireEvent.click(screen.getByRole("button", { name: /ask atlas/i }));
    await waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "do thing",
          member: "the-mediator",
          tweaks: { provider: "groq", member: { model: "llama-4" } },
        }),
      ),
    );
  });

  it("truncates overlong model input at the 200-char cap", async () => {
    render(<SessionComposer projects={[]} onCreateSession={vi.fn()} />);
    const select = await screen.findByLabelText("provider");
    fireEvent.change(select, { target: { value: "groq" } });
    const model = screen.getByLabelText("model") as HTMLInputElement;
    fireEvent.change(model, { target: { value: "a".repeat(250) } });
    // React's controlled state owns the cap at the source, not the DOM
    await waitFor(() => expect((model as HTMLInputElement).value.length).toBe(200));
  });

  it("keeps 44px touch targets on both controls", async () => {
    render(<SessionComposer projects={[]} onCreateSession={vi.fn()} />);
    const select = await screen.findByLabelText("provider");
    expect(select.className).toMatch(/min-h-\[44px\]/);
    expect((screen.getByLabelText("model") as HTMLElement).className).toMatch(/min-h-\[44px\]/);
  });
});
