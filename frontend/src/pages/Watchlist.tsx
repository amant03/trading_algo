import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, del } from '../api';
import { useLive } from '../ws';
import { fmt, fmtPct, cls } from '../format';
import { useToast } from '../components/Toasts';
import type { Instrument } from '../types';

interface WatchItem extends Instrument {
  price: number;
  changePct: number;
}

export default function Watchlist() {
  const navigate = useNavigate();
  const toast = useToast();
  const snapshots = useLive((s) => s.snapshots);
  const [items, setItems] = useState<WatchItem[]>([]);
  const [addSymbol, setAddSymbol] = useState('');
  const [allInstruments, setAllInstruments] = useState<Instrument[]>([]);

  const refresh = useCallback(() => {
    get<WatchItem[]>('/api/watchlist')
      .then(setItems)
      .catch(() => {
        // Static deploy / no backend: seed a sensible watchlist from the
        // snapshot feed so the page is never an empty shell.
        const snaps = Object.values(snapshots).sort((a, b) => b.changePct - a.changePct);
        setItems((prev) =>
          prev.length
            ? prev
            : snaps.slice(0, 10).map((s) => ({
                id: s.instrumentId,
                symbol: s.symbol,
                name: s.symbol,
                sector: '',
                isin: '',
                exchange: 'NSE',
                marketCap: 0,
                basePrice: s.price,
                price: s.price,
                changePct: s.changePct,
              })),
        );
      });
  }, [snapshots]);

  useEffect(() => {
    refresh();
    get<Instrument[]>('/api/instruments').then(setAllInstruments).catch(() => {});
  }, [refresh]);

  useEffect(() => {
    setItems((prev) =>
      prev.map((w) => {
        const s = snapshots[w.symbol];
        return s ? { ...w, price: s.price, changePct: s.changePct } : w;
      }),
    );
  }, [snapshots]);

  const add = async () => {
    const sym = addSymbol.trim().toUpperCase();
    if (!sym) return;
    try {
      await post(`/api/watchlist/${sym}`, {});
      toast(`Added ${sym} to watchlist`, 'ok');
      setAddSymbol('');
      refresh();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };

  const remove = async (sym: string) => {
    try {
      await del(`/api/watchlist/${sym}`);
      toast(`Removed ${sym}`, 'ok');
      refresh();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };

  const exists = (sym: string) => items.some((w) => w.symbol === sym.toUpperCase());

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Watchlist</h1>
      <p className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
        Track your favourite names. Live prices stream over the WebSocket.
      </p>

      <div className="panel reveal" style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label className="mono dim" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Add symbol</label>
          <input className="input" list="all-instruments" value={addSymbol} placeholder="e.g. RELIANCE" onChange={(e) => setAddSymbol(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <datalist id="all-instruments">
            {allInstruments.filter((i) => !exists(i.symbol)).map((i) => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}
          </datalist>
        </div>
        <button className="btn primary" onClick={add} disabled={!addSymbol.trim()}>Add</button>
      </div>

      <div className="panel reveal reveal-1">
        <div className="panel-title"><h3>Watching</h3><span className="hint">{items.length} symbols</span></div>
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
                    <td className="muted">{w.sector ?? '—'}</td>
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