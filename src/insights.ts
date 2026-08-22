#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildInsightsReport } from './bridge/insights'
import type { TraceEnvelope } from 'agenthood/dist/core/types.js'

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function print(report: ReturnType<typeof buildInsightsReport>): void {
  const t = report.total
  console.log(`\nAtlaslink usage insights — ${report.count} run${report.count === 1 ? '' : 's'} (${report.errorCount} error${report.errorCount === 1 ? '' : 's'})`)
  console.log(`  tokens in ${fmtTokens(t.token.input)} · out ${fmtTokens(t.token.output)} · total ${fmtTokens(t.token.total)} · cost $${t.cost.toFixed(4)}`)

  console.log('\n  Cost by member (top cost centers):')
  for (const x of report.topCost) {
    const err = report.byMember[x.member]?.errors ?? 0
    const costPct = t.cost > 0 ? ((x.cost / t.cost) * 100).toFixed(0) : '0'
    console.log(`    ${x.member.padEnd(16)} $${x.cost.toFixed(4).padEnd(8)} ${err} err  (${costPct}% of total cost)`)
  }

  console.log('\n  Context pressure (highest input-token runs):')
  for (const x of report.topContext) {
    console.log(`    ${x.member.padEnd(16)} max ${fmtTokens(x.maxInputTokens).padEnd(6)} · avg ${fmtTokens(x.avgInputTokens).padEnd(6)} input tok`)
  }

  if (report.contextUtil) {
    const u = report.contextUtil
    console.log(`\n  Context-window utilization: p50 ${(u.p50 * 100).toFixed(0)}% · p90 ${(u.p90 * 100).toFixed(0)}% · p99 ${(u.p99 * 100).toFixed(0)}%`)
  } else {
    console.log('\n  Context-window utilization: n/a (enable per-step context tracking for this metric)')
  }

  if (report.costTrend && report.costTrend.changePct !== Infinity) {
    const signed = report.costTrend.changePct >= 0 ? '+' : ''
    console.log(`\n  Cost trend: first-half $${report.costTrend.first.toFixed(4)} → second-half $${report.costTrend.second.toFixed(4)} (${signed}${Math.round(report.costTrend.changePct * 100)}%)`)
  }

  console.log('\n  Output/input ratio (efficiency, higher = more output per token):')
  for (const x of report.highestOutputRatio) {
    console.log(`    ${x.member.padEnd(16)} ${(x.ratio * 100).toFixed(1)}%`)
  }
  console.log('')
}

async function main(): Promise<void> {
  const tracesPath = resolve(process.cwd(), '.agenthood', 'traces', 'traces.ndjson')
  if (!existsSync(tracesPath)) {
    console.error(`No trace data at ${tracesPath}. Run \`npm run run\`/daemon sessions first.`)
    process.exitCode = 1
    return
  }
  const envelopes: TraceEnvelope[] = readFileSync(tracesPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => {
      if (line.trim() === '') return null
      try {
        return JSON.parse(line) as TraceEnvelope
      } catch {
        return null
      }
    })
    .filter((e): e is TraceEnvelope => e !== null)

  print(buildInsightsReport(envelopes))
}

main().catch((err) => {
  console.error(`[insights] ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})