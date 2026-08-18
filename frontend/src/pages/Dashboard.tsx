import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get } from '../api';
import { useLive } from '../ws';
import { fmt, fmtPct, fmtCompact, cls } from '../format';
import type { Instrument, MarketOverview, Snapshot, Candle } from '../types';
import { Sparkline } from '../components/Sparkline';
import SignalFeed from '../components/SignalFeed';
import NewsFeed from '../components/NewsFeed';

function SparkHistory({ symbol }: { symbol: string }) {
  const [candles, setCandles] = useState<Candle[]>([]);
  useEffect(() => {
    get<{ candles: Candle[] }>(`/api/instruments/${symbol}/candles?timeframe=1d&limit=40`)
      .then((r) => setCandles(r.candles))
      .catch(() => {});
  }, [symbol]);
  const closes = candles.map((c) => c.close);
  return <Sparkline points={closes} up={closes.length ? closes[closes.length - 1] >= closes[0] : true} />;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const snapshots = useLive((s) => s.snapshots);
  const signals = useLive((s) => s.signals);
  const news = useLive((s) => s.news);
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [instruments, setInstruments] = useState<Instrument[]>([]);

  useEffect(() => {
    get<MarketOverview>('/api/market/overview').then(setOverview).catch(() => {});
    get<Instrument[]>('/api/instruments').then(setInstruments).catch(() => {});
  }, []);

  const live = useMemo(() => {
    const list = Object.values(snapshots).filter(Boolean) as Snapshot[];
    const bySym = new Map(list.map((s) => [s.symbol, s]));
    const gainers = [...list].sort((a, b) => b.changePct - a.changePct).slice(0, 8);
    const losers = [...list].sort((a, b) => a.changePct - b.changePct).slice(0, 8);
    return { list, bySym, gainers, losers };
  }, [snapshots]);

  const total = live.list.length || overview?.market.total || 0;
  const adv = overview?.market.advancers ?? live.list.filter((s) => s.changePct > 0).length;
  const dec = overview?.market.decliners ?? live.list.filter((s) => s.changePct < 0).length;
  const breadth = total ? (adv / total) * 100 : 0;

  const index = overview?.index;

  const sectors = (overview?.sectorPerformance ?? []).map((s) => {
    const pct = s.changePct;
    return { ...s, pct };
  });

  const sectorMin = sectors.length ? Math.min(...sectors.map((s) => s.pct)) : 0;
  const sectorMax = sectors.length ? Math.max(...sectors.map((s) => s.pct)) : 0;

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Market Dashboard</h1>
      <p className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
        Live simulated NSE feed via Kafka — signals, fills and quotes stream in real time.
      </p>

      <div className="stat-grid">
        <div className="stat-card reveal">
          <div className="stat-label">NIFTY 50 Index</div>
          <div className="stat-value mono">{index ? fmt(index.price) : <span className="skeleton">00000</span>}</div>
          <div className="stat-sub">
            {index ? (
              <span className={index.changePct >= 0 ? 'up' : 'down'}>{fmtPct(index.changePct)}</span>
            ) : null}
            <span className="dim">today</span>
          </div>
        </div>
        <div className="stat-card reveal reveal-1">
          <div className="stat-label">Advancers / Decliners</div>
          <div className="stat-value mono">
            <span className="up">{adv}</span>
            <span className="dim"> / </span>
            <span className="down">{dec}</span>
          </div>
          <div className="stat-sub">
            <span style={{ display: 'inline-block', width: 130, height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
              <span style={{ display: 'block', width: `${breadth}%`, height: '100%', background: 'linear-gradient(90deg,var(--down),var(--amber),var(--up))' }} />
            </span>
            <span className="dim">{total} stocks</span>
          </div>
        </div>
        <div className="stat-card reveal reveal-2">
          <div className="stat-label">Live Signals</div>
          <div className="stat-value mono">{signals.length}</div>
          <div className="stat-sub">
            <span className="cyan">streaming</span>
            <span className="dim">in session</span>
          </div>
        </div>
        <div className="stat-card reveal reveal-3">
          <div className="stat-label">News Sentiment</div>
          <div className="stat-value mono">{news.length ? `${Math.round((news.filter((n) => n.sentiment === 'BULLISH').length / news.length) * 100)}%` : '—'}</div>
          <div className="stat-sub">
            <span className="up">positive</span>
            <span className="dim">in feed</span>
          </div>
        </div>
      </div>

      <div className="grid-2-1" style={{ marginBottom: 16 }}>
        <div className="panel reveal reveal-1" style={{ minHeight: 380 }}>
          <div className="panel-title">
            <h3>Market Movers</h3>
            <span className="hint">live · click to drill in</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Last</th>
                  <th>Day Trend</th>
                  <th>Chg %</th>
                  <th>Volume</th>
                </tr>
              </thead>
              <tbody>
                {live.gainers.map((s) => {
                  const inst = instruments.find((i) => i.symbol === s.symbol);
                  return (
                    <tr key={s.symbol} onClick={() => navigate(`/stock/${s.symbol}`)}>
                      <td>
                        <div className="sym-cell">{s.symbol}</div>
                        <div className="name-cell">{inst?.name ?? ''}</div>
                      </td>
                      <td className="mono">{fmt(s.price)}</td>
                      <td><SparkHistory symbol={s.symbol} /></td>
                      <td className="mono"><span className={s.changePct >= 0 ? 'up' : 'down'}>{fmtPct(s.changePct)}</span></td>
                      <td className="mono muted">{fmtCompact(s.dayVolume)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel reveal reveal-2" style={{ minHeight: 380 }}>
          <div className="panel-title">
            <h3>Sector Performance</h3>
            <span className="hint">by avg change</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {sectors.map((s) => (
              <div key={s.sector}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span className="muted" style={{ fontSize: 12 }}>{s.sector}</span>
                  <span className={cls('mono', s.pct >= 0 ? 'up' : 'down')} style={{ fontSize: 12, fontWeight: 600 }}>{fmtPct(s.pct)}</span>
                </div>
                <div style={{ height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                  <span
                    style={{
                      display: 'block',
                      height: '100%',
                      width: `${sectorMax !== sectorMin ? ((s.pct - sectorMin) / (sectorMax - sectorMin)) * 100 : 50}%`,
                      background: s.pct >= 0 ? 'linear-gradient(90deg,#00b877,var(--up))' : 'linear-gradient(90deg,#e04343,var(--down))',
                    }}
                  />
                </div>
              </div>
            ))}
            {sectors.length === 0 && <div className="empty">No sector data.</div>}
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="panel reveal reveal-1">
          <div className="panel-title">
            <h3>Top Losers</h3>
            <span className="hint">today</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Last</th>
                  <th>Chg %</th>
                </tr>
              </thead>
              <tbody>
                {live.losers.map((s) => (
                  <tr key={s.symbol} onClick={() => navigate(`/stock/${s.symbol}`)}>
                    <td className="sym-cell">{s.symbol}</td>
                    <td className="mono">{fmt(s.price)}</td>
                    <td className="mono down">{fmtPct(s.changePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel reveal reveal-2">
          <div className="panel-title">
            <h3>Live News</h3>
            <span className="hint">streaming · market.news</span>
          </div>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <NewsFeed items={news} limit={8} />
          </div>
        </div>
      </div>

      <div className="panel reveal reveal-1">
        <div className="panel-title">
          <h3>Algorithm Signals</h3>
          <span className="hint">streaming · market.signals</span>
        </div>
        <SignalFeed signals={signals} limit={25} />
      </div>
    </div>
  );
}
