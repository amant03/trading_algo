import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLive } from '../ws';
import { fmt, cls } from '../format';
import { GradeBadge } from './Badge';
import type { StockAnalysis } from '../types';

type Preset = 'elite' | 'high' | 'solid';

const PRESETS: { id: Preset; label: string; min: number; hint: string }[] = [
  { id: 'elite', label: 'Elite', min: 72, hint: 'Blended ≥72 — same score as the stock page' },
  { id: 'high', label: 'High', min: 56, hint: 'Blended ≥56 — same score as the stock page' },
  { id: 'solid', label: 'Solid', min: 48, hint: 'Blended ≥48 — same score as the stock page' },
];

function scoreTone(score: number): 'up' | 'amber' | 'down' {
  if (score >= 72) return 'up';
  if (score >= 56) return 'amber';
  return 'down';
}

function ScreenMark({ label, score, grade }: { label: string; score: number; grade: string }) {
  const tone = scoreTone(score);
  return (
    <div className="ts-mark" title={`${label} ${score}/100 · ${grade}`}>
      <div className="ts-mark-top">
        <span className="ts-mark-lab">{label}</span>
        <GradeBadge grade={grade} />
      </div>
      <div className="ts-bar">
        <span className={tone} style={{ width: `${Math.max(4, Math.min(100, score))}%` }} />
      </div>
      <div className={cls('ts-mark-n', tone)}>{score}</div>
    </div>
  );
}

const PAGE = 40;

function LivePrice({ symbol, fallback }: { symbol: string; fallback: number }) {
  const price = useLive((s) => s.snapshots[symbol]?.price);
  return <>{fmt(price && price > 0 ? price : fallback)}</>;
}

export default function TripleScreener({ onInspect, active }: { onInspect?: (symbol: string) => void; active?: string | null }) {
  const navigate = useNavigate();
  const fundamentals = useLive((s) => s.fundamentals);
  const universeList = useLive((s) => s.universe);
  const [preset, setPreset] = useState<Preset>('high');
  const [q, setQ] = useState('');
  const [sector, setSector] = useState('all');
  const [cap, setCap] = useState<'all' | 'large' | 'mid' | 'small'>('all');
  const [limit, setLimit] = useState(PAGE);

  const capOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of universeList) m.set(u.symbol.toUpperCase(), u.cap);
    return m;
  }, [universeList]);

  const capLabel = (symbol: string): string => {
    const c = capOf.get(symbol.toUpperCase());
    if (c === 'large' || c === 'mid' || c === 'small') return c;
    return 'small';
  };

  const min = PRESETS.find((p) => p.id === preset)!.min;
  const needle = q.trim().toLowerCase();

  const universe = useMemo(() => Object.values(fundamentals).filter((f) => f?.screens?.buffett && f.screens.lynch && f.screens.graham), [fundamentals]);

  const sectors = useMemo(() => {
    const set = new Set<string>();
    for (const f of universe) if (f.sector) set.add(f.sector);
    return [...set].sort();
  }, [universe]);

  const rows = useMemo(() => {
    const out: (StockAnalysis & { floor: number })[] = [];
    for (const f of universe) {
      // Rank by the HEADLINE blended verdict score — the exact number the
      // stock page shows. Filtering by the floor (weakest screen) hid
      // high-blended names (e.g. MAHABANK 82 with Graham 58); floor stays
      // visible as the "weakest link" column.
      const v = f.verdict?.score;
      if (v == null || !isFinite(v) || v < min) continue;
      const b = f.screens.buffett.score;
      const l = f.screens.lynch.score;
      const g = f.screens.graham.score;
      if (![b, l, g].every((s) => typeof s === 'number' && isFinite(s))) continue;
      if (sector !== 'all' && f.sector !== sector) continue;
      if (needle) {
        const blob = `${f.symbol} ${f.name ?? ''} ${f.sector ?? ''}`.toLowerCase();
        if (!blob.includes(needle)) continue;
      }
      out.push({ ...f, floor: Math.min(b, l, g) });
    }
    out.sort((a, b) => b.verdict.score - a.verdict.score || b.floor - a.floor);
    return out.filter((r) => cap === 'all' || capLabel(r.symbol) === cap);
  }, [universe, min, sector, needle, cap, capOf]);

  const presetMeta = PRESETS.find((p) => p.id === preset)!;
  const visible = rows.slice(0, limit);

  useEffect(() => {
    setLimit(PAGE);
  }, [preset, sector, cap, needle]);

  return (
    <div className="panel reveal reveal-1 ts-panel" style={{ marginBottom: 16 }}>
      <div className="panel-title">
        <div>
          <h3>Fundamental — Buffett + Lynch + Graham</h3>
          <div className="hint" style={{ marginTop: 4, textTransform: 'none', letterSpacing: 0 }}>
            Ranked by the <b>blended verdict</b> — the same 0–100 number each stock page shows.
            Buffett 45% (quality) · Lynch 35% (growth at a fair price) · Graham 20% (margin of safety).
          </div>
        </div>
        <span className="hint">{rows.length} of {universe.length} pass · {presetMeta.hint}</span>
      </div>

      <div className="ts-toolbar">
        <div className="seg" role="tablist" aria-label="Minimum blended verdict score">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className={p.id === preset ? 'active' : ''} onClick={() => setPreset(p.id)}>
              {p.label} ≥{p.min}
            </button>
          ))}
        </div>
        <div className="seg" role="tablist" aria-label="Market capitalisation">
          {(['all', 'large', 'mid', 'small'] as const).map((c) => (
            <button key={c} type="button" className={cap === c ? 'active' : ''} onClick={() => setCap(c)}>
              {c === 'all' ? 'All caps' : c[0].toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
        <select className="ts-select" value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Sector">
          <option value="all">All sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input
          className="ts-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter symbol or name…"
          aria-label="Filter screener"
        />
      </div>

      {rows.length ? (
        <div className="table-wrap ts-wrap">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Buffett</th>
                <th>Lynch</th>
                <th>Graham</th>
                <th>Floor</th>
                <th>Last</th>
                <th>Fair value</th>
                <th>MoS</th>
                <th>Blended</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const ratingColor =
                  p.verdict.rating === 'Strong Buy' || p.verdict.rating === 'Buy'
                    ? 'var(--up)'
                    : p.verdict.rating === 'Hold'
                      ? 'var(--amber)'
                      : 'var(--down)';
                return (
                  <tr key={p.symbol} className={active === p.symbol ? 'lens-active' : ''} onClick={() => (onInspect ? onInspect(p.symbol) : navigate(`/stock/${p.symbol}`))}>
                    <td>
                      <div className="sym-cell">{p.symbol}</div>
                      <div className="name-cell">{p.name ?? p.sector ?? ''} · <span style={{ textTransform: 'capitalize' }}>{capLabel(p.symbol)}-cap</span></div>
                      {onInspect && (
                        <button type="button" className="lens-open" onClick={(e) => { e.stopPropagation(); navigate(`/stock/${p.symbol}`); }}>
                          Open
                        </button>
                      )}
                    </td>
                    <td><ScreenMark label="quality" score={p.screens.buffett.score} grade={p.screens.buffett.grade} /></td>
                    <td><ScreenMark label="growth" score={p.screens.lynch.score} grade={p.screens.lynch.grade} /></td>
                    <td><ScreenMark label="value" score={p.screens.graham.score} grade={p.screens.graham.grade} /></td>
                    <td className="mono">
                      <b className={scoreTone(p.floor)}>{p.floor}</b>
                    </td>
                    <td className="mono"><LivePrice symbol={p.symbol} fallback={p.price} /></td>
                    <td className="mono">{fmt(p.verdict.fairValueMid)}</td>
                    <td className={cls('mono', p.verdict.marginOfSafety >= 0 ? 'up' : 'down')}>
                      {p.verdict.marginOfSafety > 0 ? '+' : ''}{p.verdict.marginOfSafety}%
                    </td>
                    <td>
                      <div className="mono" style={{ color: ratingColor, fontWeight: 700 }}>{p.verdict.rating}</div>
                      <div className="dim" style={{ fontSize: 11 }}>{p.verdict.score}/100 · {p.verdict.grade}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          {universe.length
            ? `No names with blended score ${presetMeta.label} (≥${min})${sector !== 'all' ? ` in ${sector}` : ''}. Try Solid, or clear the sector filter.`
            : 'Analyst screens load with the nightly coverage file — they will appear here once analysis.json is in.'}
        </div>
      )}
      {visible.length < rows.length && (
        <button type="button" className="ts-more" onClick={() => setLimit((n) => n + PAGE)}>
          Show {Math.min(PAGE, rows.length - visible.length)} more · {rows.length - visible.length} hidden
        </button>
      )}
      {rows.length > 0 && (
        <div className="hint" style={{ padding: '8px 4px 0', lineHeight: 1.55 }}>
          Floor is the weakest of the three scores, shown for context — ranking is by the blended verdict, identical to the stock page.
          {rows[0] ? ` Top blended right now: ${rows[0].symbol} (${rows[0].verdict.score}).` : ''}
        </div>
      )}
    </div>
  );
}
