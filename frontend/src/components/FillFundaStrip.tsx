import { useEffect, useState } from 'react';
import { fmt } from '../format';

interface FillFunda {
  name: string | null;
  sector: string | null;
  price: number | null;
  marketCapCr: number | null;
  pe: number | null;
  pb: number | null;
  roe: number | null;
  roce: number | null;
  debtToEquity: number | null;
  divYield: number | null;
  bookValue: number | null;
  faceValue: number | null;
  weekHigh52: number | null;
  weekLow52: number | null;
  source: string;
  asOf: string;
}

const FILLS_URLS = [
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@automation-data/frontend/public/fills.json',
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/fills.json',
  '/fills.json',
];

let fillsCache: Record<string, FillFunda> | null = null;
let fillsInflight: Promise<Record<string, FillFunda> | null> | null = null;

async function loadFills(): Promise<Record<string, FillFunda> | null> {
  if (fillsCache) return fillsCache;
  if (!fillsInflight) {
    fillsInflight = (async () => {
      for (const url of FILLS_URLS) {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) continue;
          const ct = res.headers.get('content-type') ?? '';
          if (ct.includes('text/html')) continue;
          const data = (await res.json()) as { fundamentals?: Record<string, FillFunda> };
          if (data?.fundamentals) {
            fillsCache = data.fundamentals;
            return fillsCache;
          }
        } catch {
          // try next mirror
        }
      }
      return null;
    })().finally(() => {
      fillsInflight = null;
    });
  }
  return fillsInflight;
}

/** Fallback ratio strip shown when a stock has no full fundamental model yet
 *  but the weekly coverage automation filled its core ratios. */
export default function FillFundaStrip({ symbol }: { symbol: string }) {
  const [fill, setFill] = useState<FillFunda | null>(null);

  useEffect(() => {
    let live = true;
    loadFills().then((all) => {
      if (live && all?.[symbol]) setFill(all[symbol]);
    });
    return () => { live = false; };
  }, [symbol]);

  if (!fill) return null;
  const cells: [string, string][] = [
    ['Price', fill.price != null ? `₹${fmt(fill.price)}` : '—'],
    ['Market cap', fill.marketCapCr != null ? `₹${fmt(fill.marketCapCr, 0)} Cr` : '—'],
    ['P/E', fill.pe != null ? fill.pe.toFixed(1) : '—'],
    ['P/B', fill.pb != null ? fill.pb.toFixed(2) : '—'],
    ['ROE %', fill.roe != null ? fill.roe.toFixed(1) : '—'],
    ['ROCE %', fill.roce != null ? fill.roce.toFixed(1) : '—'],
    ['Debt/Equity', fill.debtToEquity != null ? fill.debtToEquity.toFixed(2) : '—'],
    ['Div yield %', fill.divYield != null ? fill.divYield.toFixed(2) : '—'],
    ['Book value', fill.bookValue != null ? `₹${fmt(fill.bookValue)}` : '—'],
    ['52w range', fill.weekLow52 != null ? `₹${fmt(fill.weekLow52, 0)}–${fmt(fill.weekHigh52 ?? fill.weekLow52, 0)}` : '—'],
  ];

  return (
    <div style={{ margin: '0 16px 12px', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(76,201,240,0.25)', background: 'rgba(76,201,240,0.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
        <b style={{ fontSize: 13 }}>Starter ratios {fill.name ? `· ${fill.name}` : ''} {fill.sector ? <span className="muted">· {fill.sector}</span> : null}</b>
        <span className="hint">via {fill.source} · {new Date(fill.asOf).toLocaleDateString('en-IN')} · full model arrives with Import</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '6px 14px', fontSize: 12.5 }}>
        {cells.map(([k, v]) => (
          <div key={k}><span className="muted">{k}:</span> <b className="mono">{v}</b></div>
        ))}
      </div>
    </div>
  );
}
