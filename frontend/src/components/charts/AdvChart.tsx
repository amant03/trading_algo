// Google-Finance-style chart over real Yahoo OHLCV from /api/chart.
// 1D is an intraday area chart (session 09:15–15:30 IST). Longer ranges
// use candlesticks with SMA overlays.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryRow, NewsArticle } from '../../types';
import { sma, ema } from '../../indicators';
import { fmtCompact, fmt } from '../../format';
import { loadSymbolEvents, type ChartDiv, type ChartEarn } from '../../lib/chartEvents';
import { useLive } from '../../ws';

const RANGES = [
  { id: '1d', label: '1D' },
  { id: '5d', label: '5D' },
  { id: '1mo', label: '1M' },
  { id: '6mo', label: '6M' },
  { id: '1y', label: '1Y' },
  { id: '5y', label: '5Y' },
] as const;

type RangeId = (typeof RANGES)[number]['id'];

export const ADV_RANGES = RANGES;
export type AdvRangeId = RangeId;

const PAD_L = 8;
const PAD_R = 62;
const PAD_T = 28;
const VOL_H = 52;
const FOOTER = 22;
const SNAP_SEC = 5 * 86400;

interface ChartMark {
  i: number;
  kind: 'E' | 'D' | 'N';
  upcoming: boolean;
  beat: boolean | null;
  label: string;
  lines: string[];
  xNudge: number;
}

function surprisePct(actual: number | null, est: number | null): string | null {
  if (actual == null || est == null || est === 0) return null;
  const p = ((actual - est) / Math.abs(est)) * 100;
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
}

function beatOf(actual: number | null, est: number | null): boolean | null {
  if (actual == null || est == null) return null;
  return actual >= est;
}

function earnLines(e: ChartEarn): string[] {
  const epsSurp = surprisePct(e.eps, e.epsEst);
  const revSurp = surprisePct(e.revenue, e.revenueEst);
  const lines = [
    e.upcoming ? `Next earnings${e.period ? ` · ${e.period}` : ''}` : `Earnings${e.period ? ` · ${e.period}` : ''}`,
  ];
  if (e.eps != null || e.epsEst != null) {
    lines.push(`EPS ${e.eps != null ? fmt(e.eps) : '—'} vs ${e.epsEst != null ? fmt(e.epsEst) : '—'}${epsSurp ? ` · ${epsSurp}` : ''}`);
  }
  if (e.revenue != null || e.revenueEst != null) {
    lines.push(`Revenue ${e.revenue != null ? fmtCompact(e.revenue) : '—'} vs ${e.revenueEst != null ? fmtCompact(e.revenueEst) : '—'}${revSurp ? ` · ${revSurp}` : ''}`);
  }
  return lines;
}

function divLines(d: ChartDiv): string[] {
  return [
    d.upcoming ? 'Upcoming dividend' : 'Dividend',
    d.amount != null ? `₹${fmt(d.amount)} ex-date` : 'Ex-date',
  ];
}

function nearestBar(rows: HistoryRow[], t: number): number | null {
  if (!rows.length) return null;
  if (t < rows[0].t - SNAP_SEC || t > rows[rows.length - 1].t + SNAP_SEC) return null;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const d = Math.abs(rows[i].t - t);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function newsTime(article: NewsArticle): number | null {
  const ms = Date.parse(article.publishedAt);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

function istDate(epochSec: number): Date {
  return new Date(epochSec * 1000);
}

function fmtT(d: Date, range: RangeId): string {
  if (range === '1d' || range === '5d') {
    return d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
}

function linePath(xs: number[], ys: (number | null)[]): string {
  const pts: string[] = [];
  let started = false;
  for (let i = 0; i < ys.length; i++) {
    if (ys[i] == null) continue;
    pts.push(`${started ? 'L' : 'M'}${xs[i].toFixed(1)},${ys[i]!.toFixed(1)}`);
    started = true;
  }
  return pts.join(' ');
}

export default function AdvChart({
  symbol,
  rows,
  livePrice,
  range,
  onRangeChange,
}: {
  symbol: string;
  rows: HistoryRow[];
  livePrice?: number | null;
  range: RangeId;
  onRangeChange?: (r: RangeId) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(640);
  const [hoverI, setHoverI] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [events, setEvents] = useState<{ earnings: ChartEarn[]; dividends: ChartDiv[] } | null>(null);
  const news = useLive((s) => s.newsBySymbol[symbol]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => {
      const next = Math.max(280, Math.floor(el.clientWidth));
      setW((prev) => (Math.abs(prev - next) < 2 ? prev : next));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    loadSymbolEvents(symbol).then((ev) => {
      if (!cancelled) setEvents(ev);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const isDay = range === '1d';
  const closes = useMemo(() => rows.map((r) => r.c), [rows]);
  const sma20 = useMemo(() => sma(closes, 20), [closes]);
  const sma50 = useMemo(() => sma(closes, 50), [closes]);
  const sma200 = useMemo(() => sma(closes, 200), [closes]);
  const ema21 = useMemo(() => ema(closes, 21), [closes]);

  const h = isDay ? 360 : 400;
  const plotW = Math.max(1, w - PAD_L - PAD_R);
  const CHART_H = h - PAD_T - VOL_H - FOOTER;

  if (!rows.length) {
    return (
      <div className="advchart">
        <div className="advchart-head">
          <span className="advchart-title">{symbol} · {RANGES.find((r) => r.id === range)?.label}</span>
          <span className="advchart-sub">no data for this range yet</span>
        </div>
        {onRangeChange && (
          <div className="range-tabs" style={{ marginTop: 8 }}>
            {RANGES.map((r) => (
              <button key={r.id} className={range === r.id ? 'active' : ''} onClick={() => onRangeChange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const minP = Math.min(...rows.map((r) => (isDay ? r.c : r.l)));
  const maxP = Math.max(...rows.map((r) => (isDay ? r.c : r.h)));
  const prevClose = rows[0].o;
  const pad = (maxP - minP || 1) * 0.08;
  const low = Math.min(minP, isDay ? prevClose : minP) - pad;
  const high = Math.max(maxP, isDay ? prevClose : maxP) + pad;
  const maxV = Math.max(...rows.map((r) => r.v), 1);

  const x = (i: number): number => PAD_L + (rows.length <= 1 ? plotW / 2 : (i / (rows.length - 1)) * plotW);
  const y = (v: number): number => PAD_T + ((high - v) / (high - low || 1)) * CHART_H;
  const sv = (i: number): number => h - FOOTER - (rows[i].v / maxV) * VOL_H;
  const xs = rows.map((_, i) => x(i));

  const cw = Math.max(1, Math.min(8, (plotW / rows.length) * 0.62));
  const gridLines = 4;
  const priceTicks = Array.from({ length: gridLines + 1 }, (_, k) => low + ((high - low) / gridLines) * k);

  const last = rows[rows.length - 1];
  const first = rows[0];
  const ref = isDay ? prevClose : first.o;
  const end = livePrice && livePrice > 0 ? livePrice : last.c;
  const upG = end >= ref;

  const marks = (() => {
    const out: ChartMark[] = [];
    const used = new Set<string>();
    const push = (mark: ChartMark) => {
      const key = `${mark.kind}:${mark.i}`;
      if (used.has(key)) return;
      used.add(key);
      out.push(mark);
    };
    for (const e of events?.earnings ?? []) {
      const i = nearestBar(rows, e.t);
      if (i == null) continue;
      const beat = e.upcoming ? null : beatOf(e.eps, e.epsEst) ?? beatOf(e.revenue, e.revenueEst);
      push({ i, kind: 'E', upcoming: Boolean(e.upcoming), beat, label: 'E', lines: earnLines(e), xNudge: 0 });
    }
    for (const d of events?.dividends ?? []) {
      const i = nearestBar(rows, d.t);
      if (i == null) continue;
      push({ i, kind: 'D', upcoming: Boolean(d.upcoming), beat: null, label: 'D', lines: divLines(d), xNudge: 0 });
    }
    const newsByBar = new Map<number, NewsArticle[]>();
    for (const article of news ?? []) {
      const t = newsTime(article);
      if (t == null) continue;
      const i = nearestBar(rows, t);
      if (i == null) continue;
      const list = newsByBar.get(i) ?? [];
      list.push(article);
      newsByBar.set(i, list);
    }
    for (const [i, articles] of newsByBar) {
      const titles = articles.slice(0, 3).map((a) => a.title);
      const extra = articles.length > 3 ? [`+${articles.length - 3} more`] : [];
      push({
        i,
        kind: 'N',
        upcoming: false,
        beat: null,
        label: String(articles.length),
        lines: [`News · ${articles.length}`, ...titles, ...extra],
        xNudge: used.has(`E:${i}`) ? 16 : 0,
      });
    }
    return out;
  })();

  const hrow = hoverI != null ? rows[hoverI] : null;
  const hoverMarks = hoverI == null ? [] : marks.filter((m) => m.i === hoverI);
  const lastSma20 = sma20[sma20.length - 1];
  const lastSma50 = sma50[sma50.length - 1];
  const lastSma200 = sma200[sma200.length - 1];
  const lastEma21 = ema21[ema21.length - 1];

  const tickIdx = (n: number): number => Math.max(0, Math.min(rows.length - 1, Math.round((rows.length - 1) * (n / gridLines))));
  const timeTicks = Array.from({ length: gridLines + 1 }, (_, k) => tickIdx(k));

  const lineYs = closes.map((c) => y(c));
  const areaD = `${linePath(xs, lineYs)} L${xs[xs.length - 1].toFixed(1)},${(PAD_T + CHART_H).toFixed(1)} L${xs[0].toFixed(1)},${(PAD_T + CHART_H).toFixed(1)} Z`;
  const stroke = upG ? 'var(--up)' : 'var(--down)';
  const fillId = `dayfill-${symbol}-${range}`;

  return (
    <div className="advchart">
      <div className="advchart-head">
        <div>
          <div className="advchart-title">{symbol} · {RANGES.find((r) => r.id === range)?.label} · NSE</div>
          <div className="advchart-sub">
            {isDay ? 'Intraday · Asia/Kolkata' : 'OHLC · real NSE data'}{' '}
            <span className={upG ? 'up' : 'down'}>
              {(end - ref) >= 0 ? '+' : ''}{fmt(end - ref)} ({ref > 0 ? `${end >= ref ? '+' : ''}${(((end - ref) / ref) * 100).toFixed(2)}` : '0'}%)
            </span>
          </div>
        </div>
        <div className="range-tabs">
          {onRangeChange
            ? RANGES.map((r) => (
                <button key={r.id} className={range === r.id ? 'active' : ''} onClick={() => onRangeChange(r.id)}>
                  {r.label}
                </button>
              ))
            : (
              <span className="dim" style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}>
                {RANGES.find((r) => r.id === range)?.label} · NSE
              </span>
            )}
        </div>
      </div>

      <div className="advchart-body" ref={wrapRef} onMouseLeave={() => { setHoverI(null); setHoverX(null); }}>
        <svg
          width="100%"
          height={h}
          viewBox={`0 0 ${Math.max(w, 1)} ${h}`}
          preserveAspectRatio="none"
          style={{ width: '100%', height: h, display: 'block' }}
          onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          if (rect.width <= 0 || rows.length <= 0) return;
          // Map CSS pixels into viewBox space so the crosshair matches the
          // candle under the cursor even when the SVG is stretched (preserveAspectRatio=none).
          const viewX = ((e.clientX - rect.left) / rect.width) * Math.max(w, 1);
          const t = (viewX - PAD_L) / plotW;
          const i = Math.round(t * Math.max(rows.length - 1, 1));
          setHoverI(i >= 0 && i < rows.length ? i : null);
          setHoverX(e.clientX - rect.left);
        }}>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={upG ? '#00d68f' : '#ff5c5c'} stopOpacity="0.28" />
              <stop offset="100%" stopColor={upG ? '#00d68f' : '#ff5c5c'} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {priceTicks.map((p, k) => (
            <g key={k}>
              <line x1={PAD_L} y1={y(p)} x2={w - PAD_R} y2={y(p)} stroke="rgba(232,239,246,0.05)" strokeWidth="1" />
              <text x={w - PAD_R + 6} y={y(p) + 3} fill="#5c6a7d" style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}>
                {fmt(p)}
              </text>
            </g>
          ))}
          {timeTicks.map((ti, k) => (
            <text key={k} x={x(ti)} y={h - 6} fill="#5c6a7d" textAnchor="middle" style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}>
              {fmtT(istDate(rows[ti].t), range)}
            </text>
          ))}

          {rows.map((r, i) => (
            <rect key={`v${i}`} x={x(i) - cw / 2} y={sv(i)} width={cw} height={h - FOOTER - sv(i)} fill={r.c >= r.o ? 'rgba(0,214,143,0.22)' : 'rgba(255,92,92,0.22)'} />
          ))}

          {isDay && prevClose > low && prevClose < high && (
            <g>
              <line x1={PAD_L} x2={w - PAD_R} y1={y(prevClose)} y2={y(prevClose)} stroke="rgba(232,239,246,0.35)" strokeWidth="1" strokeDasharray="4 4" />
            </g>
          )}

          {isDay ? (
            <g>
              <path d={areaD} fill={`url(#${fillId})`} />
              <path d={linePath(xs, lineYs)} fill="none" stroke={stroke} strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ) : (
            <>
              {[
                { data: sma20, color: '#ffb020', label: 'SMA20' },
                { data: sma50, color: '#9d7bff', label: 'SMA50' },
                { data: sma200, color: '#3fd0ea', label: 'SMA200' },
                { data: ema21, color: '#ff8fc7', label: 'EMA21' },
              ]
                .filter((s) => s.data.some((v) => v != null))
                .map((s) => {
                  const d = linePath(xs, s.data.map((v) => (v == null ? null : y(v))));
                  if (!d) return null;
                  return <path key={s.label} d={d} fill="none" stroke={s.color} strokeWidth="1.1" strokeDasharray={s.label === 'EMA21' ? '3 3' : undefined} opacity="0.85" />;
                })}
              {rows.map((r, i) => {
                const up = r.c >= r.o;
                const cl = up ? 'var(--up)' : 'var(--down)';
                return (
                  <g key={i}>
                    {r.h !== r.l && <line x1={x(i)} x2={x(i)} y1={y(r.h)} y2={y(r.l)} stroke={cl} strokeWidth="1" />}
                    <rect x={x(i) - cw / 2} y={Math.min(y(r.o), y(r.c))} width={cw} height={Math.max(1, Math.abs(y(r.o) - y(r.c)))} fill={cl} />
                  </g>
                );
              })}
            </>
          )}

          {livePrice != null && livePrice > low && livePrice < high && (
            <g>
              <line x1={PAD_L} x2={w - PAD_R} y1={y(livePrice)} y2={y(livePrice)} stroke="var(--amber)" strokeWidth="1" strokeDasharray="5 4" opacity="0.9" />
              <rect x={w - PAD_R + 2} y={y(livePrice) - 9} width="56" height="18" rx="4" fill="rgba(255,176,32,0.18)" stroke="rgba(255,176,32,0.5)" />
              <text x={w - PAD_R + 30} y={y(livePrice) + 3.5} textAnchor="middle" fill="#ffb020" style={{ fontSize: 10.5, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
                {fmt(livePrice)}
              </text>
            </g>
          )}

          {marks.map((m, n) => {
            const cx = x(m.i) + m.xNudge;
            const onPrice = m.kind === 'D';
            const cy = onPrice
              ? Math.max(PAD_T + 10, y(rows[m.i].h) - 12)
              : h - FOOTER - VOL_H + 10;
            const fill = m.kind === 'D' ? '#ffb020' : m.kind === 'N' ? '#b388ff' : m.upcoming ? '#0e1c22' : m.beat === false ? '#ffb020' : '#00d68f';
            const ink = m.upcoming && m.kind === 'E' ? '#3fd0ea' : '#0b0f17';
            return (
              <g key={`${m.kind}-${m.i}-${n}`}>
                <circle cx={cx} cy={cy} r="8" fill={fill} stroke={m.upcoming ? '#3fd0ea' : 'rgba(0,0,0,0.35)'} strokeWidth="1" />
                <text x={cx} y={cy + 3.2} textAnchor="middle" fill={ink} style={{ fontSize: m.kind === 'N' ? 8 : 9, fontWeight: 800, fontFamily: "'IBM Plex Mono', monospace" }}>
                  {m.kind === 'N' ? 'N' : m.label}
                </text>
              </g>
            );
          })}

          {hrow && hoverI != null && (
            <g>
              <line x1={x(hoverI)} x2={x(hoverI)} y1={PAD_T} y2={h - FOOTER} stroke="rgba(232,239,246,0.55)" strokeWidth="1" />
              <circle cx={x(hoverI)} cy={y(hrow.c)} r="3.5" fill={stroke} stroke="#0b0f17" strokeWidth="1" />
            </g>
          )}
        </svg>
        {hrow && hoverX != null && (
          <div
            className="advchart-tip"
            style={{ left: Math.min(Math.max(hoverX, 96), Math.max(w - 96, 96)) }}
          >
            <div className="advchart-tip-time">{fmtT(istDate(hrow.t), range)}</div>
            {isDay ? (
              <div className="advchart-tip-price">{fmt(hrow.c)}</div>
            ) : (
              <div className="advchart-tip-ohlc">
                <span>O <b>{fmt(hrow.o)}</b></span>
                <span>H <b className="up">{fmt(hrow.h)}</b></span>
                <span>L <b className="down">{fmt(hrow.l)}</b></span>
                <span>C <b>{fmt(hrow.c)}</b></span>
              </div>
            )}
            <div className="advchart-tip-vol">
              Vol <b>{hrow.v.toLocaleString('en-IN')}</b>
              <span className="dim">({fmtCompact(hrow.v)})</span>
            </div>
            {hoverMarks.map((m, n) => (
              <div key={n} className="advchart-tip-event">
                {m.lines.map((line, li) => (
                  <div key={li} className={li === 0 ? 'advchart-tip-event-title' : ''}>{line}</div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="advchart-footer">
        <span>O {fmt(hrow?.o ?? last.o)}</span>
        <span>H <span className="up">{fmt(hrow?.h ?? last.h)}</span></span>
        <span>L <span className="down">{fmt(hrow?.l ?? last.l)}</span></span>
        <span>C {fmt(hrow?.c ?? last.c)}</span>
        <span>Vol {fmtCompact(hrow?.v ?? last.v)}</span>
        <span className="advchart-legend">
          <i className="mk e" /> E earnings
          <i className="mk d" /> D dividend
          <i className="mk n" /> N news
        </span>
        {!isDay && (
          <span className="advchart-foot-stats">
            {[['SMA20', lastSma20], ['SMA50', lastSma50], ['SMA200', lastSma200], ['EMA21', lastEma21]]
              .filter(([, v]) => v != null)
              .map(([lab, v]) => `${lab} ${fmt(v as number)}`)
              .join(' · ')}
          </span>
        )}
      </div>
    </div>
  );
}
