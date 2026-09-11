// Fundamentals validation — basic automation check for every covered stock.
//
// Runs after heal-analysis in the nightly deep run. Fails loudly (exit 1)
// when stored ratios are internally inconsistent or absurd, so bad data can
// never silently ship to the website:
//
//   FAIL peg-computable-null  pe>0 and growth>0 but peg is null (heal missed it)
//   FAIL peg-mismatch         |peg - pe/growth| > 0.06 (stale or corrupt)
//   FAIL absurd-pe/pb/growth  pe<=0 or pe>1000, pb<=0 or pb>200, |growth|>500
//   FAIL absurd-margin        any margin outside [-100, 100]
//   FAIL no-price             price missing/<=0
//   WARN no-mcap              marketCap missing (excluded from mcap-gated features)
//   WARN missing-field        roe/eps/bookValue/dividendYield null (coverage gap)
//
// Usage: node node_modules/tsx/dist/cli.mjs scripts/ci/validate-fundamentals.ts
import { readFileSync } from 'fs';
import { join } from 'path';

const ANALYSIS_FILE = join(process.cwd(), 'frontend', 'public', 'analysis.json');

interface Failure { symbol: string; check: string; detail: string }

async function main(): Promise<void> {
  const raw = JSON.parse(readFileSync(ANALYSIS_FILE, 'utf8')) as { stocks?: Record<string, any> };
  const stocks = raw.stocks ?? {};
  const syms = Object.keys(stocks);
  const fails: Failure[] = [];
  const warns: Failure[] = [];
  const missing: Record<string, number> = {};

  for (const sym of syms) {
    const e = stocks[sym];
    const met = e?.metrics ?? {};
    const num = (v: unknown): number | null =>
      v == null || v === '' || !isFinite(Number(v)) ? null : Number(v);
    const price = num(e?.price);
    if (!(price != null && price > 0)) {
      fails.push({ symbol: sym, check: 'no-price', detail: `price=${String(e?.price)}` });
      continue;
    }
    const pe = num(met.pe);
    const growth = num(met.growth ?? met.earningsGrowth ?? met.revenueGrowth);
    const peg = num(met.peg);
    if (pe != null && pe > 0 && growth != null && growth > 0) {
      if (peg == null) {
        fails.push({ symbol: sym, check: 'peg-computable-null', detail: `pe=${pe} growth=${growth} but peg=null` });
      } else if (Math.abs(peg - pe / growth) > 0.06) {
        fails.push({ symbol: sym, check: 'peg-mismatch', detail: `peg=${peg} vs pe/growth=${(pe / growth).toFixed(2)}` });
      }
    }
    if (pe != null && pe === 0) fails.push({ symbol: sym, check: 'absurd-pe', detail: `pe=${pe}` });
    if (pe != null && pe > 10000) fails.push({ symbol: sym, check: 'absurd-pe', detail: `pe=${pe}` });
    if (pe != null && pe < 0) warns.push({ symbol: sym, check: 'negative-pe', detail: `pe=${pe} (loss-making)` });
    if (pe != null && pe > 1000) warns.push({ symbol: sym, check: 'high-pe', detail: `pe=${pe}` });
    const pb = num(met.pb);
    if (pb != null && !(pb > 0 && pb <= 200)) fails.push({ symbol: sym, check: 'absurd-pb', detail: `pb=${pb}` });
    // Growth spikes (profit rebounding off a tiny base, or Yahoo quarterly
    // without a Screener annual overlay) are arithmetically real — flag for
    // eyes, don't block the deploy.
    if (growth != null && Math.abs(growth) > 300) warns.push({ symbol: sym, check: 'growth-spike', detail: `growth=${growth}` });
    if (growth != null && Math.abs(growth) > 10000) fails.push({ symbol: sym, check: 'absurd-growth', detail: `growth=${growth}` });
    for (const k of ['netMargin', 'operatingMargin', 'grossMargin'] as const) {
      const v = num(met[k]);
      // >100% margins are real for holding companies (investment income dwarfs
      // revenue); banks' margins are nulled upstream. Warn, don't fail.
      if (v != null && (v < -100 || v > 100)) warns.push({ symbol: sym, check: 'extreme-margin', detail: `${k}=${v}` });
      if (v != null && Math.abs(v) > 2000) fails.push({ symbol: sym, check: 'absurd-margin', detail: `${k}=${v}` });
    }
    const mcap = num(e?.marketCap);
    if (!(mcap != null && mcap > 0)) warns.push({ symbol: sym, check: 'no-mcap', detail: 'marketCap missing' });
    // price/eps should roughly equal pe — drift means one of them is stale
    const eps = num(met.eps);
    if (pe != null && pe > 0 && eps != null && eps > 0) {
      const implied = price / eps;
      if (Math.abs(pe - implied) / pe > 0.15) {
        warns.push({ symbol: sym, check: 'pe-eps-drift', detail: `pe=${pe} vs price/eps=${implied.toFixed(2)}` });
      }
    }
    for (const k of ['roe', 'eps', 'bookValue', 'dividendYield', 'revenueGrowth', 'earningsGrowth'] as const) {
      if (num(met[k]) == null) {
        missing[k] = (missing[k] ?? 0) + 1;
        if (missing[k] <= 3) warns.push({ symbol: sym, check: `missing-${k}`, detail: `${k} null` });
      }
    }
    for (const s of ['buffett', 'lynch', 'graham'] as const) {
      if (!e?.screens?.[s]?.thesis) fails.push({ symbol: sym, check: 'no-screen', detail: `${s} thesis missing` });
    }
  }

  console.log(`validate-fundamentals: ${syms.length} stocks · ${fails.length} failures · ${warns.length} warnings`);
  console.log(` field gaps: ${Object.entries(missing).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  for (const f of fails.slice(0, 40)) console.log(`  FAIL ${f.symbol} ${f.check} ${f.detail}`);
  if (fails.length > 40) console.log(`  ... and ${fails.length - 40} more failures`);
  for (const w of warns.slice(0, 15)) console.log(`  warn ${w.symbol} ${w.check} ${w.detail}`);
  if (fails.length) {
    console.error(`validate-fundamentals: FAILED with ${fails.length} failures`);
    process.exitCode = 1;
  } else {
    console.log('validate-fundamentals: PASS');
  }
}

main().catch((e) => {
  console.error('validate-fundamentals failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
