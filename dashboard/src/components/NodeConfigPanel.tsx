"use client";

import { useEffect, useState } from "react";
import { DEFAULT_CONFIG, type AgentConfig } from "@/lib/config";
import { getProviders, type ProviderChoice } from "@/lib/api";

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
  // Live roster from the daemon (same source as the composer). Until it
  // arrives (or if it fails) the provider select shows only the saved value
  // and the model stays a text input — the panel never blocks on the fetch.
  const [roster, setRoster] = useState<ProviderChoice[] | null>(null)

  useEffect(() => {
    let cancelled = false
    getProviders()
      .then((res) => {
        if (!cancelled) setRoster(res.providers)
      })
      .catch(() => {
        if (!cancelled) setRoster(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

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

  const commitNumber = (field: "temperature" | "maxTokens", raw: string, min: number, max: number, label: string, integer = false) => {
    setDraft((d) => ({ ...d, [field]: raw }))
    const n = num(raw)
    if (Number.isNaN(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
      setError(integer ? `${label} must be a whole number between ${min} and ${max}` : `${label} must be between ${min} and ${max}`)
      return
    }
    setError(null)
    onChange({ ...config, [field]: n })
  }

  const pickProvider = (next: string) => {
    const def = roster?.find((p) => p.name === next)
    setDraft((d) => ({ ...d, provider: next, model: def?.model ?? "" }))
    onChange({ ...config, provider: next, model: def?.model ?? "" })
  }

  const providerOptions = (): { value: string; label: string }[] => {
    const names = roster?.map((p) => p.name) ?? []
    const current = (resolve("provider") as string) || config.provider
    return names.includes(current) ? names.map((n) => ({ value: n, label: n })) : [{ value: current, label: current }, ...names.map((n) => ({ value: n, label: n }))]
  }

  const activeProvider = roster?.find((p) => p.name === (resolve("provider") as string))
  const modelChoices = activeProvider?.models?.filter((m) => m.length > 0) ?? []
  const modelField = (resolve("model") as string) || config.model

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
          onChange={(e) => pickProvider(e.target.value)}
          className="mt-0.5 w-full rounded border border-line bg-raised px-2 py-1 text-foreground"
        >
          {providerOptions().map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-muted">model</span>
        {modelChoices.length > 0 ? (
          // strict select: only models the daemon's roster lists for this
          // provider; a provider with no roster models falls back to text
          <select
            aria-label="model"
            value={modelField}
            onChange={(e) => commitString("model", e.target.value)}
            className="mt-0.5 w-full rounded border border-line bg-raised px-2 py-1 text-foreground"
          >
            {!modelChoices.includes(modelField) && modelField.length > 0 && (
              <option value={modelField}>{modelField}</option>
            )}
            {modelChoices.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label="model"
            value={modelField}
            onChange={(e) => commitString("model", e.target.value)}
            maxLength={200}
            className="mt-0.5 w-full rounded border border-line bg-raised px-2 py-1 text-foreground"
          />
        )}
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
          className="mt-0.5 w-full rounded border border-line bg-raised px-2 py-1 text-foreground"
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
          onChange={(e) => commitNumber("maxTokens", e.target.value, 1, 1000000, "max tokens", true)}
          className="mt-0.5 w-full rounded border border-line bg-raised px-2 py-1 text-foreground"
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
