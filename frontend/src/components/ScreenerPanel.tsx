import { useState } from 'react';
import type { ConsolidationView, RatioUnit, ScreenerFundamentals, ScreenerRow, ScreenerYearMetrics } from '../types';

interface Props {
  symbol: string;
  financials: ScreenerFundamentals | null;
}

const cr2 = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2));
const cr1 = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(1));
const cr0 = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? '—' : String(Math.round(v)));

function fmtUnit(v: number | null | undefined, unit: RatioUnit | 'pct' | 'x' | 'days' | 'cr'): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (unit === 'pct') return `${cr1(v)}%`;
  if (unit === 'days') return `${cr0(v)} d`;
  if (unit === 'x') return cr2(v);
  if (unit === 'cr') return compactCr(v);
  if (unit === 'rs') return cr2(v);
  return cr2(v);
}

/** Indian-style compact: 16676 Cr stays as-is; 116973 Cr -> 1.17L Cr. */
function compactCr(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const n = Math.abs(value);
  if (n >= 100000) return `${(value / 100000).toFixed(2)}L Cr`;
  return `${value.toLocaleString('en-IN')} Cr`;
}

const KPI: { key: string; label: string; unit?: 'pct' | 'rs' | 'cr' }[] = [
  { key: 'marketCap', label: 'Market Cap', unit: 'cr' },
  { key: 'price', label: 'Current Price', unit: 'rs' },
  { key: 'high', label: '52-wk High', unit: 'rs' },
  { key: 'low', label: '52-wk Low', unit: 'rs' },
  { key: 'pe', label: 'Stock P/E' },
  { key: 'bookValue', label: 'Book Value', unit: 'rs' },
  { key: 'dividendYield', label: 'Div Yield', unit: 'pct' },
  { key: 'roce', label: 'ROCE', unit: 'pct' },
  { key: 'roe', label: 'ROE', unit: 'pct' },
  { key: 'faceValue', label: 'Face Value', unit: 'rs' },
];

const MATRIX: { key: Exclude<keyof ScreenerYearMetrics, 'year'>; label: string; fmt: (v: number | null) => string }[] = [
  { key: 'sales', label: 'Sales', fmt: compactCr },
  { key: 'netProfit', label: 'Net Profit', fmt: compactCr },
  { key: 'netMargin', label: 'Net Margin', fmt: (v) => fmtUnit(v, 'pct') },
  { key: 'operatingMargin', label: 'Op Margin', fmt: (v) => fmtUnit(v, 'pct') },
  { key: 'eps', label: 'EPS', fmt: cr2 },
  { key: 'roe', label: 'ROE', fmt: (v) => fmtUnit(v, 'pct') },
  { key: 'roce', label: 'ROCE', fmt: (v) => fmtUnit(v, 'pct') },
  { key: 'roa', label: 'ROA', fmt: (v) => fmtUnit(v, 'pct') },
  { key: 'netWorth', label: 'Net Worth', fmt: compactCr },
  { key: 'totalDebt', label: 'Total Debt', fmt: compactCr },
  { key: 'totalAssets', label: 'Total Assets', fmt: compactCr },
];

const BANK_KEYS = /npa|casa|credit|deposit|car |capital adequacy|provision|nim|yield on|cost of/;
const REALTY_KEYS = /debtor|inventory|working capital|payable|conversion/;

function sectorRows(kind: string | undefined, rows: ScreenerRow[]): ScreenerRow[] {
  if (kind === 'bank' || kind === 'nbfc') {
    const hit = rows.filter((r) => BANK_KEYS.test(r.label.toLowerCase()) || BANK_KEYS.test(r.key));
    return hit.length ? hit : rows;
  }
  if (kind === 'realty') {
    const hit = rows.filter((r) => REALTY_KEYS.test(r.label.toLowerCase()) || REALTY_KEYS.test(r.key));
    return hit.length ? hit : rows;
  }
  return rows;
}

function Row({ label, right }: { label: string; right?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 12px', borderBottom: '1px solid var(--line)' }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{right ?? '—'}</span>
    </div>
  );
}

export default function ScreenerPanel({ symbol, financials }: Props) {
  const [view, setView] = useState<ConsolidationView>(financials?.defaultView ?? 'consolidated');
  if (!financials) return null;
  const v = financials.views[view] ?? financials.views[financials.defaultView];
  if (!v) return null;
  const views = Object.keys(financials.views) as ConsolidationView[];
  const hasBoth = views.length > 1;

  const s = v.snapshot;
  const d = v.derived;
  const byYear = d?.byYear ?? [];
  const latestYear = d?.latestYear ?? null;
  const extra = sectorRows(financials.sectorKind, v.ratios?.rows ?? []);
  const kind = financials.sectorKind ?? 'generic';

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
          <div className="seg" role="tablist" aria-label="Consolidated or standalone">
            {hasBoth ? (
              (['consolidated', 'standalone'] as ConsolidationView[]).filter((k) => financials.views[k]).map((k) => (
                <button
                  key={k}
                  type="button"
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
        <span className="hint">Screener.in · {view}{view === financials.defaultView ? ' · default' : ''}</span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '12px 0 4px' }}>
        {KPI.map((k) => {
          const raw = snapValues[k.key];
          const val = k.unit === 'pct' ? fmtUnit(raw, 'pct')
            : k.unit === 'cr' ? (raw != null ? raw.toLocaleString('en-IN') + ' Cr' : '—')
            : k.unit === 'rs' ? cr2(raw)
            : cr2(raw);
          return (
            <span key={k.key} className="rel-chip" style={{ fontSize: 11 }}>
              <span style={{ color: 'var(--muted)' }}>{k.label}</span> <b>{val}</b>
            </span>
          );
        })}
        <span className="rel-chip" style={{ fontSize: 11 }}>
          <span style={{ color: 'var(--muted)' }}>PEG</span> <b>{cr2(d?.peg ?? financials.finology?.peg)}</b>
        </span>
      </div>

      {financials.finology?.ratios?.length ? (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="card-h" style={{ marginBottom: 6 }}>
            Key ratios — {kind === 'generic' ? (financials.sector ?? 'company') : kind}
          </div>
          <div className="ratio-grid">
            {financials.finology.ratios.map((r) => (
              <div className="ratio" key={r.key}>
                <div className="k">{r.label}</div>
                <div className="v">{fmtUnit(r.value, r.unit)}</div>
                {(r.y3 != null || r.y5 != null) && (
                  <div className="sub">
                    {r.y1 != null ? `1Y ${fmtUnit(r.y1, r.unit)}` : ''}
                    {r.y3 != null ? ` · 3Y ${fmtUnit(r.y3, r.unit)}` : ''}
                    {r.y5 != null ? ` · 5Y ${fmtUnit(r.y5, r.unit)}` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            Sector tiles match ticker.finology.in ·{' '}
            <a href={`https://ticker.finology.in/company/${symbol}`} target="_blank" rel="noopener noreferrer">Open Finology ↗</a>
          </div>
        </div>
      ) : null}

      {(kind === 'bank' || kind === 'nbfc') && financials.bank && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="card-h" style={{ marginBottom: 6 }}>Bank credit quality</div>
          <div className="grid-d">
            <div className="stat"><div className="k">Gross NPA</div><div className="v">{fmtUnit(financials.bank.grossNpa, 'pct')}</div></div>
            <div className="stat"><div className="k">Net NPA</div><div className="v">{fmtUnit(financials.bank.netNpa, 'pct')}</div></div>
            <div className="stat"><div className="k">ROA</div><div className="v">{fmtUnit(financials.bank.roa, 'pct')}</div></div>
            <div className="stat"><div className="k">NPM</div><div className="v">{fmtUnit(financials.bank.npm, 'pct')}</div></div>
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
                    <th key={i} className={y.year === latestYear ? 's-cur' : ''}>{y.year.slice(0, 4)}</th>
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
          <div className="hint" style={{ marginBottom: 4 }}>
            {kind === 'bank' || kind === 'nbfc' ? 'Bank / NBFC ratios' : kind === 'realty' ? 'Realty cycle ratios' : `Sector ratios — ${financials.sector ?? view}`}
          </div>
          {extra.length ? (
            extra.map((r) => (
              <Row
                key={r.key}
                label={r.label}
                right={fmtUnit(r.values[r.values.length - 1], r.unit)}
              />
            ))
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>No sector-specific ratio rows published for this company.</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {d && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Row label={`Revenue growth (FY ${latestYear ?? ''})`} right={fmtUnit(d.revenueGrowth, 'pct')} />
              <Row label={`Profit growth (FY ${latestYear ?? ''})`} right={fmtUnit(d.earningsGrowth, 'pct')} />
              <Row label="D/E" right={cr2(d.debtToEquity)} />
              <Row label="Current ratio" right={cr2(d.currentRatio)} />
              {d.quickRatio != null && <Row label="Quick ratio" right={cr2(d.quickRatio)} />}
              <Row label="Interest coverage" right={cr2(d.interestCoverage)} />
              {kind === 'realty' && (
                <>
                  <Row label="Debtor days" right={fmtUnit(d.debtorDays, 'days')} />
                  <Row label="Inventory days" right={fmtUnit(d.inventoryDays, 'days')} />
                  <Row label="Working capital days" right={fmtUnit(d.workingCapitalDays, 'days')} />
                </>
              )}
            </div>
          )}
          <div className="hint" style={{ fontSize: 11, lineHeight: 1.6 }}>
            Ratios from Screener.in's reported P&amp;L, balance sheet &amp; ratios. Values marked “—” are not
            published or not derivable for this company's sector.
            <a href={`https://www.screener.in/company/${symbol}/${view === 'consolidated' ? 'consolidated/' : ''}`} target="_blank" rel="noopener noreferrer"> Open on Screener.in ↗</a>
          </div>
        </div>
      </div>
    </div>
  );
}
