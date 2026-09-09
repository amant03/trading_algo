import type { RatioUnit, SectorRatioCard, StockAnalysis } from '../types';
import { fmtCompact } from '../format';

interface Tile {
  k: string;
  v: string;
  sub?: string;
}

const cr2 = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2));
const cr1 = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(1));

function fmtUnit(v: number | null | undefined, unit: RatioUnit): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (unit === 'pct') return `${cr1(v)}%`;
  if (unit === 'days') return `${Math.round(v)} d`;
  if (unit === 'x') return cr2(v);
  if (unit === 'rs') return cr2(v);
  if (unit === 'cr') return `${v.toLocaleString('en-IN')} Cr`;
  return cr2(v);
}

function n(a: number | null | undefined, b?: number | null): number | null {
  if (a != null && Number.isFinite(a)) return a;
  if (b != null && Number.isFinite(b)) return b;
  return null;
}

function periods(c: SectorRatioCard): string | undefined {
  const bits: string[] = [];
  if (c.y1 != null) bits.push(`1Y ${fmtUnit(c.y1, c.unit)}`);
  if (c.y3 != null) bits.push(`3Y ${fmtUnit(c.y3, c.unit)}`);
  if (c.y5 != null) bits.push(`5Y ${fmtUnit(c.y5, c.unit)}`);
  return bits.length > 1 ? bits.join(' · ') : undefined;
}

function skipSectorLabel(label: string): boolean {
  const k = label.toLowerCase().replace(/%/g, '').trim();
  return k === 'peg' || k === 'peg ratio' || k === 'p/e' || k === 'p/b' || k === 'p/s';
}

function fallbackTiles(analysis: StockAnalysis): Tile[] {
  const m = analysis.metrics;
  const d = analysis.financials?.views[analysis.financials.defaultView]?.derived;
  return [
    { k: 'ROE', v: `${cr1(n(m.roe, d?.roe))}%` },
    { k: 'ROCE', v: `${cr1(n(m.roce, d?.roce))}%` },
    { k: 'ROA', v: `${cr1(n(m.roa, d?.roa))}%` },
    { k: 'Growth', v: `${cr1(n(m.growth, d?.earningsGrowth))}%` },
    { k: 'Rev Gth', v: `${cr1(n(m.revenueGrowth, d?.revenueGrowth))}%` },
    { k: 'Net Mar', v: `${cr1(n(m.netMargin, d?.netMargin))}%` },
    { k: 'Op Mar', v: `${cr1(n(m.operatingMargin, d?.operatingMargin))}%` },
    { k: 'Gross Mar', v: `${cr1(m.grossMargin)}%` },
    { k: 'D/E', v: cr2(n(m.debtToEquity, d?.debtToEquity)) },
    { k: 'Cur Ratio', v: cr2(n(m.currentRatio, d?.currentRatio)) },
    { k: 'Qk Ratio', v: cr2(n(m.quickRatio, d?.quickRatio)) },
    { k: 'EPS', v: cr2(n(m.eps, d?.eps)) },
    { k: 'BV/Sh', v: cr2(m.bookValue) },
    { k: 'Beta', v: cr2(m.beta) },
  ];
}

export default function KeyRatios({ analysis }: { analysis: StockAnalysis }) {
  const m = analysis.metrics;
  const d = analysis.financials?.views[analysis.financials.defaultView]?.derived;
  const fino = analysis.financials?.finology;
  const kind = analysis.financials?.sectorKind ?? 'generic';

  const peg = n(m.peg, d?.peg ?? fino?.peg ?? null);
  const core: Tile[] = [
    { k: 'P/E', v: cr1(m.pe) },
    { k: 'P/B', v: cr1(m.pb) },
    { k: 'P/S', v: cr2(m.ps) },
    { k: 'PEG', v: cr2(peg) },
    { k: 'Div Yld', v: `${cr2(m.dividendYield)}%` },
    { k: 'Mkt Cap', v: analysis.marketCap ? fmtCompact(analysis.marketCap) : '—' },
  ];

  const sector: Tile[] = (fino?.ratios?.length
    ? fino.ratios.filter((r) => !skipSectorLabel(r.label)).map((r) => ({
        k: r.label.replace(/\s+/g, ' ').trim(),
        v: fmtUnit(r.value, r.unit),
        sub: periods(r),
      }))
    : fallbackTiles(analysis));

  const extras: Tile[] = [];
  if (kind === 'bank' || kind === 'nbfc') {
    const b = analysis.financials?.bank ?? fino?.bank;
    if (b?.grossNpa != null && !sector.some((t) => /gross npa/i.test(t.k))) extras.push({ k: 'Gross NPA', v: `${cr2(b.grossNpa)}%` });
    if (b?.netNpa != null && !sector.some((t) => /net npa/i.test(t.k))) extras.push({ k: 'Net NPA', v: `${cr2(b.netNpa)}%` });
  }

  const tiles = [...core, ...extras, ...sector];

  return (
    <div className="ratio-grid" style={{ marginBottom: 14 }}>
      {tiles.map((t) => (
        <div className="ratio" key={t.k}>
          <div className="k">{t.k}</div>
          <div className="v">{t.v}</div>
          {t.sub && <div className="sub">{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}
