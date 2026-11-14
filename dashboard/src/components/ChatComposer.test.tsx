import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ChatComposer } from "./ChatComposer";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({
  sendChatMessage: vi.fn(async () => ({ ok: true, session: {} })),
}));

import { sendChatMessage } from "@/lib/api";

const DIRECTORY = [
  { id: "u-1", email: "alice@example.com", displayName: "alice" },
  { id: "u-2", email: "bob@example.com", displayName: "bob" },
];

describe("ChatComposer", () => {
  it("autocompletes @mentions from the directory and submits ids", async () => {
    const onSent = vi.fn();
    render(<ChatComposer sessionId="ses-1" directory={DIRECTORY} replyTo={null} onClearReply={() => {}} onSent={onSent} />);
    const box = screen.getByLabelText("Room chat message");
    fireEvent.change(box, { target: { value: "hey @ali", selectionStart: 8 } });
    // jsdom selectionStart is read-only via target props — set caret through select event
    fireEvent.select(box, { target: { selectionStart: 8 } });
    expect(await screen.findByRole("listbox", { name: "Mention suggestions" })).toBeDefined();
    fireEvent.mouseDown(screen.getByRole("option", { name: /alice/ }));
    expect((box as HTMLTextAreaElement).value).toContain("@alice@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(sendChatMessage).toHaveBeenCalledWith("ses-1", expect.stringContaining("@alice@example.com"), {
      mentions: ["alice@example.com"],
    });
  });

  it("submits the reply parentId and clears it after send", async () => {
    const onSent = vi.fn();
    const onClearReply = vi.fn();
    render(
      <ChatComposer
        sessionId="ses-1"
        directory={DIRECTORY}
        replyTo={{ index: 3, excerpt: "kickoff" }}
        onClearReply={onClearReply}
        onSent={onSent}
      />
    );
    expect(screen.getByText(/replying to: kickoff/)).toBeDefined();
    fireEvent.change(screen.getByLabelText("Room chat message"), { target: { value: "ack" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(sendChatMessage).toHaveBeenCalledWith("ses-1", "ack", { parentId: "m-3" });
    expect(onClearReply).toHaveBeenCalled();
  });
});
