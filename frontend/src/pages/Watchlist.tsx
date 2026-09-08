import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLive } from '../ws';
import { fmt, fmtPct, cls } from '../format';
import { useToast } from '../components/Toasts';
import type { Instrument } from '../types';

export default function Watchlist() {
  const navigate = useNavigate();
  const toast = useToast();
  const snapshots = useLive((s) => s.snapshots);
  const instruments = useLive((s) => s.instruments);
  const fundamentals = useLive((s) => s.fundamentals);
  const watchlist = useLive((s) => s.watchlist);
  const toggleWatch = useLive((s) => s.toggleWatch);
  const [addSymbol, setAddSymbol] = useState('');

  // union of every name we know about, so the picker always has options even
  // before the snapshot lands
  const all = useMemo(() => {
    const map = new Map<string, Instrument>();
    for (const i of instruments) map.set(i.symbol, i);
    for (const sym of Object.keys(fundamentals)) {
      const f = fundamentals[sym];
      if (!map.has(sym)) {
        map.set(sym, {
          id: 0,
          symbol: sym,
          name: f.name ?? sym,
          sector: f.sector ?? '',
          isin: '',
          exchange: 'NSE',
          marketCap: f.marketCap ?? 0,
          basePrice: f.price,
        });
      }
    }
    for (const sym of Object.keys(snapshots)) {
      if (!map.has(sym)) {
        const s = snapshots[sym];
        map.set(sym, { id: 0, symbol: sym, name: sym, sector: '', isin: '', exchange: 'NSE', marketCap: 0, basePrice: s.price });
      }
    }
    return [...map.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [instruments, fundamentals, snapshots]);

  const add = () => {
    const sym = addSymbol.trim().toUpperCase();
    if (!sym) return;
    const known = all.some((i) => i.symbol === sym);
    if (!known) {
      toast(`Unknown symbol "${sym}" — try the search to find a valid stock`, 'err');
      return;
    }
    if (toggleWatch(sym)) toast(`Added ${sym} to watchlist`, 'ok');
    else toast(`${sym} was already in the watchlist`, 'ok');
    setAddSymbol('');
  };

  const remove = (sym: string) => {
    toggleWatch(sym);
    toast(`Removed ${sym}`, 'ok');
  };

  const items = watchlist
    .map((sym) => {
      const i = all.find((x) => x.symbol === sym);
      const s = snapshots[sym];
      return {
        symbol: sym,
        name: i?.name ?? sym,
        sector: i?.sector ?? (fundamentals[sym]?.sector ?? '—'),
        price: s?.price ?? i?.basePrice ?? 0,
        changePct: s?.changePct ?? 0,
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const filtered = all.filter((i) => !watchlist.includes(i.symbol));

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Watchlist</h1>
      <p className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
        Track your favourite names. Saved locally so it works even without the backend.
      </p>

      <div className="panel reveal" style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label className="mono dim" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Add symbol</label>
          <input className="input" list="all-instruments" value={addSymbol} placeholder="e.g. RELIANCE or TCS" onChange={(e) => setAddSymbol(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <datalist id="all-instruments">
            {filtered.map((i) => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}
          </datalist>
        </div>
        <button className="btn primary" onClick={add} disabled={!addSymbol.trim()}>Add</button>
      </div>

      <div className="panel reveal reveal-1">
        <div className="panel-title"><h3>Watching</h3><span className="hint">{items.length} symbols · local-first</span></div>
        {items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Symbol</th><th>Name</th><th>Sector</th><th>Last</th><th>Change</th><th>Action</th></tr>
              </thead>
              <tbody>
                {items.map((w) => (
                  <tr key={w.symbol} onClick={() => navigate(`/stock/${w.symbol}`)}>
                    <td className="sym-cell">{w.symbol}</td>
                    <td className="name-cell">{w.name}</td>
                    <td className="muted">{w.sector}</td>
                    <td className="mono">{fmt(w.price)}</td>
                    <td className={cls('mono', w.changePct >= 0 ? 'up' : 'down')}>{fmtPct(w.changePct)}</td>
                    <td>
                      <button
                        className="btn"
                        style={{ padding: '4px 10px', fontSize: 11 }}
                        onClick={(e) => { e.stopPropagation(); remove(w.symbol); }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">Your watchlist is empty. Add a symbol above or from any stock page.</div>
        )}
      </div>
    </div>
  );
}