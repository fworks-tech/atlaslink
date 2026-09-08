export interface AgentConfig {
  provider: string
  model: string
  temperature: number
  maxTokens: number
  tools: string[]
}

export const DEFAULT_CONFIG: AgentConfig = {
  provider: "opencode",
  model: "claude-sonnet-4-20250514",
  temperature: 0.7,
  maxTokens: 4096,
  tools: [],
}

export const PROVIDERS: string[] = ["opencode", "groq", "ollama"]

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {}
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : v
  return typeof n === "number" && Number.isFinite(n) ? n : fallback
}

// Maps the UI config to the backend tweaks shape. The backend accepts
// tweaks.{provider, member, team}; provider rides at top level, everything
// else nests under member.
export function configToTweaks(config: AgentConfig): {
  provider?: string
  member?: Record<string, unknown>
} {
  return {
    provider: config.provider,
    member: {
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      tools: config.tools,
    },
  }
}

// Inverts configToTweaks, filling defaults for anything missing. A corrupt or
// absent tweaks value yields the defaults rather than throwing.
export function tweaksToConfig(tweaks: unknown): AgentConfig {
  const t = asRecord(tweaks)
  const member = asRecord(t.member)
  return {
    provider: str(t.provider, DEFAULT_CONFIG.provider),
    model: str(member.model, DEFAULT_CONFIG.model),
    temperature: num(member.temperature, DEFAULT_CONFIG.temperature),
    maxTokens: num(member.maxTokens, DEFAULT_CONFIG.maxTokens),
    tools: Array.isArray(member.tools) ? member.tools.map(String) : DEFAULT_CONFIG.tools,
  }
}

export function isAgentConfig(v: unknown): v is AgentConfig {
  if (typeof v !== "object" || v === null) return false
  const c = v as Record<string, unknown>
  if (typeof c.provider !== "string" || c.provider.length === 0) return false
  if (typeof c.model !== "string" || c.model.length === 0) return false
  if (typeof c.temperature !== "number" || c.temperature < 0 || c.temperature > 2) return false
  if (typeof c.maxTokens !== "number" || !Number.isInteger(c.maxTokens) || c.maxTokens <= 0) return false
  if (!Array.isArray(c.tools) || !c.tools.every((t) => typeof t === "string")) return false
  return true
}
