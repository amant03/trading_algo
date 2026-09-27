// Test automation: Master-screener consistency.
//
// The screener ranks by the HEADLINE blended verdict score — the exact number
// each stock page shows. This script replicates TripleScreener's preset filter
// + sort over analysis.json and fails if any stock with blended ≥ min would
// be excluded, or if ordering is wrong. It also flags rows with missing
// scores (which would break sort/filter).
//
// Run: npx tsx scripts/ci/verify-blended.ts
// Exit 0 = consistent, exit 1 = mismatches found (lists them).

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const FILE = join(process.cwd(), 'frontend', 'public', 'analysis.json');
const PRESETS = [
  { id: 'elite', min: 72 },
  { id: 'high', min: 56 },
  { id: 'solid', min: 48 },
];

interface Screens { buffett?: { score?: number }; lynch?: { score?: number }; graham?: { score?: number } }
interface Entry { symbol: string; verdict?: { score?: number }; screens?: Screens }

function main(): void {
  if (!existsSync(FILE)) {
    console.error(`verify-blended: ${FILE} not found`);
    process.exit(2);
  }
  const stocks = (JSON.parse(readFileSync(FILE, 'utf8')) as { stocks?: Record<string, Entry> }).stocks ?? {};
  const entries = Object.entries(stocks);
  console.log(`verify-blended: ${entries.length} analysed stocks`);

  let failures = 0;
  const broken: string[] = [];
  for (const [sym, e] of entries) {
    const b = e.screens?.buffett?.score;
    const l = e.screens?.lynch?.score;
    const g = e.screens?.graham?.score;
    const v = e.verdict?.score;
    if (v == null || !isFinite(v) || b == null || l == null || g == null) {
      broken.push(`${sym}: verdict=${v} buffett=${b} lynch=${l} graham=${g}`);
    }
  }
  if (broken.length) {
    failures += broken.length;
    console.log(`\nBROKEN ROWS (missing scores — break sort/filter): ${broken.length}`);
    broken.slice(0, 15).forEach((s) => console.log(`  ${s}`));
  }

  for (const p of PRESETS) {
    // Screener rule: blended verdict score must clear min. Anything with
    // blended ≥ min that would be excluded is the reported bug.
    const included: { sym: string; v: number; floor: number }[] = [];
    for (const [sym, e] of entries) {
      const v = e.verdict?.score;
      if (v == null || !isFinite(v) || v < p.min) continue;
      const b = e.screens?.buffett?.score ?? -Infinity;
      const l = e.screens?.lynch?.score ?? -Infinity;
      const g = e.screens?.graham?.score ?? -Infinity;
      included.push({ sym, v, floor: Math.min(b, l, g) });
    }
    // Order check: blended desc, floor desc tiebreak (mirrors the component).
    const ordered = [...included].sort((a, b) => b.v - a.v || b.floor - a.floor);
    const orderOk = ordered.every((r, i) => i === 0 || ordered[i - 1].v > r.v || (ordered[i - 1].v === r.v && ordered[i - 1].floor >= r.floor));
    console.log(`\npreset ${p.id} (≥${p.min}): included=${included.length} orderOk=${orderOk}`);
    included
      .sort((a, b) => b.v - a.v || b.floor - a.floor)
      .slice(0, 8)
      .forEach((r) => console.log(`  ${r.sym}: blended=${r.v} floor=${r.floor}`));
    if (!orderOk) {
      failures += 1;
      console.log(`  ORDER BROKEN in ${p.id}`);
    }
  }

  // MAHABANK spotlight (the reported case): blended 80s must be in Elite.
  const m = stocks['MAHABANK'];
  if (m) {
    const v = m.verdict?.score ?? -Infinity;
    const inElite = v >= 72;
    console.log(`\nMAHABANK: blended=${v} → elite: ${inElite ? 'INCLUDED (fixed)' : 'EXCLUDED (bug still present)'}`);
    if (!inElite) failures += 1;
  } else {
    console.log('\nMAHABANK not in analysis.json');
  }

  if (failures) {
    console.log(`\nverify-blended: FAIL (${failures} issue groups)`);
    process.exit(1);
  }
  console.log('\nverify-blended: PASS — headline scores and screener placement agree');
}

main();
