// FII/DII activity — daily institutional flows from official + credible
// compiled sources (no keys needed):
//   * NSDL (official FPI monitor): daily equity buy/sell/net, ₹ cr + $m
//     https://www.fpi.nsdl.co.in/web/Reports/Latest.aspx
//   * Moneycontrol (compiled from NSE): FII/DII cash-market net + FII
//     index/stock futures & options, embedded in page __NEXT_DATA__
// NSE's own API/CSV endpoints are bot-blocked (verified 2026-09); the two
// sources above are the working, attributable pair.
//
// Writes: frontend/public/fii-dii.json (last 30 sessions, carried forward)
//   { generatedAt, sources, days: [{ date, fDate, fiiCash, diiCash,
//     fiiIdxFut, fiiIdxOpt, fiiStkFut, fiiStkOpt, fpiEquityBuy,
//     fpiEquitySell, fpiEquityNet, fpiEquityNetUsd }] }  (₹ cr unless noted)
//
// Run: npx tsx scripts/ci/fii-dii.ts

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PUB = join(process.cwd(), 'frontend', 'public');
const OUT = join(PUB, 'fii-dii.json');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

interface FlowDay {
  date: string; // YYYY-MM-DD
  fDate: string;
  fiiCash: number | null;
  diiCash: number | null;
  fiiIdxFut: number | null;
  fiiIdxOpt: number | null;
  fiiStkFut: number | null;
  fiiStkOpt: number | null;
  fpiEquityBuy: number | null;
  fpiEquitySell: number | null;
  fpiEquityNet: number | null;
  fpiEquityNetUsd: number | null;
}

const mcNum = (v: unknown): number | null => {
  if (typeof v !== 'number') {
    if (typeof v !== 'string') return null;
    const n = Number(v.replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }
  return isFinite(v) ? v : null;
};

const nsdlNum = (s: string): number | null => {
  const t = s.trim();
  const neg = /^\(.*\)$/.test(t);
  const n = Number(t.replace(/[(),]/g, ''));
  return isFinite(n) ? (neg ? -n : n) : null;
};

const isoOf = (d: string): string => {
  // "25-Sep-2026" -> "2026-09-25"
  const m = d.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return d;
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  return `${m[3]}-${months[m[2].toLowerCase()] ?? '01'}-${m[1]}`;
};

async function fetchNsdl(): Promise<{ date: string; buy: number | null; sell: number | null; net: number | null; netUsd: number | null }[]> {
  const out: { date: string; buy: number | null; sell: number | null; net: number | null; netUsd: number | null }[] = [];
  try {
    const res = await fetch('https://www.fpi.nsdl.co.in/web/Reports/Latest.aspx', {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return out;
    const t = await res.text();
    const cells = [...t.matchAll(/<td[^>]*>([^<>]{1,60})<\/td>/g)].map((m) => m[1].trim()).filter(Boolean);
    for (let i = 0; i < cells.length; i++) {
      if (!/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(cells[i])) continue;
      const date = isoOf(cells[i]);
      // Find "Equity" + "Stock Exchange" within the next few cells.
      for (let j = i + 1; j < Math.min(i + 6, cells.length); j++) {
        if (cells[j] === 'Equity' && cells[j + 1] === 'Stock Exchange') {
          out.push({
            date,
            buy: nsdlNum(cells[j + 2] ?? ''),
            sell: nsdlNum(cells[j + 3] ?? ''),
            net: nsdlNum(cells[j + 4] ?? ''),
            netUsd: nsdlNum(cells[j + 5] ?? ''),
          });
          break;
        }
      }
    }
  } catch {
    // NSDL unreachable — Moneycontrol leg still covers FII/DII cash
  }
  return out;
}

interface McRow {
  date?: string;
  fDate?: string;
  fiiCM?: string | number;
  diiCM?: string | number;
  fiiIdxFut?: string | number;
  fiiIdxOpt?: string | number;
  fiiStkFut?: string | number;
  fiiStkOpt?: string | number;
}

async function fetchMoneycontrol(): Promise<McRow[]> {
  try {
    const res = await fetch('https://www.moneycontrol.com/stocks/marketstats/fii_dii_activity/index.php', {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return [];
    const t = await res.text();
    const m = t.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
    if (!m) return [];
    const j = JSON.parse(m[1]) as Record<string, unknown>;
    const stack: unknown[] = [j?.props];
    while (stack.length) {
      const cur = stack.pop() as Record<string, unknown> | null;
      if (!cur || typeof cur !== 'object') continue;
      for (const [k, v] of Object.entries(cur)) {
        if ((k === 'fiiDiiData' || k === 'fiiDiiChartData') && Array.isArray(v)) return v as McRow[];
        if (v && typeof v === 'object') stack.push(v);
      }
    }
  } catch {
    // Moneycontrol unreachable — NSDL leg still covers FPI equity
  }
  return [];
}

async function main(): Promise<void> {
  const [nsdl, mc] = await Promise.all([fetchNsdl(), fetchMoneycontrol()]);
  console.log(`fii-dii: NSDL ${nsdl.length} days · Moneycontrol ${mc.length} rows`);

  const byDate = new Map<string, FlowDay>();
  // Carry previous sessions forward (both feeds are short-window).
  try {
    if (existsSync(OUT)) {
      const prev = JSON.parse(readFileSync(OUT, 'utf8')) as { days?: FlowDay[] };
      for (const d of prev.days ?? []) {
        if (d?.date) byDate.set(d.date, d);
      }
    }
  } catch {
    // start fresh
  }
  for (const r of mc) {
    if (!r.date) continue;
    const cur = byDate.get(r.date) ?? {
      date: r.date, fDate: r.fDate ?? r.date,
      fiiCash: null, diiCash: null, fiiIdxFut: null, fiiIdxOpt: null,
      fiiStkFut: null, fiiStkOpt: null,
      fpiEquityBuy: null, fpiEquitySell: null, fpiEquityNet: null, fpiEquityNetUsd: null,
    };
    cur.fDate = r.fDate ?? cur.fDate;
    cur.fiiCash = mcNum(r.fiiCM) ?? cur.fiiCash;
    cur.diiCash = mcNum(r.diiCM) ?? cur.diiCash;
    cur.fiiIdxFut = mcNum(r.fiiIdxFut) ?? cur.fiiIdxFut;
    cur.fiiIdxOpt = mcNum(r.fiiIdxOpt) ?? cur.fiiIdxOpt;
    cur.fiiStkFut = mcNum(r.fiiStkFut) ?? cur.fiiStkFut;
    cur.fiiStkOpt = mcNum(r.fiiStkOpt) ?? cur.fiiStkOpt;
    byDate.set(r.date, cur);
  }
  for (const r of nsdl) {
    const cur = byDate.get(r.date) ?? {
      date: r.date, fDate: r.date,
      fiiCash: null, diiCash: null, fiiIdxFut: null, fiiIdxOpt: null,
      fiiStkFut: null, fiiStkOpt: null,
      fpiEquityBuy: null, fpiEquitySell: null, fpiEquityNet: null, fpiEquityNetUsd: null,
    };
    cur.fpiEquityBuy = r.buy ?? cur.fpiEquityBuy;
    cur.fpiEquitySell = r.sell ?? cur.fpiEquitySell;
    cur.fpiEquityNet = r.net ?? cur.fpiEquityNet;
    cur.fpiEquityNetUsd = r.netUsd ?? cur.fpiEquityNetUsd;
    byDate.set(r.date, cur);
  }

  const days = [...byDate.values()]
    .filter((d) => d.fiiCash != null || d.diiCash != null || d.fpiEquityNet != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-30);

  mkdirSync(PUB, { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      sources: { nsdl: 'NSDL FPI Monitor (official)', moneycontrol: 'Moneycontrol FII/DII activity (compiled from NSE)' },
      currency: 'INR cr',
      days,
    }),
  );
  const latest = days[days.length - 1];
  console.log(
    `fii-dii: ${days.length} sessions -> ${OUT}` +
      (latest ? ` · latest ${latest.date}: FII ${latest.fiiCash ?? '—'} / DII ${latest.diiCash ?? '—'} / FPIeq ${latest.fpiEquityNet ?? '—'}` : ''),
  );
}

main().catch((e) => {
  console.error('fii-dii failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
