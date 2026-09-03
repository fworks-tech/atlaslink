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

  it("resets the expander when the payload changes", () => {
    const long = Array.from({ length: 60 }, (_, i) => `old ${i + 1}`).join("\n\n");
    const { rerender } = render(<Markdown text={long} />);
    fireEvent.click(screen.getByRole("button", { name: "View more" }));
    expect(screen.getByText("old 60")).toBeDefined();
    const next = Array.from({ length: 60 }, (_, i) => `new ${i + 1}`).join("\n\n");
    rerender(<Markdown text={next} />);
    expect(screen.queryByText("new 51")).toBeNull();
    expect(screen.getByRole("button", { name: "View more" })).toBeDefined();
  });

  it("closes a fence cut by the clamp so the expander survives", () => {
    const body = ["```js", ...Array.from({ length: 60 }, (_, i) => `code ${i + 1}`)].join("\n");
    render(<Markdown text={body} />);
    expect(screen.getByRole("button", { name: "View more" })).toBeDefined();
    expect(screen.getByText(/code 1/).closest("pre")).not.toBeNull();
  });

  it("empties javascript and data hrefs", () => {
    const { container } = render(<Markdown text={"[x](javascript:alert(1)) [y](data:text/html,<b>hi</b>)"} />);
    const anchors = [...container.querySelectorAll("a")];
    expect(anchors).toHaveLength(2);
    for (const a of anchors) {
      expect(a.getAttribute("href") ?? "").not.toMatch(/^(javascript|data):/);
    }
  });

  it("constrains images against beacons and blowout", () => {
    const { container } = render(<Markdown text={"![alt](https://example.com/pixel.png)"} />);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.className).toContain("max-w-full");
  });

  it("strips the inline pill inside code blocks", () => {
    const { container } = render(<Markdown text={"```js\nconst x = 1;\n```"} />);
    const pre = container.querySelector("pre") as HTMLElement;
    expect(pre.className).toContain("[&_code]:bg-transparent");
  });
});
