import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { UTCTimestamp } from 'lightweight-charts';
import { get, post, del } from '../api';
import { useLive } from '../ws';
import { fmt, fmtPct, fmtCompact, cls } from '../format';
import { useToast } from '../components/Toasts';
import { DirectionBadge, GradeBadge } from '../components/Badge';
import CandleChart, { type Overlay } from '../components/charts/CandleChart';
import Panel from '../components/charts/Panel';
import NewsFeed from '../components/NewsFeed';
import type { Candle, IndicatorSet, Fundamentals, Relation, Signal, Instrument, Snapshot, NewsItem } from '../types';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '1d'] as const;
type Tf = (typeof TIMEFRAMES)[number];

export default function Stock() {
  const { symbol = '' } = useParams();
  const upper = symbol.toUpperCase();
  const toast = useToast();

  const snapshots = useLive((s) => s.snapshots);
  const liveCandles = useLive((s) => s.candles);
  const [instrument, setInstrument] = useState<Instrument | null>(null);
  const [watch, setWatch] = useState(false);
  const [tf, setTf] = useState<Tf>('1m');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [ind, setInd] = useState<IndicatorSet | null>(null);
  const [fund, setFund] = useState<Fundamentals | null>(null);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [stockNews, setStockNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [ovSma20, setOvSma20] = useState(true);
  const [ovSma50, setOvSma50] = useState(true);
  const [ovEma, setOvEma] = useState(false);
  const [ovBb, setOvBb] = useState(false);

  const snap: Snapshot | undefined = snapshots[upper];

  useEffect(() => {
    setLoading(true);
    setInstrument(null);
    setCandles([]);
    setInd(null);
    setFund(null);
    setRelations([]);
    setSignals([]);
    setStockNews([]);
    setTf('1m');
    get<Instrument[]>('/api/instruments').then((list) => {
      const found = list.find((i) => i.symbol === upper);
      setInstrument(found ?? null);
      if (found) setLoading(false);
    }).catch(() => setLoading(false));
    get<string[]>('/api/watchlist').then((wl) => setWatch(wl.includes(upper))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upper]);

  useEffect(() => {
    if (!upper) return;
    get<{ candles: Candle[] }>(`/api/instruments/${upper}/candles?timeframe=${tf}&limit=280`)
      .then((r) => setCandles(r.candles))
      .catch(() => {});
    get<IndicatorSet>(`/api/instruments/${upper}/indicators?timeframe=${tf}&limit=280`)
      .then(setInd)
      .catch(() => {});
  }, [upper, tf]);

  useEffect(() => {
    get<Fundamentals>(`/api/instruments/${upper}/fundamentals`).then(setFund).catch(() => {});
    get<Relation[]>(`/api/instruments/${upper}/relations`).then(setRelations).catch(() => {});
    get<Signal[]>(`/api/instruments/${upper}/signals?limit=30`).then(setSignals).catch(() => {});
    get<NewsItem[]>(`/api/instruments/${upper}/news?limit=12`).then(setStockNews).catch(() => {});
  }, [upper]);

  // merge live candles
  useEffect(() => {
    const live = liveCandles[`${upper}:${tf}`];
    if (!live) return;
    setCandles((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      const c: Candle = { ts: live.ts, open: live.open, high: live.high, low: live.low, close: live.close, volume: live.volume };
      if (c.ts < last.ts) return prev;
      if (c.ts === last.ts) {
        const arr = [...prev];
        arr[arr.length - 1] = c;
        return arr;
      }
      return [...prev.slice(-279), c];
    });
  }, [liveCandles, upper, tf]);

  const overlays = useMemo<Overlay[]>(() => {
    const out: Overlay[] = [];
    if (!ind) return out;
    const mk = (values: (number | null)[], label: string, color: string, width = 1): Overlay => {
      const data = [];
      for (let i = 0; i < values.length; i++) {
        if (values[i] != null) data.push({ time: Math.floor(ind.ts[i] / 1000) as UTCTimestamp, value: values[i]! });
      }
      return { label, color, width, data };
    };
    if (ovSma20) out.push(mk(ind.sma20, 'SMA20', '#ffb020', 1));
    if (ovSma50) out.push(mk(ind.sma50, 'SMA50', '#9d7bff', 1));
    if (ovEma) {
      out.push(mk(ind.ema12, 'EMA12', '#3fd0ea', 1));
      out.push(mk(ind.ema26, 'EMA26', '#ff8fc7', 1));
    }
    if (ovBb) {
      out.push(mk(ind.bbUpper, 'BB-U', 'rgba(255,176,32,0.6)', 1));
      out.push(mk(ind.bbLower, 'BB-L', 'rgba(0,214,143,0.6)', 1));
    }
    return out;
  }, [ind, ovSma20, ovSma50, ovEma, ovBb]);

  const changePct = snap?.changePct;

  const toggleWatch = async () => {
    try {
      if (watch) await del(`/api/watchlist/${upper}`);
      else await post(`/api/watchlist/${upper}`, {});
      setWatch(!watch);
      toast(watch ? `Removed ${upper} from watchlist` : `Added ${upper} to watchlist`, 'ok');
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };

  if (loading) {
    return (
      <div>
        <div className="skeleton" style={{ height: 90, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 460, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 220 }} />
      </div>
    );
  }

  if (!instrument) {
    return <div className="empty">Instrument {upper} not found.</div>;
  }

  return (
    <div>
      <div className="stock-header">
        <div className="stock-title">
          <div className="sym">{instrument.symbol}</div>
          <div className="nm">{instrument.name} Â· {instrument.sector ?? 'â€”'}</div>
        </div>
        <div className="stock-price-block">
          <div className={cls('stock-price', (changePct ?? 0) >= 0 ? 'up' : 'down')}>{fmt(snap?.price ?? instrument.basePrice)}</div>
          <div className={cls('stock-change', (changePct ?? 0) >= 0 ? 'up' : 'down')}>
            {changePct != null ? `${fmtPct(changePct)}  (${fmt(snap?.change, 2)})` : 'â€”'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className={cls('btn', watch && 'primary')} onClick={toggleWatch}>
            {watch ? 'â˜… In Watchlist' : 'â˜† Add to Watchlist'}
          </button>
        </div>
      </div>

      <div className="ohlc-strip" style={{ marginBottom: 18 }}>
        <span>Open <b>{fmt(snap?.dayOpen)}</b></span>
        <span>High <b className="up">{fmt(snap?.dayHigh)}</b></span>
        <span>Low <b className="down">{fmt(snap?.dayLow)}</b></span>
        <span>Prev Close <b>{fmt(snap?.prevClose)}</b></span>
        <span>Volume <b>{fmtCompact(snap?.dayVolume)}</b></span>
        <span>Day Range <b>{fmt(snap?.dayLow)} â€“ {fmt(snap?.dayHigh)}</b></span>
      </div>

      <div className="grid-2-1" style={{ marginBottom: 16 }}>
        <div className="chart-box reveal">
          <div className="tf-tabs">
            {TIMEFRAMES.map((t) => (
              <button key={t} className={cls('tf-tab', tf === t && 'active')} onClick={() => setTf(t)}>{t}</button>
            ))}
          </div>
          <CandleChart candles={candles} overlays={overlays} height={430} />
          <div className="legend">
            <span><i style={{ background: 'var(--cyan)' }} /> overlay toggles</span>
            <span
              style={{ cursor: 'pointer', opacity: ovSma20 ? 1 : 0.4 }}
              onClick={() => setOvSma20(!ovSma20)}
            ><i style={{ background: '#ffb020' }} /> SMA20</span>
            <span
              style={{ cursor: 'pointer', opacity: ovSma50 ? 1 : 0.4 }}
              onClick={() => setOvSma50(!ovSma50)}
            ><i style={{ background: '#9d7bff' }} /> SMA50</span>
            <span
              style={{ cursor: 'pointer', opacity: ovEma ? 1 : 0.4 }}
              onClick={() => setOvEma(!ovEma)}
            ><i style={{ background: '#3fd0ea' }} /> EMA12/26</span>
            <span
              style={{ cursor: 'pointer', opacity: ovBb ? 1 : 0.4 }}
              onClick={() => setOvBb(!ovBb)}
            ><i style={{ background: 'rgba(255,176,32,0.7)' }} /> Bollinger</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="panel reveal reveal-1">
            <div className="panel-title"><h3>Indicators</h3><span className="hint">{tf} Â· last 280</span></div>
            {ind ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Panel label="RSI (14)" series={[{ label: 'RSI', values: ind.rsi, color: '#ffb020' }]} ts={ind.ts} min={0} max={100} bands={{ top: 70, bottom: 30 }} height={84} />
                <Panel
                  label="MACD (12,26,9)"
                  series={[
                    { label: 'MACD', values: ind.macd, color: '#3fd0ea' },
                    { label: 'SIG', values: ind.macdSignal, color: '#ff8fc7' },
                  ]}
                  ts={ind.ts}
                  height={84}
                />
                <Panel label="Stochastic (14,3,3)" series={[{ label: 'K', values: ind.stochK, color: '#9d7bff' }, { label: 'D', values: ind.stochD, color: '#ffb020' }]} ts={ind.ts} min={0} max={100} bands={{ top: 80, bottom: 20 }} height={84} />
              </div>
            ) : (
              <div className="empty">No indicator data yet.</div>
            )}
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="panel reveal">
          <div className="panel-title"><h3>Fundamentals</h3><span className="hint">company profile Â· fundamentals service</span></div>
          {fund ? (
            <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center' }}>
              <svg width="150" height="150" className="gauge" style={{ width: 150, height: 150 }}>
                <defs>
                  <linearGradient id="gauge-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#ff5c5c" />
                    <stop offset="50%" stopColor="#ffb020" />
                    <stop offset="100%" stopColor="#00d68f" />
                  </linearGradient>
                </defs>
                <circle className="ring-bg" cx="75" cy="75" r="62" fill="none" strokeWidth="12" />
                <circle
                  className="ring-fg"
                  cx="75" cy="75" r="62" fill="none" strokeWidth="12"
                  strokeDasharray={`${2 * Math.PI * 62}`}
                  strokeDashoffset={`${2 * Math.PI * 62 * (1 - Math.min(100, fund.investability_score) / 100)}`}
                />
                <text x="75" y="86" textAnchor="middle" fill="#e8eff6" style={{ font: "900 34px Archivo", letterSpacing: -1 }}>
                  {fund.investability_score.toFixed(0)}
                </text>
              </svg>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ marginBottom: 12 }}>
                  <span className="dim" style={{ fontSize: 12, marginRight: 8 }}>Investability Grade</span>
                  <GradeBadge grade={fund.investability_grade} />
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {fund.description ?? ''} Market cap {fmtCompact(fund.market_cap)}.
                  </div>
                </div>
                <div className="ratio-grid">
                  <div className="ratio"><div className="k">P/E</div><div className="v">{fund.pe?.toFixed(1)}</div></div>
                  <div className="ratio"><div className="k">P/B</div><div className="v">{fund.pb?.toFixed(1)}</div></div>
                  <div className="ratio"><div className="k">ROE</div><div className="v">{fund.roe?.toFixed(1)}%</div></div>
                  <div className="ratio"><div className="k">ROA</div><div className="v">{fund.roa?.toFixed(1)}%</div></div>
                  <div className="ratio"><div className="k">Rev Gr</div><div className="v">{fmtPct(fund.revenue_growth)}</div></div>
                  <div className="ratio"><div className="k">Margin</div><div className="v">{fund.net_margin?.toFixed(1)}%</div></div>
                  <div className="ratio"><div className="k">D/E</div><div className="v">{fund.debt_to_equity?.toFixed(2)}</div></div>
                  <div className="ratio"><div className="k">Div Yld</div><div className="v">{fund.dividend_yield?.toFixed(2)}%</div></div>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty">Fundamentals not generated yet.</div>
          )}
        </div>

        <div className="panel reveal reveal-1">
          <div className="panel-title"><h3>Company Relations</h3><span className="hint">suppliers Â· buyers Â· peers</span></div>
          {relations.length === 0 ? (
            <div className="empty">No relations.</div>
          ) : (
            <div style={{ maxHeight: 340, overflowY: 'auto' }}>
              {(['supplier', 'vendor', 'buyer', 'peer', 'subsidiary'] as const).map((t) => {
                const group = relations.filter((r) => r.relationType === t);
                if (!group.length) return null;
                return (
                  <div className="rel-group" key={t}>
                    <h4>{t}s</h4>
                    <div className="rel-chips">
                      {group.map((r) => (
                        <span key={r.id} className="rel-chip" title={r.note ?? ''}>
                          <b>{r.entitySymbol}</b>
                          <span className="w">w {r.weight}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="panel reveal">
          <div className="panel-title"><h3>Signal History â€” {upper}</h3><span className="hint">algorithm engine</span></div>
          <div style={{ maxHeight: 330, overflowY: 'auto' }}>
            <div className="feed">
              {signals.map((s) => (
                <div key={s.id} className="feed-item">
                  <div className="feed-main">
                    <div className="feed-head">
                      <DirectionBadge dir={s.direction} />
                    </div>
                    <div className="feed-reason">{s.reason}</div>
                    <div className="feed-meta">
                      <span className="strat">{s.strategy}</span>
                      <span className="px">@{fmt(s.price)}</span>
                      <span className="t">{new Date(s.ts).toLocaleString('en-IN', { hour12: false })}</span>
                    </div>
                  </div>
                </div>
              ))}
              {!signals.length && <div className="empty">No signals yet for {upper}.</div>}
            </div>
          </div>
        </div>

        <div className="panel reveal reveal-1">
          <div className="panel-title"><h3>News â€” {upper}</h3><span className="hint">market.news</span></div>
          <div style={{ maxHeight: 330, overflowY: 'auto' }}>
            <NewsFeed items={stockNews} limit={10} />
          </div>
        </div>
      </div>
    </div>
  );
}