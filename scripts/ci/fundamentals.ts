// Deep fundamentals + analyst model.
//
// Pulls real company data from Yahoo Finance quoteSummary (crumb-authenticated)
// for every NSE symbol, overlays it on the DB fundamentals, then scores each
// stock with three classic discipline screens:
//   - Warren Buffett: quality compounder (high ROE, fat margins, low debt)
//   - Peter Lynch:  growth-at-a-reasonable-price (PEG, fair P/E ~ growth rate)
//   - Benjamin Graham: value + margin of safety (defensive criteria, Graham
//     number = sqrt(22.5 * EPS * BVPS))
// Blends them into an overall rating + fair-value band and writes
// `frontend/public/analysis.json` (bundled into the UI snapshot).
//
// Characterizing logic lives in `frontend/src/lib/funda.ts` and is shared with
// the on-demand Vercel function `frontend/api/funda.ts`, so a symbol analysed
// at runtime has the exact same shape as one analysed nightly.
//
// Coverage growth (COVERAGE_BATCH, default 40/night):
//   * the DB seed (52) is recomputed every run,
//   * any symbol already present in the previous analysis.json (from the
//     automation-data branch) is carried forward,
//   * the next COVERAGE_BATCH symbols from `frontend/public/universe.json`
//     (by market cap, descending) are added, so the universe slowly but surely
//     expands towards the full 5k+ Indian universe without a click ever being
//     required.
//
// Best-effort: if Yahoo is unreachable the screens still run on the DB
// fundamentals and the file is marked source='db'.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { pool } from '@trading/shared';
import { INSTRUMENTS as SEED } from '../../services/shared/src/instruments-data.js';
import {
  emptyMetrics,
  applyYahoo,
  extractCompanion,
  screenerPeers,
  makeYahoo,
  buildEntry,
  reportLinks,
} from '../../frontend/src/lib/funda.js';

interface Row {
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  base_price: number;
  pe: number | null;
  pb: number | null;
  ps: number | null;
  peg: number | null;
  roe: number | null;
  roce: number | null;
  roa: number | null;
  debt_to_equity: number | null;
  current_ratio: number | null;
  quick_ratio: number | null;
  gross_margin: number | null;
  operating_margin: number | null;
  net_margin: number | null;
  revenue_growth: number | null;
  net_income_growth: number | null;
  dividend_yield: number | null;
  eps: number | null;
  book_value: number | null;
  beta: number | null;
  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;
  avg_volume: number | null;
  promoter_holding: number | null;
  fii_holding: number | null;
}

function metricsFromRow(r: Row, price: number) {
  const m = emptyMetrics(r.symbol, {
    name: r.symbol,
    sector: r.sector ?? SEED.find((s) => s.symbol === r.symbol)?.sector ?? null,
    industry: r.industry ?? null,
  });
  m.price = price;
  if (r.pe != null) m.pe = Number(r.pe);
  if (r.pb != null) m.pb = Number(r.pb);
  if (r.ps != null) m.ps = Number(r.ps);
  if (r.peg != null) m.peg = Number(r.peg);
  if (r.roe != null) m.roe = Number(r.roe);
  if (r.roce != null) m.roce = Number(r.roce);
  if (r.roa != null) m.roa = Number(r.roa);
  if (r.net_margin != null) m.netMargin = Number(r.net_margin);
  if (r.operating_margin != null) m.operatingMargin = Number(r.operating_margin);
  if (r.gross_margin != null) m.grossMargin = Number(r.gross_margin);
  if (r.revenue_growth != null) m.revenueGrowth = Number(r.revenue_growth);
  if (r.net_income_growth != null) m.earningsGrowth = Number(r.net_income_growth);
  if (r.debt_to_equity != null) m.debtToEquity = Number(r.debt_to_equity);
  if (r.current_ratio != null) m.currentRatio = Number(r.current_ratio);
  if (r.quick_ratio != null) m.quickRatio = Number(r.quick_ratio);
  if (r.dividend_yield != null) m.dividendYield = Number(r.dividend_yield);
  if (r.eps != null) m.eps = Number(r.eps);
  if (r.book_value != null) m.bookValue = Number(r.book_value);
  if (r.beta != null) m.beta = Number(r.beta);
  if (r.fifty_two_week_high != null) m.fiftyTwoWeekHigh = Number(r.fifty_two_week_high);
  if (r.fifty_two_week_low != null) m.fiftyTwoWeekLow = Number(r.fifty_two_week_low);
  if (r.avg_volume != null) m.avgVolume = Number(r.avg_volume);
  if (r.promoter_holding != null) m.promoterHolding = Number(r.promoter_holding);
  if (r.fii_holding != null) m.fiiHolding = Number(r.fii_holding);
  m.growth = m.earningsGrowth ?? m.revenueGrowth;
  return m;
}

const BATCH = Number(process.env.COVERAGE_BATCH ?? '40');
const ANALYSIS_FILE = join(process.cwd(), 'frontend', 'public', 'analysis.json');
const UNIVERSE_FILE = join(process.cwd(), 'frontend', 'public', 'universe.json');

async function main(): Promise<void> {
  const rowsRes = await pool.query<Row>(
    `SELECT i.symbol, i.name, i.sector, i.industry, i.base_price,
            f.pe, f.pb, f.ps, f.peg, f.roe, f.roce, f.roa, f.debt_to_equity,
            f.current_ratio, f.quick_ratio, f.gross_margin, f.operating_margin,
            f.net_margin, f.revenue_growth, f.net_income_growth, f.dividend_yield,
            f.eps, f.book_value, f.beta, f.fifty_two_week_high, f.fifty_two_week_low,
            f.avg_volume, f.promoter_holding, f.fii_holding
     FROM instruments i
     LEFT JOIN fundamentals f ON f.instrument_id = i.id
     WHERE i.status = 'ACTIVE'
     ORDER BY i.symbol`,
  );
  const rows = rowsRes.rows as Row[];

  // latest daily close per symbol (real NSE data when present)
  const sparkRes = await pool.query<{ symbol: string; ts: Date; close: number }>(
    `SELECT t.symbol, t.ts, t.close FROM (
        SELECT i.symbol, c.ts, c.close,
               ROW_NUMBER() OVER (PARTITION BY c.instrument_id ORDER BY c.ts DESC) rn
        FROM candles c JOIN instruments i ON i.id = c.instrument_id
        WHERE c.timeframe = '1d'
       ) t WHERE t.rn <= 40 ORDER BY t.symbol, t.ts`,
  );
  const spark: Record<string, [number, number][]> = {};
  for (const s of sparkRes.rows) {
    (spark[s.symbol] ??= []).push([new Date(s.ts).getTime(), Number(s.close)]);
  }

  // carry forward everything from the previous run so coverage grows
  // monotonically (the workflow pre-stages the automation-data analysis.json).
  const stocks: Record<string, any> = {};
  let prevUniverse = 0;
  if (existsSync(ANALYSIS_FILE)) {
    try {
      const prev = JSON.parse(readFileSync(ANALYSIS_FILE, 'utf8')) as {
        stocks?: Record<string, any>;
        sparklines?: Record<string, [number, number][]>;
      };
      if (prev.stocks) {
        for (const [sym, e] of Object.entries(prev.stocks)) {
          if (e && typeof e === 'object') {
            stocks[sym] = e;
            prevUniverse += 1;
          }
        }
      }
      if (prev.sparklines) {
        for (const [sym, pts] of Object.entries(prev.sparklines)) {
          if (!spark[sym]) spark[sym] = pts;
        }
      }
    } catch {
      // ignore corrupt previous file
    }
  }

  const seedName = new Map(SEED.map((s) => [s.symbol, s.name]));
  const dbRows = new Set(rows.map((r) => r.symbol));

  const yahoo = await makeYahoo();
  const yahooPeersPer: Record<string, string[]> = {};
  const quarterEndPer: Record<string, string | null> = {};
  let yahooTouched = 0;

  // ---- 1. DB seed (recomputed fresh every run) --------------------------
  for (const r of rows) {
    const price = spark[r.symbol]?.length
      ? Number(spark[r.symbol][spark[r.symbol].length - 1][1])
      : Number(r.base_price);
    const m = metricsFromRow(r, price);

    let yahooData: Record<string, any> | null = null;
    if (yahoo.ok) {
      try {
        yahooData = await yahoo.quoteSummary(`${r.symbol}.NS`);
        const { updated } = applyYahoo(m, yahooData);
        if (updated.length) yahooTouched += 1;
      } catch {
        yahooData = null;
      }
    }
    const companion = extractCompanion(yahooData);
    yahooPeersPer[r.symbol] = companion.peers;
    quarterEndPer[r.symbol] = companion.quarterEnd;

    const entry = buildEntry({
      symbol: r.symbol,
      name: seedName.get(r.symbol) ?? r.symbol,
      m,
      price,
      quarterEnd: companion.quarterEnd,
    });
    stocks[r.symbol] = entry;
  }

  // ---- 2. nightly coverage batch (market-cap order) ----------------------
  let universe: Array<{ symbol: string; name: string; mktCap: number | null }> = [];
  if (BATCH > 0 && existsSync(UNIVERSE_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(UNIVERSE_FILE, 'utf8')) as {
        stocks?: Array<{ symbol: string; name: string; mktCap?: number | null; cap?: string | null }>;
      };
      if (Array.isArray(raw.stocks)) {
        universe = raw.stocks.map((u) => ({ symbol: u.symbol, name: u.name, mktCap: u.mktCap ?? null }));
      }
    } catch {
      universe = [];
    }
  }

  const covered = new Set(Object.keys(stocks));
  const candidates = universe
    .filter((u) => u.symbol && !covered.has(u.symbol) && !dbRows.has(u.symbol))
    .sort((a, b) => (b.mktCap ?? 0) - (a.mktCap ?? 0))
    .slice(0, BATCH);

  for (const u of candidates) {
    const m = emptyMetrics(u.symbol, { name: u.name });
    let yahooData: Record<string, any> | null = null;
    if (yahoo.ok) {
      try {
        yahooData = await yahoo.quoteSummary(`${u.symbol}.NS`);
        applyYahoo(m, yahooData);
      } catch {
        yahooData = null;
      }
    }
    if (!(m.price > 0)) continue; // stale/no listing — skip until next nightly
    const companion = extractCompanion(yahooData);
    yahooPeersPer[u.symbol] = companion.peers;
    quarterEndPer[u.symbol] = companion.quarterEnd;
    const entry = buildEntry({
      symbol: u.symbol,
      name: u.name,
      m,
      price: m.price,
      quarterEnd: companion.quarterEnd,
    });
    stocks[u.symbol] = entry;
  }

  // ---- 3. competition (peers) + disclosure reports -----------------------
  const allSyms = new Set(Object.keys(stocks));
  const byIndustry = new Map<string, string[]>();
  const bySector = new Map<string, string[]>();
  const universeName = new Map(universe.map((u) => [u.symbol, u.name]));
  for (const sym of allSyms) {
    const e = stocks[sym] as { industry?: string | null; sector?: string | null };
    const ind = e.industry;
    const sec = e.sector;
    if (ind) (byIndustry.get(ind) ?? byIndustry.set(ind, []).get(ind)!).push(sym);
    if (sec) (bySector.get(sec) ?? bySector.set(sec, []).get(sec)!).push(sym);
  }

  // Real competitors from Screener.in's peer table (pooled, best-effort —
  // Yahoo's esgScores.peers was garbage and its role is demoted to a last
  // resort below).
  const screenerPeersPer: Record<string, string[]> = {};
  {
    const syms = [...allSyms].sort();
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const idx = cursor;
        cursor += 1;
        if (idx >= syms.length) return;
        const sym = syms[idx];
        try {
          const p = await screenerPeers(sym);
          if (p.length) screenerPeersPer[sym] = p;
        } catch {
          // keep default industry/sector fallback
        }
        await new Promise((r) => setTimeout(r, 40));
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, syms.length) }, worker));
  }

  for (const sym of allSyms) {
    const e = stocks[sym] as {
      industry?: string | null;
      sector?: string | null;
      name?: string;
      peers?: unknown;
      reports?: unknown;
    };
    const peers = new Set<string>();
    const ind = e.industry;
    const sec = e.sector;
    // 1. Screener.in direct competitors (authoritative)
    for (const p of screenerPeersPer[sym] ?? []) peers.add(p);
    // 2. same-industry + same-sector augmentation to a full bucket
    let filled = peers.size;
    for (const ext of [ind ? byIndustry.get(ind) : [], sec ? bySector.get(sec) : []]) {
      for (const s of ext ?? []) {
        if (s === sym || peers.has(s)) continue;
        peers.add(s);
        filled += 1;
        if (filled >= 9) break;
      }
      if (filled >= 9) break;
    }
    // 3. Yahoo ESG peers as a last resort only (often wrong — filtered hard)
    if (!peers.size) {
      for (const p of yahooPeersPer[sym] ?? []) {
        const clean = p.replace(/\.(NS|NSE|BO)$/i, '').toUpperCase();
        if (allSyms.has(clean)) peers.add(clean);
      }
    }
    e.peers = [...peers]
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 9)
      .map((s) => {
        const pe = stocks[s] as { name?: string | null; industry?: string | null; sector?: string | null } | undefined;
        return {
          symbol: s,
          name: pe?.name ?? universeName.get(s) ?? s,
          industry: pe?.industry ?? null,
          sector: pe?.sector ?? null,
        };
      });
    e.reports = reportLinks(sym, e.name ?? universeName.get(sym) ?? sym, quarterEndPer[sym] ?? null);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: yahoo.ok && yahooTouched > 0 ? 'yahoo' : 'db',
    universe: allSyms.size,
    seed: dbRows.size,
    batch: candidates.length,
    carried: prevUniverse,
    stocks,
    sparklines: spark,
  };

  mkdirSync(join(process.cwd(), 'frontend', 'public'), { recursive: true });
  writeFileSync(ANALYSIS_FILE, JSON.stringify(out));

  console.log(
    `fundamentals: ${dbRows.size} seed + ${candidates.length} batch + ${prevUniverse} carried = ${allSyms.size} stocks (source=${out.source}, yahooFields=${yahooTouched})`,
  );
  await pool.end();
}

main().catch(async (e) => {
  console.error('fundamentals failed:', e instanceof Error ? e.message : e);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});