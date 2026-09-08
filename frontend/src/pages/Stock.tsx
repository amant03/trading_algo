import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { UTCTimestamp } from 'lightweight-charts';
import { get, post, del } from '../api';
import { useLive } from '../ws';
import { fmt, fmtPct, fmtCompact, fmtMoney, cls } from '../format';
import { useToast } from '../components/Toasts';
import { DirectionBadge, GradeBadge } from '../components/Badge';
import CandleChart, { type Overlay } from '../components/charts/CandleChart';
import Panel from '../components/charts/Panel';
import NewsFeed from '../components/NewsFeed';
import type { Candle, IndicatorSet, Fundamentals, Relation, Signal, Instrument, Snapshot, NewsItem, StockAnalysis, ScreenResult } from '../types';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '1d'] as const;
type Tf = (typeof TIMEFRAMES)[number];

const RATING_COLOR: Record<string, string> = {
  'Strong Buy': 'var(--up)',
  Buy: 'var(--up)',
  Hold: 'var(--amber)',
  Sell: 'var(--down)',
  'Strong Sell': 'var(--down)',
};

function SparklineChart({ points, height = 180 }: { points: [number, number][]; height?: number }) {
  const w = 640;
  const h = height;
  const pad = 8;
  if (points.length < 2) return <div className="empty" style={{ height }}>No price history.</div>;
  const min = Math.min(...points.map((p) => p[1]));
  const max = Math.max(...points.map((p) => p[1]));
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1).toFixed(1)},${h - pad} L${x(0).toFixed(1)},${h - pad} Z`;
  const up = points[points.length - 1][1] >= points[0][1];
  const color = up ? 'var(--up)' : 'var(--down)';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-grad)" />
      <path d={path} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function VerdictBar({ mid, low, high, price }: { mid: number; low: number; high: number; price: number }) {
  const lo = Math.min(low, high, mid, price) - 1;
  const hi = Math.max(low, high, mid, price) + 1;
  const pos = (v: number) => `${(((v - lo) / (hi - lo)) * 100).toFixed(1)}%`;
  return (
    <div style={{ margin: '10px 0 2px' }}>
      <div style={{ position: 'relative', height: 10, borderRadius: 6, background: 'linear-gradient(90deg,#ff5c5c,#ffb020 40%,#00d68f 75%,#00d68f)' }}>
        <div style={{ position: 'absolute', left: pos(low), top: -2, height: 14, width: 2, background: 'rgba(232,239,246,0.7)' }} title={`Fair low ${fmt(low)}`} />
        <div style={{ position: 'absolute', left: pos(high), top: -2, height: 14, width: 2, background: 'rgba(232,239,246,0.7)' }} title={`Fair high ${fmt(high)}`} />
        <div
          style={{ position: 'absolute', left: `calc(${pos(price)} - 5px)`, top: -5, width: 10, height: 10, borderRadius: 10, background: '#fff', border: '2px solid #0b0f17' }}
          title={`Current ${fmt(price)}`}
        />
        <div style={{ position: 'absolute', left: pos(mid), top: -4, height: 18, width: 2, background: '#3fd0ea', opacity: 0.8 }} title={`Fair mid ${fmt(mid)}`} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, marginTop: 4, color: '#8b98ab' }}>
        <span>Fair low {fmt(low)}</span>
        <span>Fair mid {fmt(mid)}</span>
        <span>Fair high {fmt(high)}</span>
      </div>
    </div>
  );
}

function ScreenBox({ title, icon, name, result }: { title: string; icon: string; name: string; result?: ScreenResult }) {
  if (!result)
    return (
      <div className="panel" style={{ padding: 12 }}>
        <div className="dim" style={{ fontSize: 11, letterSpacing: '0.1em' }}>{icon} {title}</div>
        <div className="empty" style={{ marginTop: 8 }}>No data yet.</div>
      </div>
    );
  return (
    <div className="panel" style={{ padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span className="dim" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{icon} {title}</span>
        <GradeBadge grade={result.grade} />
      </div>
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>{result.thesis}</div>
      {result.flags.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {result.flags.map((f, i) => (
            <span key={i} className="rel-chip" style={{ fontSize: 10.5 }}>{f}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Stock() {
  const { symbol = '' } = useParams();
  const upper = symbol.toUpperCase();
  const toast = useToast();

  const snapshots = useLive((s) => s.snapshots);
  const liveCandles = useLive((s) => s.candles);
  const storeInstruments = useLive((s) => s.instruments);
  const fundamentals = useLive((s) => s.fundamentals);
  const sparklines = useLive((s) => s.sparklines);
  const [instrument, setInstrument] = useState<Instrument | null>(null);
  const [watch, setWatch] = useState(false);
  const [tf, setTf] = useState<Tf>('1m');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [ind, setInd] = useState<IndicatorSet | null>(null);
  const [fund, setFund] = useState<Fundamentals | null>(null);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [stockNews, setStockNews] = useState<NewsItem[]>([]);

  const [ovSma20, setOvSma20] = useState(true);
  const [ovSma50, setOvSma50] = useState(true);
  const [ovEma, setOvEma] = useState(false);
  const [ovBb, setOvBb] = useState(false);

  const snap: Snapshot | undefined = snapshots[upper];
  const analysis: StockAnalysis | undefined = fundamentals[upper];
  const spark: [number, number][] = sparklines[upper] ?? [];

  // resolve instrument from wherever we have it (API first, then store, then
  // analysis/snapshot) so the stock page renders even with no backend
  useEffect(() => {
    setInstrument((prev) => {
      if (prev?.symbol === upper) return prev;
      const fromStore = storeInstruments.find((i) => i.symbol === upper);
      if (fromStore) return fromStore;
      const a = useLive.getState().fundamentals[upper];
      if (a) return { id: 0, symbol: upper, name: a.name ?? upper, sector: a.sector ?? '', isin: '', exchange: 'NSE', marketCap: a.marketCap ?? 0, basePrice: a.price };
      const s = useLive.getState().snapshots[upper];
      if (s) return { id: 0, symbol: upper, name: upper, sector: 'NSE', isin: '', exchange: 'NSE', marketCap: 0, basePrice: s.price };
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upper, storeInstruments, snapshots, fundamentals]);

  useEffect(() => {
    setCandles([]);
    setInd(null);
    setSignals([]);
    setStockNews([]);
    setRelations([]);
    setWatch(false);
    setTf('1m');

    get<Instrument[]>('/api/instruments')
      .then((list) => {
        const found = list.find((i) => i.symbol === upper);
        if (found) setInstrument(found);
      })
      .catch(() => {});
    get<string[]>('/api/watchlist')
      .then((wl) => setWatch(wl.includes(upper)))
      .catch(() => {});
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

  if (!instrument && !snap && !analysis) {
    return <div className="empty">Instrument {upper} not found.</div>;
  }

  const name = instrument?.name ?? analysis?.name ?? upper;
  const sector = instrument?.sector ?? analysis?.sector ?? null;
  const hasChart = candles.length > 0;
  const showAnalysis = Boolean(analysis);
  const verdict = analysis?.verdict;

  return (
    <div>
      <div className="stock-header">
        <div className="stock-title">
          <div className="sym">{upper}</div>
          <div className="nm">{name} · {sector ?? '—'}</div>
        </div>
        <div className="stock-price-block">
          <div className={cls('stock-price', (changePct ?? 0) >= 0 ? 'up' : 'down')}>{fmt(snap?.price ?? analysis?.price ?? instrument?.basePrice)}</div>
          <div className={cls('stock-change', (changePct ?? 0) >= 0 ? 'up' : 'down')}>
            {changePct != null ? `${fmtPct(changePct)}  (${fmt(snap?.change, 2)})` : '—'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className={cls('btn', watch && 'primary')} onClick={toggleWatch}>
            {watch ? '★ In Watchlist' : '☆ Add to Watchlist'}
          </button>
        </div>
      </div>

      <div className="ohlc-strip" style={{ marginBottom: 18 }}>
        <span>Open <b>{fmt(snap?.dayOpen)}</b></span>
        <span>High <b className="up">{fmt(snap?.dayHigh)}</b></span>
        <span>Low <b className="down">{fmt(snap?.dayLow)}</b></span>
        <span>Prev Close <b>{fmt(snap?.prevClose)}</b></span>
        <span>Volume <b>{fmtCompact(snap?.dayVolume)}</b></span>
        <span>Day Range <b>{fmt(snap?.dayLow)} – {fmt(snap?.dayHigh)}</b></span>
      </div>

      <div className="grid-2-1" style={{ marginBottom: 16 }}>
        <div className="chart-box reveal">
          <div className="tf-tabs">
            {TIMEFRAMES.map((t) => (
              <button key={t} className={cls('tf-tab', tf === t && 'active')} onClick={() => setTf(t)}>{t}</button>
            ))}
          </div>
          {hasChart ? (
            <>
              <CandleChart candles={candles} overlays={overlays} height={430} />
              <div className="legend">
                <span><i style={{ background: 'var(--cyan)' }} /> overlay toggles</span>
                <span style={{ cursor: 'pointer', opacity: ovSma20 ? 1 : 0.4 }} onClick={() => setOvSma20(!ovSma20)}><i style={{ background: '#ffb020' }} /> SMA20</span>
                <span style={{ cursor: 'pointer', opacity: ovSma50 ? 1 : 0.4 }} onClick={() => setOvSma50(!ovSma50)}><i style={{ background: '#9d7bff' }} /> SMA50</span>
                <span style={{ cursor: 'pointer', opacity: ovEma ? 1 : 0.4 }} onClick={() => setOvEma(!ovEma)}><i style={{ background: '#3fd0ea' }} /> EMA12/26</span>
                <span style={{ cursor: 'pointer', opacity: ovBb ? 1 : 0.4 }} onClick={() => setOvBb(!ovBb)}><i style={{ background: 'rgba(255,176,32,0.7)' }} /> Bollinger</span>
              </div>
            </>
          ) : spark.length > 1 ? (
            <>
              <SparklineChart points={spark} height={330} />
              <div className="dim" style={{ fontSize: 11, textAlign: 'center', marginTop: 8 }}>
                Last {spark.length} daily closes (real NSE data) · live intraday candles appear with a connected backend
              </div>
            </>
          ) : (
            <div className="empty" style={{ height: 330 }}>No chart data — waiting for the next automation run to sync candles.</div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="panel reveal reveal-1">
            <div className="panel-title"><h3>Indicators</h3><span className="hint">{tf} · last 280</span></div>
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

      <div style={{ marginBottom: 16 }}>
        <div className="panel reveal">
          <div className="panel-title">
            <h3>Fundamentals &amp; Analyst Model</h3>
            {showAnalysis ? <span className="hint">Buffett · Lynch · Graham screens</span> : <span className="hint">fundamentals service</span>}
          </div>

          {showAnalysis && analysis ? (
            <div>
              <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
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
                    strokeDashoffset={`${2 * Math.PI * 62 * (1 - Math.min(100, verdict?.score ?? 0) / 100)}`}
                  />
                  <text x="75" y="86" textAnchor="middle" fill="#e8eff6" style={{ font: "900 34px Archivo", letterSpacing: -1 }}>
                    {verdict?.score}
                  </text>
                  <text x="75" y="104" textAnchor="middle" fill="#8b98ab" style={{ font: "700 10px 'IBM Plex Mono', monospace", letterSpacing: '0.1em' }}>
                    {verdict?.grade ?? '–'}
                  </text>
                </svg>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span className="mono dim" style={{ fontSize: 12 }}>Analyst Verdict</span>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: RATING_COLOR[verdict?.rating ?? 'Hold'] }}>{verdict?.rating}</span>
                    <GradeBadge grade={verdict?.grade ?? 'C'} />
                  </div>
                  <div className="muted" style={{ fontSize: 12, lineHeight: 1.55, marginBottom: 4 }}>{verdict?.summary}</div>
                  {verdict?.targetMean != null && (
                    <div className="dim" style={{ fontSize: 11, marginBottom: 2 }}>
                      Street target {fmt(verdict.targetMean)}{verdict.analysts ? ` from ${verdict.analysts} analysts` : ''} ·
                      Fair value {fmtMoney(verdict.fairValueMid)} · MoS {verdict.marginOfSafety > 0 ? '+' : ''}{verdict.marginOfSafety}%
                    </div>
                  )}
                  {verdict && <VerdictBar mid={verdict.fairValueMid} low={verdict.fairValueLow} high={verdict.fairValueHigh} price={analysis.price} />}
                </div>
              </div>

              <div className="ratio-grid" style={{ marginBottom: 14 }}>
                <div className="ratio"><div className="k">P/E</div><div className="v">{analysis.metrics.pe?.toFixed(1) ?? '—'}</div></div>
                <div className="ratio"><div className="k">P/B</div><div className="v">{analysis.metrics.pb?.toFixed(1) ?? '—'}</div></div>
                <div className="ratio"><div className="k">PEG</div><div className="v">{analysis.metrics.peg?.toFixed(2) ?? '—'}</div></div>
                <div className="ratio"><div className="k">ROE</div><div className="v">{analysis.metrics.roe?.toFixed(1) ?? '—'}%</div></div>
                <div className="ratio"><div className="k">ROA</div><div className="v">{analysis.metrics.roa?.toFixed(1) ?? '—'}%</div></div>
                <div className="ratio"><div className="k">Growth</div><div className="v">{analysis.metrics.growth?.toFixed(1) ?? '—'}%</div></div>
                <div className="ratio"><div className="k">Net Marg</div><div className="v">{analysis.metrics.netMargin?.toFixed(1) ?? '—'}%</div></div>
                <div className="ratio"><div className="k">D/E</div><div className="v">{analysis.metrics.debtToEquity?.toFixed(2) ?? '—'}</div></div>
                <div className="ratio"><div className="k">EPS</div><div className="v">{fmt(analysis.metrics.eps)}</div></div>
                <div className="ratio"><div className="k">BV/Sh</div><div className="v">{fmt(analysis.metrics.bookValue)}</div></div>
                <div className="ratio"><div className="k">Beta</div><div className="v">{analysis.metrics.beta?.toFixed(2) ?? '—'}</div></div>
                <div className="ratio"><div className="k">Div Yld</div><div className="v">{analysis.metrics.dividendYield?.toFixed(2) ?? '—'}%</div></div>
              </div>
              {analysis.metrics.promoterHolding != null && (
                <div className="dim" style={{ fontSize: 11, marginBottom: 14 }}>
                  Promoter holding {analysis.metrics.promoterHolding}% · FII holding {analysis.metrics.fiiHolding ?? 0}% · 52-wk {fmt(analysis.metrics.fiftyTwoWeekLow)}–{fmt(analysis.metrics.fiftyTwoWeekHigh)}
                </div>
              )}

              <div className="grid-3">
                <ScreenBox title="Warren Buffett" icon="🧊" name="buffett" result={analysis.screens.buffett} />
                <ScreenBox title="Peter Lynch" icon="⚡" name="lynch" result={analysis.screens.lynch} />
                <ScreenBox title="Benjamin Graham" icon="🛡" name="graham" result={analysis.screens.graham} />
              </div>
            </div>
          ) : fund ? (
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
            <div className="empty">Fundamentals not generated yet — will appear after the next automation run.</div>
          )}
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="panel reveal">
          <div className="panel-title"><h3>Signal History — {upper}</h3><span className="hint">algorithm engine</span></div>
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
          <div className="panel-title"><h3>News — {upper}</h3><span className="hint">market.news</span></div>
          <div style={{ maxHeight: 330, overflowY: 'auto' }}>
            <NewsFeed items={stockNews} limit={10} />
          </div>
        </div>
      </div>
    </div>
  );
}