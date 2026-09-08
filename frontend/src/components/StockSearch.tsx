import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLive, refreshSymbols } from '../ws';
import { fmtPct, cls } from '../format';

interface Row {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
}

export default function StockSearch() {
  const navigate = useNavigate();
  const instruments = useLive((s) => s.instruments);
  const universe = useLive((s) => s.universe);
  const fundamentals = useLive((s) => s.fundamentals);
  const snapshots = useLive((s) => s.snapshots);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [remote, setRemote] = useState<Row[]>([]);
  const box = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => {
    const map = new Map<string, Row>();
    const add = (symbol: string, name: string, sector: string, price = 0, changePct = 0) => {
      const s = snapshots[symbol];
      const prev = map.get(symbol);
      map.set(symbol, {
        symbol,
        name: name || prev?.name || symbol,
        sector: sector || prev?.sector || '',
        price: s?.price ?? (price || prev?.price || 0),
        changePct: s?.changePct ?? changePct,
      });
    };
    for (const u of universe) add(u.symbol, u.name, `${u.exchange} · ${u.cap}`, 0, 0);
    for (const i of instruments) add(i.symbol, i.name ?? i.symbol, i.sector ?? '', i.basePrice, 0);
    for (const sym of Object.keys(fundamentals)) {
      const f = fundamentals[sym];
      add(sym, f.name ?? sym, f.sector ?? '', f.price, 0);
    }
    for (const r of remote) add(r.symbol, r.name, r.sector, r.price, r.changePct);
    return [...map.values()];
  }, [instruments, universe, fundamentals, snapshots, remote]);

  const results = useMemo(() => {
    const term = q.trim().toUpperCase();
    if (!term) return [];
    const exact = term.replace(/\s+/g, '');
    const scored = rows
      .map((r) => {
        const sym = r.symbol.toUpperCase();
        const name = r.name.toUpperCase();
        let score = -1;
        if (sym === exact) score = 0;
        else if (sym.startsWith(exact)) score = 1;
        else if (sym.includes(exact)) score = 2;
        else if (name.startsWith(exact)) score = 3;
        else if (name.includes(exact)) score = 4;
        else if (r.sector.toUpperCase().includes(exact)) score = 5;
        return { r, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score || a.r.symbol.localeCompare(b.r.symbol))
      .slice(0, 12)
      .map((x) => x.r);
    return scored;
  }, [rows, q]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRemote([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d: { hits?: { symbol: string; name: string; exchange: string }[] }) => {
          setRemote(
            (d.hits ?? []).map((h) => ({
              symbol: h.symbol,
              name: h.name,
              sector: h.exchange,
              price: 0,
              changePct: 0,
            })),
          );
        })
        .catch(() => {});
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const reset = () => {
    setQ('');
    setOpen(false);
    setHi(0);
  };

  const go = (sym: string) => {
    reset();
    void refreshSymbols([sym]);
    navigate(`/stock/${sym}`);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { reset(); box.current?.blur(); }
    else if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault();
      setHi((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault();
      setHi((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[hi]) go(results[hi].symbol);
      else if (/^[A-Za-z0-9][A-Za-z0-9&-]{0,19}$/.test(q.trim())) go(q.trim().toUpperCase());
    }
  };

  return (
    <div className="stock-search">
      <svg className="search-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <line x1="16.5" y1="16.5" x2="21" y2="21" />
      </svg>
      <input
        ref={box}
        className="search-input"
        placeholder="Search 5,000+ NSE & BSE stocks…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKey}
      />
      {open && q.trim() ? (
        <div className="search-results">
          {results.length === 0 && <div className="search-empty">No match in the listed universe — press Enter to open {q.trim().toUpperCase()}</div>}
          {results.map((r, i) => (
            <div key={r.symbol} className={cls('search-item', i === hi && 'hi')} onMouseDown={(e) => { e.preventDefault(); go(r.symbol); }} onMouseEnter={() => setHi(i)}>
              <span className="sym">{r.symbol}</span>
              <span className="name">{r.name || r.sector || '—'}</span>
              <span className="px mono">{r.price ? r.price.toLocaleString('en-IN') : '—'}</span>
              <span className={cls('mono', r.changePct >= 0 ? 'up' : 'down')}>{r.changePct ? fmtPct(r.changePct) : '—'}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
