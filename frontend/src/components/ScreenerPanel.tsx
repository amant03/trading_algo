import { useState } from 'react';
import type { ConsolidationView, ScreenerFundamentals, ScreenerYearMetrics } from '../types';

interface Props {
  symbol: string;
  financials: ScreenerFundamentals | null;
}

const cr2 = (v: number | null): string => (v == null || !Number.isFinite(v) ? '—' : Number.isFinite(v) ? v.toFixed(2) : String(v));
const cr1 = (v: number | null): string => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(1));
const pct = (v: number | null): string => `${cr2(v)}%`;

/** Indian-style compact: 16676 Cr stays as-is; 116973 Cr -> 1.17L Cr. */
function compactCr(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const n = Math.abs(value);
  if (n >= 100000) return `${(value / 100000).toFixed(2)}L Cr`;
  return `${value.toLocaleString('en-IN')} Cr`;
}

const KPI: { key: string; label: string }[] = [
  { key: 'marketCap', label: 'Market Cap' },
  { key: 'price', label: 'Current Price' },
  { key: 'high', label: '52-wk High' },
  { key: 'low', label: '52-wk Low' },
  { key: 'pe', label: 'Stock P/E' },
  { key: 'bookValue', label: 'Book Value' },
  { key: 'dividendYield', label: 'Div Yield' },
  { key: 'roce', label: 'ROCE' },
  { key: 'roe', label: 'ROE' },
  { key: 'faceValue', label: 'Face Value' },
];

const MATRIX: { key: Exclude<keyof ScreenerYearMetrics, 'year'>; label: string; fmt: (v: number | null) => string }[] = [
  { key: 'sales', label: 'Sales', fmt: compactCr },
  { key: 'netProfit', label: 'Net Profit', fmt: compactCr },
  { key: 'netMargin', label: 'Net Margin', fmt: pct },
  { key: 'operatingMargin', label: 'Op Margin', fmt: pct },
  { key: 'eps', label: 'EPS', fmt: cr2 },
  { key: 'roe', label: 'ROE', fmt: pct },
  { key: 'roce', label: 'ROCE', fmt: pct },
  { key: 'roa', label: 'ROA', fmt: pct },
  { key: 'netWorth', label: 'Net Worth', fmt: compactCr },
  { key: 'totalDebt', label: 'Total Debt', fmt: compactCr },
  { key: 'totalAssets', label: 'Total Assets', fmt: compactCr },
];

function Row({ label, right }: { label: string; right?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 12px', borderBottom: '1px solid var(--line)' }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{right ?? '—'}</span>
    </div>
  );
}

export default function ScreenerPanel({ symbol, financials }: Props) {
  const [view, setView] = useState<ConsolidationView>('consolidated');
  if (!financials) return null;
  const v = financials.views[view] ?? financials.views[financials.defaultView];
  if (!v) return null;
  const views = Object.keys(financials.views) as ConsolidationView[];
  const hasBoth = views.length > 1;

  const s = v.snapshot;
  const d = v.derived;
  const byYear = d?.byYear ?? [];
  const latestYear = d?.latestYear ?? null;
  const extra = v.ratios?.rows ?? [];

  const snapValues: Record<string, number | null> = {
    marketCap: s.marketCap,
    price: s.price,
    high: s.high,
    low: s.low,
    pe: s.pe,
    bookValue: s.bookValue,
    dividendYield: s.dividendYield,
    roce: s.roce,
    roe: s.roe,
    faceValue: s.faceValue,
  };

  return (
    <div className="panel">
      <div className="panel-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h3>Screener fundamentals — {financials.name ?? symbol}</h3>
          <div className="seg" role="tablist">
            {hasBoth ? (
              views.map((k) => (
                <button
                  key={k}
                  className={k === view ? 'active' : ''}
                  onClick={() => setView(k)}
                >
                  {k === 'consolidated' ? 'Consolidated' : 'Standalone'}
                </button>
              ))
            ) : (
              <span className="seg-note mono">{financials.defaultView} only</span>
            )}
          </div>
        </div>
        <span className="hint">Screener.in · {view}{hasBoth ? ' · default' : ''}</span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '12px 0 4px' }}>
        {KPI.map((k) => {
          const raw = snapValues[k.key];
          const val = k.key === 'dividendYield' ? (raw != null ? `${cr2(raw)}%` : null)
            : k.key === 'roce' || k.key === 'roe' || k.key === 'pe' || k.key === 'price' || k.key === 'bookValue' || k.key === 'high' || k.key === 'low' ? cr2(raw)
            : raw != null ? raw.toLocaleString('en-IN') : null;
          return (
            <span key={k.key} className="rel-chip" style={{ fontSize: 11 }}>
              <span style={{ color: 'var(--muted)' }}>{k.label}</span> <b>{val ?? '—'}</b>
            </span>
          );
        })}
      </div>

      {financials.bank && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="card-h" style={{ marginBottom: 6 }}>Bank credit quality</div>
          <div className="grid-d">
            <div className="stat"><div className="k">Gross NPA</div><div className="v">{financials.bank.grossNpa != null ? `${cr2(financials.bank.grossNpa)}%` : '—'}</div></div>
            <div className="stat"><div className="k">Net NPA</div><div className="v">{financials.bank.netNpa != null ? `${cr2(financials.bank.netNpa)}%` : '—'}</div></div>
            <div className="stat"><div className="k">ROA</div><div className="v">{cr1(financials.bank.roa)}%</div></div>
            <div className="stat"><div className="k">NPM</div><div className="v">{cr1(financials.bank.npm)}%</div></div>
          </div>
          <div className="hint" style={{ marginTop: 4 }}>NPA from the latest quarterly reporting · {financials.bank.source}</div>
        </div>
      )}

      {d && (
        <div style={{ marginTop: 10 }}>
          <div className="hint" style={{ marginBottom: 6 }}>
            {d.byYear.length ? `Annual performance (Rs Cr unless marked) · latest FY ${latestYear ?? ''}` : 'Annual performance unavailable'}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="s-table">
              <thead>
                <tr>
                  <th className="s-rowhead">Metric</th>
                  {byYear.map((y, i) => (
                    <th key={i} className={y.year === latestYear ? 's-cur' : ''}>{y.year}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATRIX.map((m) => (
                  <tr key={m.key}>
                    <td className="s-rowhead">{m.label}</td>
                    {byYear.map((y, i) => (
                      <td key={i} className={y.year === latestYear ? 's-cur' : ''}>{m.fmt(y[m.key] ?? null)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid-2" style={{ marginTop: 12, gap: 18 }}>
        <div>
          <div className="hint" style={{ marginBottom: 4 }}>Sector ratios — {financials.sector ?? view}</div>
          {extra.length ? (
            extra.map((r) => <Row key={r.label} label={r.label} right={r.values[r.values.length - 1] != null ? cr2(r.values[r.values.length - 1]) : '—'} />)
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>No sector-specific ratio rows published for this company.</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {d && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Row label={`Revenue growth (FY ${latestYear ?? ''})`} right={pct(d.revenueGrowth)} />
              <Row label={`Profit growth (FY ${latestYear ?? ''})`} right={pct(d.earningsGrowth)} />
              <Row label="D/E" right={cr2(d.debtToEquity)} />
              <Row label="Current ratio" right={cr2(d.currentRatio)} />
              <Row label="Interest coverage" right={cr2(d.interestCoverage)} />
            </div>
          )}
          <div className="hint" style={{ fontSize: 11, lineHeight: 1.6 }}>
            Ratios recomputed from Screener.in's reported P&amp;L, balance sheet &amp; ratios. Values marked “—” are not
            published or not derivable for this company's sector.
            <a href={`https://www.screener.in/company/${symbol}/`} target="_blank" rel="noopener noreferrer"> Open on Screener.in ↗</a>
          </div>
        </div>
      </div>
    </div>
  );
}