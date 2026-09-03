import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Markdown } from "./Markdown";

afterEach(cleanup);

describe("Markdown", () => {
  it("renders bold, headings, and links with studio styling", () => {
    render(<Markdown text={"# Title\n\na **bold** move by [atlas](https://example.com)"} />);
    expect(screen.getByText("Title").tagName).toBe("H1");
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    const link = screen.getByText("atlas").closest("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("renders gfm tables and fenced code blocks", () => {
    render(<Markdown text={"| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```"} />);
    expect(screen.getByText("a").tagName).toBe("TH");
    const pre = screen.getByText(/const x/).closest("pre") as HTMLElement;
    expect(pre.className).toContain("max-h-[420px]");
  });

  it("renders inline code distinctly from blocks", () => {
    render(<Markdown text={"run `grep foo` now"} />);
    const code = screen.getByText("grep foo");
    expect(code.tagName).toBe("CODE");
    expect(code.closest("pre")).toBeNull();
  });

  it("keeps raw html inert", () => {
    const { container } = render(
      <Markdown text={'<script>alert(1)</script><img src="x" onerror="alert(2)">'} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("clamps long payloads behind view more/less", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `para ${i + 1}`).join("\n\n");
    render(<Markdown text={lines} />);
    expect(screen.queryByText("para 51")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View more" }));
    expect(screen.getByText("para 60")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "View less" }));
    expect(screen.queryByText("para 51")).toBeNull();
  });

  it("shows no expander for short text", () => {
    render(<Markdown text={"just **short**"} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
