// Publish earnings, revenue, and dividend marks for every NSE stock.
//
// The chart on in.tradingview.com drops an E on the earnings date (EPS and
// revenue, actual against estimate), a D on the dividend ex-date, and the
// price chart reads those from this file. News marks come from news.json
// at render time, so they stay on the same refresh as the news scrape.
//
// Source is the India scanner behind in.tradingview.com. Historical quarter
// ends use TradingView's fiscal label (Q1 ends 30 Jun of that year, Q4 ends
// 31 Mar of the next year), shifted onto fiscal_period_end_fq when that
// timestamp disagrees, then moved forward by the latest reporting lag so
// older E marks sit on the announcement, not the quarter close. The latest
// release and the next release use TradingView's own timestamps.
//
// Writes frontend/public/chart-events.json. A thin scrape leaves a previous
// file in place.
//
// Run: npx tsx scripts/ci/chart-events.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'frontend', 'public', 'chart-events.json');
const PAGE = 60;
const MAX_SYMBOLS = 3600;
const MIN_SYMBOLS = 400;
const HISTORY = 16;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const COLUMNS = [
  'name',
  'earnings_release_date',
  'earnings_release_next_date',
  'fiscal_period_end_fq',
  'earnings_fq_h',
  'total_revenue_fq_h',
  'revenue_fq',
  'revenue_forecast_next_fq',
  'revenue_surprise_fq',
  'earnings_per_share_forecast_next_fq',
  'dividend_ex_date_recent',
  'dividend_amount_recent',
  'dividend_ex_date_upcoming',
  'dividend_amount_upcoming',
] as const;

interface EarnHist {
  Actual: number | null;
  Estimate: number | null;
  FiscalPeriod: string;
  IsReported?: boolean;
}

interface ScanRow {
  s: string;
  d: unknown[];
}

export interface ChartEarn {
  t: number;
  period: string;
  eps: number | null;
  epsEst: number | null;
  revenue: number | null;
  revenueEst: number | null;
  upcoming?: boolean;
}

export interface ChartDiv {
  t: number;
  amount: number | null;
  upcoming?: boolean;
}

interface SymbolEvents {
  earnings: ChartEarn[];
  dividends: ChartDiv[];
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function secs(v: unknown): number | null {
  const n = num(v);
  if (n == null || n <= 0) return null;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

/** TradingView fiscal label → quarter-end unix seconds (UTC midnight). */
function quarterEndUtc(period: string): number | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(period);
  if (!m) return null;
  const year = Number(m[1]);
  const q = Number(m[2]);
  const spec: [number, number, number] =
    q === 1 ? [year, 5, 30] : q === 2 ? [year, 8, 30] : q === 3 ? [year, 11, 31] : [year + 1, 2, 31];
  return Date.UTC(spec[0], spec[1], spec[2]) / 1000;
}

function asEarnHist(v: unknown): EarnHist[] {
  if (!Array.isArray(v)) return [];
  const out: EarnHist[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const row = item as EarnHist;
    if (typeof row.FiscalPeriod !== 'string') continue;
    out.push(row);
  }
  return out;
}

function asNums(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
}

function toEvents(row: ScanRow): { symbol: string; events: SymbolEvents } | null {
  const d = row.d;
  const symbol = typeof d[0] === 'string' && d[0] ? d[0] : row.s.replace(/^NSE:/, '');
  const release = secs(d[1]);
  const nextRelease = secs(d[2]);
  const periodEnd = secs(d[3]);
  const history = asEarnHist(d[4]);
  const revenueHist = asNums(d[5]);
  const revenueFq = num(d[6]);
  const revenueNext = num(d[7]);
  const revenueSurprise = num(d[8]);
  const epsNext = num(d[9]);
  const reported = history.filter((e) => e.IsReported && e.Actual != null);
  const earnings: ChartEarn[] = [];

  const latest = reported[reported.length - 1];
  const computedEnd = latest ? quarterEndUtc(latest.FiscalPeriod) : null;
  const shift = computedEnd != null && periodEnd != null ? periodEnd - computedEnd : 0;
  const anchorEnd = periodEnd ?? (computedEnd != null ? computedEnd + shift : null);
  let lag = 37 * 86400;
  if (release != null && anchorEnd != null && release > anchorEnd && release - anchorEnd < 120 * 86400) {
    lag = release - anchorEnd;
  }

  const take = Math.min(HISTORY, reported.length);
  for (let i = 0; i < take; i++) {
    const earn = reported[reported.length - 1 - i];
    const revenue = revenueHist[i] ?? (i === 0 ? revenueFq : null);
    let t: number | null = null;
    if (i === 0 && release != null) t = release;
    else {
      const end = quarterEndUtc(earn.FiscalPeriod);
      if (end != null) t = Math.floor(end + shift + lag);
    }
    if (t == null) continue;
    let revenueEst: number | null = null;
    if (i === 0 && revenue != null && revenueSurprise != null) revenueEst = revenue - revenueSurprise;
    earnings.push({
      t,
      period: earn.FiscalPeriod,
      eps: num(earn.Actual),
      epsEst: num(earn.Estimate),
      revenue,
      revenueEst,
    });
  }

  if (nextRelease != null && !earnings.some((e) => Math.abs(e.t - nextRelease) < 86400)) {
    const upcoming = history.find((e) => !e.IsReported);
    earnings.push({
      t: nextRelease,
      period: upcoming?.FiscalPeriod ?? '',
      eps: null,
      epsEst: epsNext ?? num(upcoming?.Estimate),
      revenue: null,
      revenueEst: revenueNext,
      upcoming: true,
    });
  }

  const dividends: ChartDiv[] = [];
  const recentDiv = secs(d[10]);
  const upcomingDiv = secs(d[12]);
  if (recentDiv != null) dividends.push({ t: recentDiv, amount: num(d[11]) });
  if (upcomingDiv != null && (recentDiv == null || Math.abs(upcomingDiv - recentDiv) > 86400)) {
    dividends.push({ t: upcomingDiv, amount: num(d[13]), upcoming: true });
  }

  earnings.sort((a, b) => a.t - b.t);
  dividends.sort((a, b) => a.t - b.t);
  if (!earnings.length && !dividends.length) return null;
  return { symbol, events: { earnings, dividends } };
}

async function scanPage(start: number): Promise<{ total: number; rows: ScanRow[] }> {
  const body = {
    filter: [
      { left: 'exchange', operation: 'equal', right: 'NSE' },
      { left: 'type', operation: 'equal', right: 'stock' },
    ],
    options: { lang: 'en' },
    symbols: { query: { types: [] }, tickers: [] },
    sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
    range: [start, start + PAGE],
    columns: [...COLUMNS],
    markets: ['india'],
  };
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch('https://scanner.tradingview.com/india/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': UA,
          Origin: 'https://in.tradingview.com',
          Referer: 'https://in.tradingview.com/',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      });
      if (res.status === 429 || res.status >= 500) {
        console.log(`chart-events: http ${res.status} at ${start} (attempt ${attempt})`);
        await new Promise((r) => setTimeout(r, 2500 * attempt));
        continue;
      }
      if (!res.ok) {
        console.log(`chart-events: http ${res.status} at ${start}`);
        return { total: 0, rows: [] };
      }
      const json = (await res.json()) as { totalCount?: number; data?: ScanRow[] };
      return { total: json.totalCount ?? 0, rows: json.data ?? [] };
    } catch (err) {
      console.log(`chart-events: page ${start} failed (attempt ${attempt}): ${err instanceof Error ? err.message : err}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return { total: 0, rows: [] };
}

function previousCount(): number {
  if (!existsSync(OUT)) return 0;
  try {
    const prev = JSON.parse(readFileSync(OUT, 'utf8')) as { count?: number };
    return prev.count ?? 0;
  } catch {
    return 0;
  }
}

async function main(): Promise<void> {
  const symbols: Record<string, SymbolEvents> = {};
  let total = Infinity;
  let start = 0;
  while (start < total && start < MAX_SYMBOLS) {
    const page = await scanPage(start);
    if (page.total > 0) total = page.total;
    if (!page.rows.length) break;
    for (const row of page.rows) {
      const parsed = toEvents(row);
      if (parsed) symbols[parsed.symbol] = parsed.events;
    }
    console.log(`chart-events: ${start + page.rows.length}/${total || '?'} scanned, ${Object.keys(symbols).length} with events`);
    start += page.rows.length;
    if (page.rows.length < PAGE) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  const count = Object.keys(symbols).length;
  if (count < MIN_SYMBOLS) {
    const prev = previousCount();
    if (prev >= MIN_SYMBOLS) {
      console.log(`chart-events: only ${count} symbols; keeping previous file (${prev})`);
      return;
    }
    console.error(`chart-events: only ${count} symbols and no previous file`);
    process.exitCode = 1;
    return;
  }

  const payload = {
    asOf: new Date().toISOString(),
    source: 'in.tradingview.com',
    market: 'india',
    count,
    symbols,
  };
  writeFileSync(OUT, JSON.stringify(payload));
  const sample = symbols.AEGISLOG;
  const last = sample?.earnings.filter((e) => !e.upcoming).slice(-1)[0];
  console.log(
    `chart-events: wrote ${count} symbols` +
      (last ? `; AEGISLOG ${last.period} eps ${last.eps} revenue ${last.revenue}` : ''),
  );
}

main();
