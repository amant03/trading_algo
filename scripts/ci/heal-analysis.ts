// Heal carried analysis entries: recompute ALL derived fields from stored metrics.
//
// Root cause of the great PEG-null mystery (231/370 stocks, e.g. SHRIRAMFIN
// showing peg=null despite pe=18.18 + growth=29.5): coverage-batch entries
// are written once and carried forward forever. The PEG fallbacks in
// buildEntry/applyScreener only run for freshly built entries, so old
// entries keep whatever they were born with — including nulls and stale
// screens/verdicts.
//
// This script re-runs every carried entry through metrics-rebuild +
// buildEntry with CURRENT code: identical inputs reproduce identical outputs,
// stale derived values (peg, growth, screens, verdict, opinion) heal.
// No DB, no network — pure recompute. Idempotent.
//
// Preserved verbatim: management (management.ts step), peers, reports,
// financials, description, analyst targets, price, marketCap.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { emptyMetrics, buildEntry, type Metrics } from '../../frontend/src/lib/funda.js';

const ANALYSIS_FILE = join(process.cwd(), 'frontend', 'public', 'analysis.json');

function metricsFromStored(e: any): Metrics | null {
  if (!e?.symbol) return null;
  const m = emptyMetrics(e.symbol, {
    name: e.name ?? e.symbol,
    sector: e.sector ?? null,
    industry: e.industry ?? null,
  });
  m.price = Number(e.price ?? 0);
  if (!(m.price > 0)) return null;
  const met = e.metrics ?? {};
  for (const [k, v] of Object.entries(met)) {
    if (v != null && v !== '' && isFinite(Number(v))) {
      (m as unknown as Record<string, unknown>)[k] = Number(v);
    }
  }
  if (typeof e.description === 'string' && e.description) m.description = e.description;
  const verdict = e.verdict ?? {};
  for (const k of ['targetLow', 'targetMean', 'targetHigh', 'analysts'] as const) {
    const v = verdict[k];
    if (v != null && isFinite(Number(v))) (m as unknown as Record<string, unknown>)[k] = Number(v);
  }
  if (e.marketCap != null && isFinite(Number(e.marketCap))) m.marketCap = Number(e.marketCap);
  m.growth = m.earningsGrowth ?? m.revenueGrowth ?? m.growth;
  return m;
}

async function main(): Promise<void> {
  const raw = JSON.parse(readFileSync(ANALYSIS_FILE, 'utf8')) as {
    generatedAt?: string;
    stocks?: Record<string, any>;
    [k: string]: unknown;
  };
  const stocks = raw.stocks ?? {};
  const syms = Object.keys(stocks);
  let healed = 0;
  let pegFixed = 0;
  let screensChanged = 0;
  for (const sym of syms) {
    const e = stocks[sym];
    if (!e || typeof e !== 'object') continue;
    const beforePeg = e.metrics?.peg ?? null;
    const beforeLynch = e.screens?.lynch?.thesis ?? null;
    const m = metricsFromStored(e);
    if (!m) continue;
    const rebuilt = buildEntry({
      symbol: sym,
      name: e.name ?? sym,
      m,
      price: m.price,
      peers: e.peers ?? [],
      reports: e.reports ?? null,
      financials: e.financials ?? null,
    });
    // buildEntry nulls management — restore the management.ts product
    (rebuilt as any).management = e.management ?? null;
    if ((rebuilt.metrics.peg ?? null) !== (beforePeg ?? null)) {
      pegFixed += 1;
      if (beforePeg == null) healed += 1;
    }
    if ((rebuilt.screens?.lynch?.thesis ?? null) !== beforeLynch) screensChanged += 1;
    stocks[sym] = rebuilt;
  }
  raw.stocks = stocks;
  raw.generatedAt = new Date().toISOString();
  writeFileSync(ANALYSIS_FILE, JSON.stringify(raw));
  console.log(
    `heal-analysis: ${syms.length} entries recomputed · peg nulls healed ${healed} · peg values changed ${pegFixed} · lynch theses changed ${screensChanged}`,
  );
}

main().catch((e) => {
  console.error('heal-analysis failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
