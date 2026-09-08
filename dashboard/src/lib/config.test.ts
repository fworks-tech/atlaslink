import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONFIG,
  PROVIDERS,
  configToTweaks,
  isAgentConfig,
  tweaksToConfig,
} from "./config";

describe("config schema", () => {
  it("provides sensible defaults", () => {
    expect(DEFAULT_CONFIG).toEqual({
      provider: "opencode",
      model: "claude-sonnet-4-20250514",
      temperature: 0.7,
      maxTokens: 4096,
      tools: [],
    });
  });

  it("exposes the supported provider list", () => {
    expect(PROVIDERS).toContain("opencode");
    expect(PROVIDERS.length).toBeGreaterThan(0);
  });

  it("round-trips a config through tweaks", () => {
    const config = { provider: "groq", model: "llama-3.3", temperature: 0.5, maxTokens: 2048, tools: ["grep"] };
    const tweaks = configToTweaks(config);
    expect(tweaks).toEqual({
      provider: "groq",
      member: { model: "llama-3.3", temperature: 0.5, maxTokens: 2048, tools: ["grep"] },
    });
    expect(tweaksToConfig(tweaks)).toEqual(config);
  });

  it("fills defaults for missing tweaks", () => {
    expect(tweaksToConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(tweaksToConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it("coerces partial tweaks without clobbering defaults", () => {
    expect(tweaksToConfig({ member: { temperature: 0.2 } })).toEqual({
      ...DEFAULT_CONFIG,
      temperature: 0.2,
    });
  });

  it("validates a well-formed config", () => {
    expect(isAgentConfig({ provider: "opencode", model: "m", temperature: 1, maxTokens: 100, tools: [] })).toBe(true);
  });

  it("rejects invalid configs", () => {
    expect(isAgentConfig(undefined)).toBe(false);
    expect(isAgentConfig({ provider: "", model: "m", temperature: 1, maxTokens: 100, tools: [] })).toBe(false);
    expect(isAgentConfig({ provider: "opencode", model: "m", temperature: 3, maxTokens: 100, tools: [] })).toBe(false);
    expect(isAgentConfig({ provider: "opencode", model: "m", temperature: 1, maxTokens: 0, tools: [] })).toBe(false);
    expect(isAgentConfig({ provider: "opencode", model: "m", temperature: 1, maxTokens: 100, tools: "all" })).toBe(false);
  });
});
