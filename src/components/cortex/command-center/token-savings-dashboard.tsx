'use client'

/**
 * Phase 4 — Token Savings & Local Routing Telemetry Dashboard
 * (blueprint PHASE_4 §1.3 `TokenSavingsDashboard.tsx`).
 *
 * Real-time token compression analytics from the Token Savings Engine:
 *   - daily stacked bars: naive raw-context baseline vs the optimized
 *     (compact sync-packet) tokens actually injected
 *   - local Ollama executions overlaid per day
 *   - local-vs-cloud offload split with the 65% target marker
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Coins, Cpu, TrendingDown } from 'lucide-react'
import type { TokenTelemetrySummary } from '@/lib/cortex/types'
import { formatNumber } from '../shared'

export function TokenSavingsDashboard({ telemetry }: { telemetry: TokenTelemetrySummary }) {
  const data = telemetry.historyByDay.map((day) => ({
    date: day.date.slice(5), // MM-DD
    optimized: day.optimizedTokens,
    avoided: Math.max(0, day.rawTokens - day.optimizedTokens),
    local: day.localExecutions,
  }))

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {/* Daily compression chart */}
      <div className="xl:col-span-2">
        {data.length > 0 ? (
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => formatNumber(v)}
                />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={32} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 11,
                    color: 'hsl(var(--popover-foreground))',
                  }}
                  formatter={(value: number, name: string) =>
                    name === 'local executions' ? [value, name] : [value.toLocaleString(), name]
                  }
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="avoided" name="context avoided (tokens)" stackId="a" fill="#10b981" fillOpacity={0.75} radius={[0, 0, 0, 0]} />
                <Bar dataKey="optimized" name="injected sync packets (tokens)" stackId="a" fill="#6366f1" fillOpacity={0.8} radius={[3, 3, 0, 0]} />
                <Line yAxisId="right" dataKey="local" name="local executions" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2.5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex h-[240px] flex-col items-center justify-center text-center">
            <TrendingDown className="mb-2 size-7 text-muted-foreground/50" />
            <p className="text-sm font-medium">No intercepted turns in the last 14 days</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Run a Tier-1 rewrite or a pre-execution agent turn and the daily compression history appears here.
            </p>
          </div>
        )}
      </div>

      {/* Offload split */}
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3.5">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Cpu className="size-3.5 text-amber-500" /> Local vs cloud routing
          </p>
          <div className="mt-2.5 flex h-6 w-full overflow-hidden rounded-md border border-border/60">
            <div
              className="flex items-center justify-center bg-emerald-500/70 text-[10px] font-mono font-semibold text-white"
              style={{ width: `${Math.max(0, Math.min(100, telemetry.localOffloadPct))}%` }}
              title={`${telemetry.localOllamaOffloadCount} local turns`}
            >
              {telemetry.localOffloadPct >= 18 ? `${telemetry.localOffloadPct.toFixed(0)}%` : ''}
            </div>
            <div
              className="flex flex-1 items-center justify-center bg-rose-500/50 text-[10px] font-mono font-semibold text-rose-50"
              title={`${telemetry.cloudEscalationCount} cloud turns`}
            >
              {telemetry.localOffloadPct <= 82 ? `${(100 - telemetry.localOffloadPct).toFixed(0)}%` : ''}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{telemetry.localOllamaOffloadCount} local (0 cloud tokens)</span>
            <span>{telemetry.cloudEscalationCount} cloud escalations</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <MiniStat
            label="Compression"
            value={`${telemetry.compressionRatioPct.toFixed(1)}%`}
            sub="vs naive context dumps"
          />
          <MiniStat
            label="Cost saved"
            value={`$${telemetry.estimatedCostSavingsUsd.toFixed(2)}`}
            sub={`@ $${telemetry.pricingUsdPerMTokens}/M tokens`}
          />
          <MiniStat label="Raw est." value={formatNumber(telemetry.rawContextTokensEstimated)} sub="naive tokens" />
          <MiniStat label="Injected" value={formatNumber(telemetry.injectedSyncPacketTokens)} sub="sync-packet tokens" />
        </div>

        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <Coins className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
          Net saved: <span className="font-mono font-semibold text-emerald-500">{telemetry.netTokensSaved.toLocaleString()} tokens</span> across{' '}
          {telemetry.totalPromptsIntercepted} intercepted prompts.
        </p>
      </div>
    </div>
  )
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-lg font-semibold tabular-nums">{value}</p>
      <p className="truncate text-[10px] text-muted-foreground">{sub}</p>
    </div>
  )
}
