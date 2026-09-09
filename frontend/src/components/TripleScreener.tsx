import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLive } from '../ws';
import { fmt, cls } from '../format';
import { GradeBadge } from './Badge';
import type { StockAnalysis } from '../types';

type Preset = 'elite' | 'high' | 'solid';

const PRESETS: { id: Preset; label: string; min: number; hint: string }[] = [
  { id: 'elite', label: 'Elite', min: 72, hint: 'A or better on all three' },
  { id: 'high', label: 'High', min: 56, hint: 'B+ or better on all three' },
  { id: 'solid', label: 'Solid', min: 48, hint: 'B or better on all three' },
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

export default function TripleScreener() {
  const navigate = useNavigate();
  const fundamentals = useLive((s) => s.fundamentals);
  const snapshots = useLive((s) => s.snapshots);
  const [preset, setPreset] = useState<Preset>('high');
  const [q, setQ] = useState('');
  const [sector, setSector] = useState('all');

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
      const b = f.screens.buffett.score;
      const l = f.screens.lynch.score;
      const g = f.screens.graham.score;
      if (b < min || l < min || g < min) continue;
      if (sector !== 'all' && f.sector !== sector) continue;
      if (needle) {
        const blob = `${f.symbol} ${f.name ?? ''} ${f.sector ?? ''}`.toLowerCase();
        if (!blob.includes(needle)) continue;
      }
      out.push({ ...f, floor: Math.min(b, l, g) });
    }
    out.sort((a, b) => b.floor - a.floor || b.verdict.score - a.verdict.score);
    return out;
  }, [universe, min, sector, needle]);

  const presetMeta = PRESETS.find((p) => p.id === preset)!;

  return (
    <div className="panel reveal reveal-1 ts-panel" style={{ marginBottom: 16 }}>
      <div className="panel-title">
        <div>
          <h3>Master screener — Buffett + Lynch + Graham</h3>
          <div className="hint" style={{ marginTop: 4, textTransform: 'none', letterSpacing: 0 }}>
            Names that clear the bar on <b>all three</b> models, not just the blended average.
            Buffett = quality (ROE, margins, low debt). Lynch = growth at a fair price. Graham = margin of safety.
          </div>
        </div>
        <span className="hint">{rows.length} of {universe.length} pass · {presetMeta.hint}</span>
      </div>

      <div className="ts-toolbar">
        <div className="seg" role="tablist" aria-label="Minimum grade on all three screens">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className={p.id === preset ? 'active' : ''} onClick={() => setPreset(p.id)}>
              {p.label} ≥{p.min}
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
              {rows.map((p) => {
                const live = snapshots[p.symbol]?.price;
                const price = live && live > 0 ? live : p.price;
                const ratingColor =
                  p.verdict.rating === 'Strong Buy' || p.verdict.rating === 'Buy'
                    ? 'var(--up)'
                    : p.verdict.rating === 'Hold'
                      ? 'var(--amber)'
                      : 'var(--down)';
                return (
                  <tr key={p.symbol} onClick={() => navigate(`/stock/${p.symbol}`)}>
                    <td>
                      <div className="sym-cell">{p.symbol}</div>
                      <div className="name-cell">{p.name ?? p.sector ?? ''}</div>
                    </td>
                    <td><ScreenMark label="quality" score={p.screens.buffett.score} grade={p.screens.buffett.grade} /></td>
                    <td><ScreenMark label="growth" score={p.screens.lynch.score} grade={p.screens.lynch.grade} /></td>
                    <td><ScreenMark label="value" score={p.screens.graham.score} grade={p.screens.graham.grade} /></td>
                    <td className="mono">
                      <b className={scoreTone(p.floor)}>{p.floor}</b>
                    </td>
                    <td className="mono">{fmt(price)}</td>
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
            ? `No names clear ${presetMeta.label} (≥${min}) on all three screens${sector !== 'all' ? ` in ${sector}` : ''}. Try Solid, or clear the sector filter.`
            : 'Analyst screens load with the nightly coverage file — they will appear here once analysis.json is in.'}
        </div>
      )}
      {rows.length > 0 && (
        <div className="hint" style={{ padding: '8px 4px 0', lineHeight: 1.55 }}>
          Floor is the weakest of the three scores — a name only ranks high here if Buffett, Lynch <em>and</em> Graham all agree.
          Graham is the strictest (cheap on earnings and book), so Elite is a short list by design.
          {rows[0] ? ` Top floor right now: ${rows[0].symbol} (${rows[0].floor}).` : ''}
        </div>
      )}
    </div>
  );
}
