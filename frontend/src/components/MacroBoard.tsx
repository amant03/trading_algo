import { useEffect, useMemo, useState } from 'react';
import { fmt, fmtPct, cls } from '../format';
import { macroSummary, readMacro, type MacroMoves } from '../lib/macroRead';

interface MacroQuote {
  id: string;
  name: string;
  group: 'Crude oil' | 'Bullion' | 'Metals' | 'Currency';
  unit: string;
  price: number;
  changePct: number;
}

const GROUPS: MacroQuote['group'][] = ['Crude oil', 'Metals', 'Bullion'];

const EMPTY: MacroMoves = { brent: null, gold: null, silver: null, copper: null, usdinr: null };

function movesOf(quotes: MacroQuote[]): MacroMoves {
  const byId = new Map(quotes.map((q) => [q.id, q.changePct]));
  return {
    brent: byId.get('brent') ?? null,
    gold: byId.get('gold') ?? null,
    silver: byId.get('silver') ?? null,
    copper: byId.get('copper') ?? null,
    usdinr: byId.get('usdinr') ?? null,
  };
}

export default function MacroBoard({ niftyPct }: { niftyPct: number | null }) {
  const [quotes, setQuotes] = useState<MacroQuote[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/macro', { cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json()) as { quotes?: MacroQuote[]; error?: string };
        if (!live) return;
        if (!res.ok || !data.quotes?.length) {
          setErr(data.error ?? 'Commodity quotes are unavailable right now.');
          setQuotes([]);
          return;
        }
        setQuotes(data.quotes);
        setErr(null);
      })
      .catch(() => {
        if (!live) return;
        setErr('Commodity quotes are unavailable right now.');
        setQuotes([]);
      });
    return () => {
      live = false;
    };
  }, []);

  const moves = useMemo(() => (quotes ? movesOf(quotes) : EMPTY), [quotes]);
  const drivers = useMemo(() => readMacro(moves), [moves]);
  const summary = useMemo(() => macroSummary(drivers, niftyPct), [drivers, niftyPct]);
  const rupee = quotes?.find((q) => q.id === 'usdinr') ?? null;

  return (
    <>
      <section id="commodities" className="dash-section">
        <header className="dash-head">
          <h2>Crude, metals, bullion</h2>
          <p>Global benchmarks. Brent is the crude grade that matters for India’s import bill.</p>
        </header>
        {quotes == null && <div className="dim">Loading commodity quotes…</div>}
        {err && <div className="empty" style={{ marginBottom: 12 }}>{err}</div>}
        {GROUPS.map((group) => {
          const rows = (quotes ?? []).filter((q) => q.group === group);
          if (!rows.length) return null;
          return (
            <div key={group} className="macro-group">
              <h3>{group}</h3>
              <div className="macro-grid">
                {rows.map((q) => (
                  <div key={q.id} className="macro-card">
                    <div className="stat-label">{q.name}</div>
                    <div className="macro-px mono">{fmt(q.price)}</div>
                    <div className="stat-sub">
                      <span className={q.changePct >= 0 ? 'up' : 'down'}>{fmtPct(q.changePct)}</span>
                      <span className="dim">{q.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section id="correlation" className="dash-section">
        <header className="dash-head">
          <h2>Correlation</h2>
          <p>How today’s commodity tape usually lands on Indian equities. These are direct desk reads, not a fitted model.</p>
        </header>
        <div className="panel">
          <p className="corr-summary">{summary}</p>
          {rupee && (
            <div className="corr-rupee">
              <span className="dim">USD/INR</span>
              <span className="mono">{fmt(rupee.price)}</span>
              <span className={cls('mono', rupee.changePct >= 0 ? 'up' : 'down')}>{fmtPct(rupee.changePct)}</span>
              <span className="dim">up means a weaker rupee</span>
            </div>
          )}
          <div>
            {drivers.map((d) => (
              <div key={d.id} className="corr-row">
                <div>
                  <div className={cls('corr-bias', d.bias)}>{d.biasLabel}</div>
                  <div className="mono corr-move">{d.moveLabel}</div>
                </div>
                <div>
                  <div className="corr-title">{d.title}</div>
                  <p>{d.today}</p>
                  <p className="dim">{d.rule}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
