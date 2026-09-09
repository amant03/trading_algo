// Reproduce + verify Screener.in ratio extraction against raw HTML.
// Usage:
//   npx tsx scripts/ci/verify-screener.ts              # saved LODHA HTML + live sample
//   npx tsx scripts/ci/verify-screener.ts --offline     # saved HTML only
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  parseScreenerViewFromHtml,
  classifyScreenerPage,
  fetchRealFundamentals,
  applyScreener,
  emptyMetrics,
  parseFinologyHtml,
  pegFromPeAndGrowth,
} from '../../frontend/src/lib/funda.js';

const ROOT = join(process.cwd());
const fail: string[] = [];
const ok: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) ok.push(name);
  else fail.push(detail ? `${name}: ${detail}` : name);
}

function near(a: number | null | undefined, b: number, tol: number): boolean {
  return a != null && Number.isFinite(a) && Math.abs(a - b) <= tol;
}

function runSaved() {
  const consPath = join(ROOT, 'tmp', 'lodha-consolidated.html');
  const stdPath = join(ROOT, 'tmp', 'lodha-default.html');
  if (!existsSync(consPath) || !existsSync(stdPath)) {
    console.log('skip saved-HTML (tmp/lodha-*.html missing)');
    return;
  }
  const consH = readFileSync(consPath, 'utf8');
  const stdH = readFileSync(stdPath, 'utf8');
  check('classify consolidated', classifyScreenerPage(consH) === 'consolidated', String(classifyScreenerPage(consH)));
  check('classify standalone', classifyScreenerPage(stdH) === 'standalone', String(classifyScreenerPage(stdH)));

  const cons = parseScreenerViewFromHtml(consH, 'consolidated');
  const std = parseScreenerViewFromHtml(stdH, 'standalone');
  const d = cons.derived;
  const s = cons.snapshot;

  check('cons P&L rows', (cons.pl?.rows.length ?? 0) >= 8, String(cons.pl?.rows.length));
  check('cons BS rows', (cons.bs?.rows.length ?? 0) >= 6, String(cons.bs?.rows.length));
  check('cons ratio rows', (cons.ratios?.rows.length ?? 0) >= 4, String(cons.ratios?.rows.map((r) => r.label)));
  check('cons sales present', (d?.sales ?? 0) > 1000, String(d?.sales));
  check('cons net profit present', (d?.netProfit ?? 0) > 100, String(d?.netProfit));
  check('cons ROE ~15.5 (strip)', near(s.roe, 15.5, 1) || near(d?.roe, 15.5, 3), `strip=${s.roe} der=${d?.roe}`);
  check('cons ROCE ~16.4 (strip)', near(s.roce, 16.4, 1) || near(d?.roce, 16.4, 4), `strip=${s.roce} der=${d?.roce}`);
  check('cons ROA derived', d?.roa != null && d.roa > 0, String(d?.roa));
  check('cons net margin', d?.netMargin != null && d.netMargin > 5, String(d?.netMargin));
  check('cons D/E present', d?.debtToEquity != null, String(d?.debtToEquity));
  check('cons debtor days', d?.debtorDays != null && d.debtorDays > 0, String(d?.debtorDays));
  check('ROCE unit is pct not 0.16', (d?.roce ?? 0) > 1, String(d?.roce));
  check('standalone exists separately', std.derived?.sales != null && std.derived.sales !== d?.sales, `std=${std.derived?.sales} cons=${d?.sales}`);
  check('standalone P&L', (std.pl?.rows.length ?? 0) >= 6, String(std.pl?.rows.length));

  const m = emptyMetrics('LODHA', { name: 'Lodha', price: s.price ?? 0 });
  applyScreener(m, {
    symbol: 'LODHA',
    name: 'Lodha Developers Ltd',
    broadSector: 'Real Estate',
    sector: 'Realty',
    industry: 'Real Estate - Development',
    sectorKind: 'realty',
    defaultView: 'consolidated',
    views: { consolidated: cons, standalone: std },
    bank: null,
    finology: null,
  });
  check('applied ROE', m.roe != null && m.roe > 5, String(m.roe));
  check('applied ROCE', m.roce != null && m.roce > 5, String(m.roce));
  check('applied D/E', m.debtToEquity != null, String(m.debtToEquity));
  check('applied PEG from Screener PE/growth', m.peg != null && m.peg > 0, String(m.peg));

  const finoPath = join(ROOT, 'tmp', 'fino-LODHA.html');
  if (existsSync(finoPath)) {
    const fino = parseFinologyHtml(readFileSync(finoPath, 'utf8'));
    check('finology LODHA ratio cards', fino.ratios.length >= 6, String(fino.ratios.map((r) => r.label)));
    check('finology LODHA has D/E', fino.ratios.some((r) => /debt/i.test(r.label) && r.value != null), JSON.stringify(fino.ratios.find((r) => /debt/i.test(r.label))));
    check('finology LODHA ROE', fino.essentials.some((e) => e.key === 'roe' && (e.value ?? 0) > 10), String(fino.essentials.find((e) => e.key === 'roe')?.value));
  }
  check('PEG formula PE/growth', pegFromPeAndGrowth(28.3, 103.3) === 0.27, String(pegFromPeAndGrowth(28.3, 103.3)));

  console.log('\nLODHA consolidated derived:', JSON.stringify({
    latestYear: d?.latestYear,
    sales: d?.sales,
    netProfit: d?.netProfit,
    roe: d?.roe,
    roce: d?.roce,
    roa: d?.roa,
    netMargin: d?.netMargin,
    operatingMargin: d?.operatingMargin,
    revenueGrowth: d?.revenueGrowth,
    earningsGrowth: d?.earningsGrowth,
    peg: d?.peg,
    debtToEquity: d?.debtToEquity,
    currentRatio: d?.currentRatio,
    debtorDays: d?.debtorDays,
    strip: s,
    ratioRows: cons.ratios?.rows.map((r) => `${r.label} [${r.unit}] last=${r.values[r.values.length - 1]}`),
    plRows: cons.pl?.rows.map((r) => r.label),
    bsRows: cons.bs?.rows.map((r) => r.label),
  }, null, 2));
}

async function runLive(symbols: string[]) {
  for (const sym of symbols) {
    process.stdout.write(`live ${sym} ... `);
    try {
      const sf = await fetchRealFundamentals(sym);
      if (!sf) {
        fail.push(`${sym}: fetch returned null`);
        console.log('NULL');
        continue;
      }
      const v = sf.views[sf.defaultView];
      const d = v?.derived;
      check(`${sym} has default view`, !!v, sf.defaultView);
      check(`${sym} ROE`, d?.roe != null || v?.snapshot.roe != null, `roe=${d?.roe} strip=${v?.snapshot.roe}`);
      check(`${sym} ROCE`, d?.roce != null || v?.snapshot.roce != null, `roce=${d?.roce}`);
      check(`${sym} PEG`, (v?.derived?.peg != null && v.derived.peg > 0) || sf.finology?.peg != null || (v?.snapshot.pe != null && (d?.earningsGrowth ?? 0) > 0), `peg=${v?.derived?.peg} pe=${v?.snapshot.pe} g=${d?.earningsGrowth}`);
      if (sf.finology) {
        check(`${sym} Finology ratios`, sf.finology.ratios.length >= 4, String(sf.finology.ratios.map((r) => r.label)));
      }
      check(`${sym} sales or bank`, (d?.sales ?? 0) > 0 || sf.sectorKind === 'bank' || sf.sectorKind === 'nbfc' || sf.sectorKind === 'amc' || sf.sectorKind === 'insurance', String(d?.sales));
      if (sf.sectorKind === 'bank' || sf.sectorKind === 'nbfc') {
        check(`${sym} NPA`, sf.bank?.grossNpa != null || sf.bank?.netNpa != null, JSON.stringify(sf.bank));
      }
      const views = Object.keys(sf.views);
      check(`${sym} at least one view`, views.length >= 1, views.join(','));
      console.log(`ok views=${views.join('+')} kind=${sf.sectorKind} peg=${d?.peg} roe=${d?.roe} fino=${sf.finology?.ratios.length ?? 0}`);
    } catch (e) {
      fail.push(`${sym}: ${e instanceof Error ? e.message : e}`);
      console.log('ERR');
    }
  }
}

async function main() {
  runSaved();
  const offline = process.argv.includes('--offline');
  if (!offline) {
    await runLive(['LODHA', 'HDFCBANK', 'RELIANCE', 'TCS', 'INFY', 'SBIN', 'ICICIAMC']);
  }
  console.log(`\n${ok.length} passed, ${fail.length} failed`);
  if (fail.length) {
    for (const f of fail) console.error('  FAIL', f);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
