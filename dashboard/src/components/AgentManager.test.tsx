import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { AgentManager } from "./AgentManager";

const apiMock = vi.hoisted(() => ({
  getAgents: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  notifyAgentsChanged: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getAgents: apiMock.getAgents,
    createAgent: apiMock.createAgent,
    updateAgent: apiMock.updateAgent,
    deleteAgent: apiMock.deleteAgent,
    notifyAgentsChanged: apiMock.notifyAgentsChanged,
  };
});

import { ApiError } from "@/lib/api";

afterEach(cleanup);

const CATALOG = {
  ok: true,
  builtIn: ["the-mediator", "the-reviewer"],
  agents: [{ name: "reviewer", displayName: "Reviewer", persona: "you review diffs", baseMember: "the-reviewer" }],
};

describe("AgentManager", () => {
  beforeEach(() => {
    apiMock.getAgents.mockResolvedValue(CATALOG);
    apiMock.createAgent.mockImplementation(async (input: { name: string }) => ({
      ok: true,
      agent: { displayName: input.name, persona: "p", baseMember: "the-reviewer", ...input },
    }));
    apiMock.updateAgent.mockImplementation(async (name: string, patch: Record<string, string>) => ({
      ok: true,
      agent: { name, displayName: name, persona: "p", baseMember: "the-reviewer", ...patch },
    }));
    apiMock.deleteAgent.mockResolvedValue({ ok: true });
  });

  it("lists custom agents with their base member", async () => {
    render(<AgentManager />);
    expect(await screen.findByText("Reviewer")).toBeDefined();
    expect(screen.getAllByText(/the-reviewer/).length).toBeGreaterThan(0);
  });

  it("creates an agent and refreshes the list", async () => {
    render(<AgentManager />);
    await screen.findByText("Reviewer");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "helper" } });
    fireEvent.change(screen.getByLabelText("Persona"), { target: { value: "you help" } });
    fireEvent.change(screen.getByLabelText("Base member"), { target: { value: "the-reviewer" } });
    apiMock.getAgents.mockResolvedValueOnce({
      ...CATALOG,
      agents: [
        ...CATALOG.agents,
        { name: "helper", displayName: "helper", persona: "you help", baseMember: "the-reviewer" },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /create agent/i }));
    await waitFor(() =>
      expect(apiMock.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({ name: "helper", persona: "you help", baseMember: "the-reviewer" }),
      ),
    );
    expect(await screen.findByText("helper")).toBeDefined();
  });

  it("rejects an invalid name without calling the API", async () => {
    render(<AgentManager />);
    await screen.findByText("Reviewer");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bad Name!" } });
    fireEvent.change(screen.getByLabelText("Persona"), { target: { value: "you help" } });
    fireEvent.click(screen.getByRole("button", { name: /create agent/i }));
    expect(apiMock.createAgent).not.toHaveBeenCalled();
    expect(await screen.findByText(/lowercase/i)).toBeDefined();
  });

  it("saves an edited persona and notifies the picker", async () => {
    render(<AgentManager />);
    await screen.findByText("Reviewer");
    const row = screen.getByText("Reviewer").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "edit" }));
    fireEvent.change(within(row).getByLabelText("Persona"), { target: { value: "you review very carefully" } });
    fireEvent.click(within(row).getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(apiMock.updateAgent).toHaveBeenCalledWith("reviewer", { persona: "you review very carefully" }),
    );
    await waitFor(() => expect(apiMock.notifyAgentsChanged).toHaveBeenCalled());
  });

  it("deletes an agent after confirmation", async () => {
    render(<AgentManager />);
    await screen.findByText("Reviewer");
    fireEvent.click(screen.getByRole("button", { name: /delete reviewer/i }));
    // first click arms the confirm, second click deletes
    fireEvent.click(await screen.findByRole("button", { name: /confirm delete/i }));
    await waitFor(() => expect(apiMock.deleteAgent).toHaveBeenCalledWith("reviewer"));
  });

  it("shows the server error when creation fails", async () => {
    apiMock.createAgent.mockRejectedValue(new ApiError(409, "409 agent 'reviewer' already exists"));
    render(<AgentManager />);
    await screen.findByText("Reviewer");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "reviewer" } });
    fireEvent.change(screen.getByLabelText("Persona"), { target: { value: "you help" } });
    fireEvent.click(screen.getByRole("button", { name: /create agent/i }));
    expect(await screen.findByText(/already exists/)).toBeDefined();
  });
});
