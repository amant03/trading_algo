import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLive } from '../ws';
import { fmt, fmtPct, cls } from '../format';
import TripleScreener from './TripleScreener';
import {
  COMBINED_HALF,
  FUNDA_WEIGHTS,
  TECH_COLUMNS,
  combineScores,
  fundaBuy,
  fundamentalPoints,
  parseScanRows,
  techBuy,
  type FundaPoint,
  type TechPoint,
  type TechRow,
} from '../lib/lenses';
import type { StockAnalysis } from '../types';

type Lens = 'technical' | 'fundamental' | 'combined';

interface TechFile {
  asOf?: string;
  source?: string;
  rows?: TechRow[];
  error?: string;
}

const PAGE = 40;

function toneOf(rating: string | null | undefined): 'up' | 'down' | 'amber' {
  if (rating === 'Strong Buy' || rating === 'Buy') return 'up';
  if (rating === 'Strong Sell' || rating === 'Sell') return 'down';
  return 'amber';
}

function Sig({ signal }: { signal: TechPoint['signal'] }) {
  if (!signal) return <span className="dim">—</span>;
  const kind = signal === 'Buy' ? 'buy' : signal === 'Sell' ? 'sell' : 'neutral';
  return <span className={cls('sig', kind)}>{signal}</span>;
}

function ScoreChart({
  title,
  hint,
  rows,
  active,
  onPick,
}: {
  title: string;
  hint: string;
  rows: { symbol: string; score: number; rating: string | null }[];
  active: string | null;
  onPick: (symbol: string) => void;
}) {
  return (
    <div className="panel lens-chart">
      <div className="panel-title">
        <h3>{title}</h3>
        <span className="hint">{hint}</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty">No scores yet.</div>
      ) : (
        <div className="lens-bars">
          {rows.map((r) => (
            <button
              key={r.symbol}
              type="button"
              className={cls('lens-pick', active === r.symbol && 'on')}
              onClick={() => onPick(r.symbol)}
            >
              <span className="lens-sym">{r.symbol}</span>
              <span className="lens-track">
                <span className={toneOf(r.rating)} style={{ width: `${Math.max(4, Math.min(100, r.score))}%` }} />
              </span>
              <span className={cls('lens-n', toneOf(r.rating))}>{r.score}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PointTable({ title, weight, rows }: { title: string; weight: string; rows: { label: string; value: string; signal: FundaPoint['signal']; extra?: string }[] }) {
  return (
    <div>
      <div className="lens-sub">
        <span>{title}</span>
        <span>{weight}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Point</th>
              <th>Value</th>
              <th>Signal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>
                  {r.label}
                  {r.extra ? <div className="name-cell">{r.extra}</div> : null}
                </td>
                <td className="mono">{r.value}</td>
                <td><Sig signal={r.signal} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function loadTech(limit: number): Promise<TechFile> {
  try {
    const res = await fetch(`/api/techscreen?limit=${limit}`, { cache: 'no-store' });
    const ct = res.headers.get('content-type') ?? '';
    if (res.ok && !ct.includes('text/html')) {
      const data = (await res.json()) as TechFile;
      if (data.rows?.length) return data;
      if (data.error) throw new Error(data.error);
    }
    throw new Error('relay empty');
  } catch {
    const res = await fetch('https://scanner.tradingview.com/india/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filter: [{ left: 'exchange', operation: 'equal', right: 'NSE' }],
        options: { lang: 'en' },
        symbols: { query: { types: [] }, tickers: [] },
        sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
        range: [0, limit],
        columns: [...TECH_COLUMNS],
        markets: ['india'],
      }),
    });
    if (!res.ok) throw new Error(`tradingview scan failed: ${res.status}`);
    const body = (await res.json()) as { data?: { s: string; d: unknown[] }[] };
    const rows = parseScanRows(body.data ?? []);
    return { asOf: new Date().toISOString(), source: 'tradingview', rows };
  }
}

export default function LensBoard() {
  const navigate = useNavigate();
  const fundamentals = useLive((s) => s.fundamentals);
  const [techRows, setTechRows] = useState<TechRow[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const userPick = useRef(false);
  const [lens, setLens] = useState<Lens>('combined');
  const [onlyBoth, setOnlyBoth] = useState(false);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    loadTech(200)
      .then((data) => {
        if (cancel) return;
        setTechRows(data.rows ?? []);
        setAsOf(data.asOf ?? null);
        setSource(data.source === 'cache' ? 'cache · TradingView India' : 'live · TradingView India');
        setErr(null);
      })
      .catch((e: unknown) => {
        if (cancel) return;
        setErr(e instanceof Error ? e.message : 'Technical scan failed');
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const fundaBySym = useMemo(() => {
    const m = new Map<string, StockAnalysis>();
    for (const f of Object.values(fundamentals)) {
      if (f?.screens?.buffett && f.screens.lynch && f.screens.graham && f.verdict) m.set(f.symbol.toUpperCase(), f);
    }
    return m;
  }, [fundamentals]);

  const techBySym = useMemo(() => new Map(techRows.map((r) => [r.symbol, r])), [techRows]);

  const techChart = useMemo(
    () => techRows
      .filter((r) => r.techScore != null)
      .slice(0, 10)
      .map((r) => ({ symbol: r.symbol, score: r.techScore as number, rating: r.rating })),
    [techRows],
  );

  const fundaChart = useMemo(() => {
    return [...fundaBySym.values()]
      .filter((f) => isFinite(f.verdict.score))
      .sort((a, b) => b.verdict.score - a.verdict.score)
      .slice(0, 10)
      .map((f) => ({ symbol: f.symbol, score: f.verdict.score, rating: f.verdict.rating }));
  }, [fundaBySym]);

  const combinedRows = useMemo(() => {
    const rows: {
      symbol: string;
      name: string;
      tech: TechRow;
      funda: StockAnalysis;
      techScore: number;
      fundaScore: number;
      combined: number;
      both: boolean;
    }[] = [];
    for (const tech of techRows) {
      const funda = fundaBySym.get(tech.symbol);
      if (!funda || tech.techScore == null) continue;
      const combined = combineScores(tech.techScore, funda.verdict.score);
      if (combined == null) continue;
      const both = techBuy(tech.techScore) && fundaBuy(funda.verdict.score, funda.verdict.rating);
      rows.push({
        symbol: tech.symbol,
        name: funda.name ?? tech.name,
        tech,
        funda,
        techScore: tech.techScore,
        fundaScore: funda.verdict.score,
        combined,
        both,
      });
    }
    rows.sort((a, b) => b.combined - a.combined || b.techScore - a.techScore);
    return rows;
  }, [techRows, fundaBySym]);

  const combinedChart = useMemo(
    () => combinedRows.slice(0, 10).map((r) => ({
      symbol: r.symbol,
      score: r.combined,
      rating: r.combined >= 72 ? 'Strong Buy' : r.combined >= 58 ? 'Buy' : r.combined >= 44 ? 'Hold' : 'Sell',
    })),
    [combinedRows],
  );

  useEffect(() => {
    if (userPick.current) return;
    const first = combinedChart[0]?.symbol ?? techChart[0]?.symbol ?? fundaChart[0]?.symbol ?? null;
    if (first && first !== picked) setPicked(first);
  }, [picked, combinedChart, techChart, fundaChart]);

  const selectedTech = picked ? techBySym.get(picked) ?? null : null;
  const selectedFunda = picked ? fundaBySym.get(picked) ?? null : null;
  const selectedCombined = selectedTech?.techScore != null && selectedFunda
    ? combineScores(selectedTech.techScore, selectedFunda.verdict.score)
    : null;

  const needle = q.trim().toLowerCase();
  const techVisibleSrc = useMemo(() => {
    return techRows.filter((r) => {
      if (!needle) return true;
      return `${r.symbol} ${r.name} ${r.sector}`.toLowerCase().includes(needle);
    });
  }, [techRows, needle]);

  const combinedVisibleSrc = useMemo(() => {
    return combinedRows.filter((r) => {
      if (onlyBoth && !r.both) return false;
      if (!needle) return true;
      return `${r.symbol} ${r.name} ${r.funda.sector ?? ''}`.toLowerCase().includes(needle);
    });
  }, [combinedRows, onlyBoth, needle]);

  useEffect(() => {
    setLimit(PAGE);
  }, [lens, onlyBoth, needle]);

  const pick = (symbol: string, next?: Lens) => {
    userPick.current = true;
    setPicked(symbol);
    if (next) setLens(next);
  };

  const oscPoints = selectedTech?.points.filter((p) => p.group === 'oscillator') ?? [];
  const maPoints = selectedTech?.points.filter((p) => p.group === 'ma') ?? [];
  const fundaPoints = selectedFunda ? fundamentalPoints(selectedFunda) : [];

  return (
    <section className="lens-board">
      <div className="panel-title" style={{ marginBottom: 8 }}>
        <div>
          <h3 style={{ textTransform: 'none', letterSpacing: 0, fontSize: 16 }}>Three lenses</h3>
          <div className="hint" style={{ marginTop: 4, textTransform: 'none', letterSpacing: 0, lineHeight: 1.5 }}>
            Technical is the daily TradingView rating (in.tradingview.com): 11 oscillators, equal weight, and 15 moving averages, equal weight, then those two groups at 50/50.
            Fundamental is Buffett {Math.round(FUNDA_WEIGHTS.buffett * 100)}% · Lynch {Math.round(FUNDA_WEIGHTS.lynch * 100)}% · Graham {Math.round(FUNDA_WEIGHTS.graham * 100)}%.
            Techno + fundamental is {Math.round(COMBINED_HALF * 100)}% technical and {Math.round(COMBINED_HALF * 100)}% fundamental.
            {source ? ` ${source}.` : ''}
            {asOf ? ` As of ${new Date(asOf).toLocaleString()}.` : ''}
          </div>
        </div>
      </div>

      {err && <div className="empty" style={{ marginBottom: 10 }}>{err}</div>}
      {loading && !techRows.length && <div className="dim" style={{ marginBottom: 10, fontSize: 12 }}>Loading TradingView India technicals…</div>}

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <ScoreChart title="Technical" hint="0–100 · TV daily" rows={techChart} active={picked} onPick={(s) => pick(s, 'technical')} />
        <ScoreChart title="Fundamental" hint="0–100 · verdict" rows={fundaChart} active={picked} onPick={(s) => pick(s, 'fundamental')} />
        <ScoreChart title="Techno + fundamental" hint="50 / 50" rows={combinedChart} active={picked} onPick={(s) => pick(s, 'combined')} />
      </div>

      {picked && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-title">
            <div>
              <h3>{picked} — every data point</h3>
              <div className="hint" style={{ marginTop: 4, textTransform: 'none', letterSpacing: 0 }}>
                {selectedFunda?.name ?? selectedTech?.name ?? ''}
                {selectedTech?.sector || selectedFunda?.sector ? ` · ${selectedFunda?.sector || selectedTech?.sector}` : ''}
              </div>
            </div>
            <button type="button" className="lens-open" onClick={() => navigate(`/stock/${picked}`)}>Open stock</button>
          </div>

          <div className="lens-formula">
            <div>
              <div className="lens-k">Technical</div>
              <div className={cls('lens-v', toneOf(selectedTech?.rating))}>
                {selectedTech?.techScore ?? '—'}
                <span>/100</span>
              </div>
              <div className="dim">{selectedTech?.rating ?? 'Not in the NSE market-cap scan'} · osc {selectedTech?.osc?.toFixed(2) ?? '—'} · ma {selectedTech?.ma?.toFixed(2) ?? '—'}</div>
            </div>
            <div className="lens-op">× {COMBINED_HALF}</div>
            <div>
              <div className="lens-k">Fundamental</div>
              <div className={cls('lens-v', toneOf(selectedFunda?.verdict.rating))}>
                {selectedFunda?.verdict.score ?? '—'}
                <span>/100</span>
              </div>
              <div className="dim">
                {selectedFunda
                  ? `${selectedFunda.verdict.rating} · Buffett ${selectedFunda.screens.buffett.score} · Lynch ${selectedFunda.screens.lynch.score} · Graham ${selectedFunda.screens.graham.score}`
                  : 'No fundamental file for this symbol'}
              </div>
            </div>
            <div className="lens-op">=</div>
            <div>
              <div className="lens-k">Techno + fundamental</div>
              <div className={cls('lens-v', selectedCombined == null ? 'amber' : toneOf(selectedCombined >= 58 ? 'Buy' : selectedCombined >= 44 ? 'Neutral' : 'Sell'))}>
                {selectedCombined ?? '—'}
                <span>/100</span>
              </div>
              <div className="dim">
                {selectedTech?.techScore != null && selectedFunda
                  ? `${selectedTech.techScore} × 0.5 + ${selectedFunda.verdict.score} × 0.5`
                  : 'Needs both scores'}
              </div>
            </div>
          </div>

          {selectedTech ? (
            <>
              <div className="grid-2" style={{ marginTop: 14 }}>
                <PointTable
                  title="Oscillators"
                  weight="11 points · equal weight · 50% of technical"
                  rows={oscPoints.map((p) => ({ label: p.label, value: p.value, signal: p.signal }))}
                />
                <PointTable
                  title="Moving averages"
                  weight="15 points · equal weight · 50% of technical"
                  rows={maPoints.map((p) => ({ label: p.label, value: p.value, signal: p.signal }))}
                />
              </div>
              <div className="hint" style={{ marginTop: 8 }}>
                Signals {selectedTech.buy} buy · {selectedTech.neutral} neutral · {selectedTech.sell} sell.
                Oscillator and moving-average scores are TradingView’s own averages.
              </div>
            </>
          ) : (
            <div className="empty" style={{ marginTop: 12 }}>No TradingView daily rating for {picked}. The technical scan covers the largest NSE names.</div>
          )}

          <div style={{ marginTop: 16 }}>
            {selectedFunda ? (
              <PointTable
                title="Fundamental checklist"
                weight={`Buffett ${Math.round(FUNDA_WEIGHTS.buffett * 100)}% · Lynch ${Math.round(FUNDA_WEIGHTS.lynch * 100)}% · Graham ${Math.round(FUNDA_WEIGHTS.graham * 100)}%`}
                rows={fundaPoints.map((p) => ({ label: p.label, value: p.value, signal: p.signal, extra: p.screen }))}
              />
            ) : (
              <div className="empty">No fundamental file for {picked}.</div>
            )}
          </div>
        </div>
      )}

      <div className="ts-toolbar">
        <div className="seg" role="tablist" aria-label="Which ranking table">
          {([
            ['technical', 'Technical table'],
            ['fundamental', 'Fundamental table'],
            ['combined', 'Techno + fundamental'],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" className={lens === id ? 'active' : ''} onClick={() => setLens(id)}>
              {label}
            </button>
          ))}
        </div>
        {lens !== 'fundamental' && (
          <input className="ts-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter symbol or name…" aria-label="Filter lens table" />
        )}
        {lens === 'combined' && (
          <button type="button" className={cls('lens-open', onlyBoth && 'on')} onClick={() => setOnlyBoth((v) => !v)}>
            {onlyBoth ? 'Showing strong on both' : 'Strong on both'}
          </button>
        )}
      </div>

      {lens === 'fundamental' && <TripleScreener onInspect={(s) => pick(s)} active={picked} />}

      {lens === 'technical' && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-title">
            <h3>Technical ranking</h3>
            <span className="hint">{techVisibleSrc.length} NSE names · daily</span>
          </div>
          <RankTable
            rows={techVisibleSrc.slice(0, limit).map((r) => ({
              symbol: r.symbol,
              name: r.name,
              sub: r.sector,
              price: r.price,
              changePct: r.changePct,
              cells: [
                { k: 'Osc', v: r.osc == null ? '—' : r.osc.toFixed(2), tone: toneOf(r.osc != null && r.osc > 0.1 ? 'Buy' : r.osc != null && r.osc < -0.1 ? 'Sell' : 'Neutral') },
                { k: 'MAs', v: r.ma == null ? '—' : r.ma.toFixed(2), tone: toneOf(r.ma != null && r.ma > 0.1 ? 'Buy' : r.ma != null && r.ma < -0.1 ? 'Sell' : 'Neutral') },
                { k: 'Score', v: r.techScore == null ? '—' : String(r.techScore), tone: toneOf(r.rating) },
                { k: 'Rating', v: r.rating ?? '—', tone: toneOf(r.rating) },
                { k: 'Signals', v: `${r.buy} / ${r.neutral} / ${r.sell}`, tone: 'amber' as const },
              ],
            }))}
            headers={['Osc −1..1', 'MAs −1..1', 'Technical', 'Rating', 'Buy / Neutral / Sell']}
            active={picked}
            onPick={(s) => pick(s)}
            onOpen={(s) => navigate(`/stock/${s}`)}
          />
          {limit < techVisibleSrc.length && (
            <button type="button" className="ts-more" onClick={() => setLimit((n) => n + PAGE)}>
              Show {Math.min(PAGE, techVisibleSrc.length - limit)} more
            </button>
          )}
        </div>
      )}

      {lens === 'combined' && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-title">
            <div>
              <h3>Techno + fundamental</h3>
              <div className="hint" style={{ marginTop: 4, textTransform: 'none', letterSpacing: 0 }}>
                Sorted by 50% technical + 50% fundamental. Strong on both means a TradingView Buy (score above 55) and a fundamental Buy (58+).
              </div>
            </div>
            <span className="hint">{combinedVisibleSrc.length} with both scores</span>
          </div>
          <RankTable
            rows={combinedVisibleSrc.slice(0, limit).map((r) => ({
              symbol: r.symbol,
              name: r.name,
              sub: r.funda.sector ?? '',
              price: r.tech.price ?? r.funda.price,
              changePct: r.tech.changePct,
              cells: [
                { k: 'Tech', v: String(r.techScore), tone: toneOf(r.tech.rating) },
                { k: 'Funda', v: String(r.fundaScore), tone: toneOf(r.funda.verdict.rating) },
                { k: 'Combined', v: String(r.combined), tone: toneOf(r.combined >= 58 ? 'Buy' : r.combined >= 44 ? 'Neutral' : 'Sell') },
                { k: 'Agree', v: r.both ? 'Both buy' : 'Split', tone: r.both ? 'up' as const : 'amber' as const },
              ],
            }))}
            headers={['Technical 50%', 'Fundamental 50%', 'Combined', 'Agreement']}
            active={picked}
            onPick={(s) => pick(s)}
            onOpen={(s) => navigate(`/stock/${s}`)}
          />
          {limit < combinedVisibleSrc.length && (
            <button type="button" className="ts-more" onClick={() => setLimit((n) => n + PAGE)}>
              Show {Math.min(PAGE, combinedVisibleSrc.length - limit)} more
            </button>
          )}
          {!loading && combinedRows.length === 0 && (
            <div className="empty">Combined names appear once technicals and the fundamental file both cover a symbol.</div>
          )}
        </div>
      )}
    </section>
  );
}

function RankTable({
  rows,
  headers,
  active,
  onPick,
  onOpen,
}: {
  rows: {
    symbol: string;
    name: string;
    sub: string;
    price: number | null;
    changePct: number | null;
    cells: { k: string; v: string; tone: 'up' | 'down' | 'amber' }[];
  }[];
  headers: string[];
  active: string | null;
  onPick: (symbol: string) => void;
  onOpen: (symbol: string) => void;
}) {
  if (!rows.length) return <div className="empty">Nothing matches this filter.</div>;
  return (
    <div className="table-wrap ts-wrap">
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Last</th>
            <th>Day</th>
            {headers.map((h) => <th key={h}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} className={active === r.symbol ? 'lens-active' : ''} onClick={() => onPick(r.symbol)}>
              <td>
                <div className="sym-cell">{r.symbol}</div>
                <div className="name-cell">{r.name}{r.sub ? ` · ${r.sub}` : ''}</div>
                <button type="button" className="lens-open" onClick={(e) => { e.stopPropagation(); onOpen(r.symbol); }}>Open</button>
              </td>
              <td className="mono">{r.price == null ? '—' : fmt(r.price)}</td>
              <td className={cls('mono', (r.changePct ?? 0) >= 0 ? 'up' : 'down')}>{r.changePct == null ? '—' : fmtPct(r.changePct)}</td>
              {r.cells.map((c) => (
                <td key={c.k} className={cls('mono', c.tone)}>{c.v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
