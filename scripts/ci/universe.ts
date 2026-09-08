// Builds frontend/public/universe.json from official NSE + BSE listings
// so search/navigation covers the full Indian cash-equity market.

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const NSE_CSV = 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv';
const BSE_API =
  'https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active';

type Stock = {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  series: string;
  isin: string;
  cap: 'large' | 'mid' | 'small';
  mktCap: number | null;
};

function capBand(cr: number | null): Stock['cap'] {
  if (cr != null && cr >= 20_000) return 'large';
  if (cr != null && cr >= 5_000) return 'mid';
  return 'small';
}

async function nseRows(): Promise<Stock[]> {
  const res = await fetch(NSE_CSV, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://www.nseindia.com/',
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`NSE CSV ${res.status}`);
  const text = await res.text();
  const out: Stock[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const parts = line.split(',');
    if (parts.length < 8) continue;
    const symbol = parts[0].trim().toUpperCase();
    const series = parts[parts.length - 6].trim().toUpperCase();
    const isin = parts[parts.length - 2].trim();
    const name = parts.slice(1, parts.length - 6).join(',').trim();
    if (!symbol || !/^(EQ|BE|BZ)$/.test(series)) continue;
    if (!/^[A-Z0-9][A-Z0-9&-]{0,19}$/.test(symbol)) continue;
    out.push({
      symbol,
      name,
      exchange: 'NSE',
      series,
      isin: /^INE/.test(isin) ? isin : '',
      cap: series === 'EQ' ? 'mid' : 'small',
      mktCap: null,
    });
  }
  return out;
}

interface BseRow {
  scrip_id?: string;
  Scrip_Name?: string;
  Issuer_Name?: string;
  GROUP?: string;
  ISIN_NUMBER?: string;
  Mktcap?: string;
  Status?: string;
}

async function bseRows(): Promise<Stock[]> {
  const res = await fetch(BSE_API, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://www.bseindia.com/',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`BSE ${res.status}`);
  const rows = (await res.json()) as BseRow[];
  const out: Stock[] = [];
  for (const r of rows) {
    const symbol = String(r.scrip_id ?? '').trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9][A-Z0-9&-]{0,19}$/.test(symbol)) continue;
    const mktCap = r.Mktcap != null && r.Mktcap !== '' ? Number(r.Mktcap) : null;
    const cr = mktCap != null && isFinite(mktCap) ? mktCap : null;
    out.push({
      symbol,
      name: String(r.Issuer_Name || r.Scrip_Name || symbol).trim(),
      exchange: 'BSE',
      series: String(r.GROUP || 'B'),
      isin: String(r.ISIN_NUMBER ?? ''),
      cap: capBand(cr),
      mktCap: cr,
    });
  }
  return out;
}

function merge(nse: Stock[], bse: Stock[]): Stock[] {
  const byIsin = new Map<string, Stock>();
  const bySym = new Map<string, Stock>();
  const take = (s: Stock, preferNse: boolean) => {
    const prev = s.isin ? byIsin.get(s.isin) : bySym.get(s.symbol);
    if (prev) {
      if (preferNse && s.exchange === 'NSE' && prev.exchange === 'BSE') {
        s.mktCap = s.mktCap ?? prev.mktCap;
        s.cap = prev.mktCap != null ? capBand(prev.mktCap) : s.cap;
        bySym.delete(prev.symbol);
        byIsin.set(s.isin || s.symbol, s);
        bySym.set(s.symbol, s);
      } else if (prev.exchange === 'NSE' && s.exchange === 'BSE') {
        prev.mktCap = prev.mktCap ?? s.mktCap;
        if (s.mktCap != null) prev.cap = capBand(s.mktCap);
      }
      return;
    }
    if (s.isin) byIsin.set(s.isin, s);
    bySym.set(s.symbol, s);
  };
  for (const s of nse) take(s, true);
  for (const s of bse) take(s, false);
  return [...new Map([...bySym.values()].map((s) => [s.symbol, s])).values()].sort((a, b) =>
    a.symbol.localeCompare(b.symbol),
  );
}

async function main(): Promise<void> {
  const [nse, bse] = await Promise.all([nseRows(), bseRows()]);
  const stocks = merge(nse, bse);
  const liquid = [...stocks]
    .filter((s) => s.mktCap != null)
    .sort((a, b) => (b.mktCap ?? 0) - (a.mktCap ?? 0))
    .slice(0, 120)
    .map((s) => s.symbol);
  const counts = { large: 0, mid: 0, small: 0, nse: 0, bse: 0 };
  for (const s of stocks) {
    counts[s.cap] += 1;
    if (s.exchange === 'NSE') counts.nse += 1;
    else counts.bse += 1;
  }
  const out = {
    generatedAt: new Date().toISOString(),
    count: stocks.length,
    counts,
    liquid,
    stocks,
  };
  const dir = join(process.cwd(), 'frontend', 'public');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'universe.json'), JSON.stringify(out));
  console.log(`universe: ${stocks.length} stocks (NSE ${counts.nse} / BSE-only ${counts.bse}) liquid=${liquid.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
