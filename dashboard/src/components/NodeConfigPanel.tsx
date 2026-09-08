"use client";

import { useState } from "react";
import { DEFAULT_CONFIG, PROVIDERS, type AgentConfig } from "@/lib/config";

function num(v: string): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

export function NodeConfigPanel({
  config,
  editable,
  onChange,
}: {
  config: AgentConfig
  editable: boolean
  onChange: (next: AgentConfig) => void
}) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const resolve = (field: keyof AgentConfig): string | number | string[] => {
    if (field in draft) return draft[field]
    return config[field]
  }

  const commitString = (field: "provider" | "model", value: string) => {
    setDraft((d) => ({ ...d, [field]: value }))
    if (field === "provider") {
      onChange({ ...config, provider: value })
    } else {
      onChange({ ...config, model: value })
    }
  }

  const commitNumber = (field: "temperature" | "maxTokens", raw: string, min: number, max: number, label: string) => {
    setDraft((d) => ({ ...d, [field]: raw }))
    const n = num(raw)
    if (Number.isNaN(n) || n < min || n > max) {
      setError(`${label} must be between ${min} and ${max}`)
      return
    }
    setError(null)
    onChange({ ...config, [field]: n })
  }

  const showDefault = (field: "temperature" | "maxTokens") => {
    const current = resolve(field)
    const fallback = DEFAULT_CONFIG[field]
    return String(current) !== String(fallback)
  }

  if (!editable) {
    return (
      <div className="space-y-1.5 text-xs">
        <Row label="provider" value={String(config.provider)} />
        <Row label="model" value={String(config.model)} />
        <Row label="temperature" value={String(config.temperature)} />
        <Row label="max tokens" value={String(config.maxTokens)} />
      </div>
    )
  }

  return (
    <div className="space-y-2 text-xs">
      <label className="block">
        <span className="text-muted">provider</span>
        <select
          aria-label="provider"
          value={resolve("provider") as string}
          onChange={(e) => commitString("provider", e.target.value)}
          className="mt-0.5 w-full rounded border border-white/10 bg-raised px-2 py-1 text-foreground"
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-muted">model</span>
        <input
          aria-label="model"
          value={resolve("model") as string}
          onChange={(e) => commitString("model", e.target.value)}
          className="mt-0.5 w-full rounded border border-white/10 bg-raised px-2 py-1 text-foreground"
        />
      </label>
      <label className="block">
        <span className="text-muted">
          temperature
          {showDefault("temperature") && <span className="ml-1 text-accent">default: {DEFAULT_CONFIG.temperature}</span>}
        </span>
        <input
          aria-label="temperature"
          value={resolve("temperature")}
          onChange={(e) => commitNumber("temperature", e.target.value, 0, 2, "temperature")}
          className="mt-0.5 w-full rounded border border-white/10 bg-raised px-2 py-1 text-foreground"
        />
      </label>
      <label className="block">
        <span className="text-muted">
          max tokens
          {showDefault("maxTokens") && <span className="ml-1 text-accent">default: {DEFAULT_CONFIG.maxTokens}</span>}
        </span>
        <input
          aria-label="max tokens"
          value={resolve("maxTokens")}
          onChange={(e) => commitNumber("maxTokens", e.target.value, 1, 1000000, "max tokens")}
          className="mt-0.5 w-full rounded border border-white/10 bg-raised px-2 py-1 text-foreground"
        />
      </label>
      {error && (
        <div role="alert" className="rounded bg-danger/10 px-2 py-1 text-danger">
          {error}
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  )
}
