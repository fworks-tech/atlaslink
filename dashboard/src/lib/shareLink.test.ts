import { describe, it, expect } from "vitest";
import { encodeShareLink, decodeShareLink, canonicalUrl } from "./shareLink";

describe("shareLink", () => {
  it("roundtrips ascii payload", () => {
    const p = { p: "proj-abc", s: "ses-xyz", n: "ses-xyz::mediator", m: "full" };
    expect(decodeShareLink(encodeShareLink(p))).toEqual(p);
  });
  it("roundtrips unicode", () => {
    const p = { p: "proj-😀", s: "ses-漢字", m: "full" };
    expect(decodeShareLink(encodeShareLink(p))).toEqual(p);
  });
  it("returns null for malformed q", () => {
    expect(decodeShareLink("!!!")).toBeNull();
    expect(decodeShareLink("")).toBeNull();
  });
  it("encodes without +/_= padding", () => {
    const q = encodeShareLink({ p: "a/b+c", s: "x" });
    expect(q).not.toMatch(/[+/=]/);
  });
  it("canonicalUrl encodes slash", () => {
    expect(canonicalUrl("a/b", "c/d")).toBe("/project/a%2Fb/session/c%2Fd");
  });
});
