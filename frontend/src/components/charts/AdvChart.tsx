// Google-Finance-style chart over real Yahoo OHLCV from /api/chart.
// 1D is an intraday area chart (session 09:15–15:30 IST). Longer ranges
// use candlesticks with SMA overlays.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryRow } from '../../types';
import { sma, ema } from '../../indicators';
import { fmtCompact, fmt } from '../../format';

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
  const [w, setW] = useState(760);
  const [hoverI, setHoverI] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(360, el.clientWidth - 2)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
      <div className="advchart" ref={wrapRef}>
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

  const hrow = hoverI != null ? rows[hoverI] : null;
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
    <div className="advchart" ref={wrapRef}>
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

      <div className="advchart-body" onMouseLeave={() => setHoverI(null)}>
        <svg width={w} height={h} onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left - PAD_L) / plotW) * (rows.length - 1);
          setHoverI(px >= 0 && px <= rows.length - 1 ? Math.round(px) : null);
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

          {hrow && hoverI != null && (
            <g>
              <line x1={x(hoverI)} x2={x(hoverI)} y1={PAD_T} y2={h - FOOTER} stroke="rgba(232,239,246,0.35)" strokeWidth="1" />
              <circle cx={x(hoverI)} cy={y(hrow.c)} r="3.5" fill={stroke} />
            </g>
          )}
        </svg>
      </div>

      <div className="advchart-footer">
        <span>O {fmt(hrow?.o ?? last.o)}</span>
        <span>H <span className="up">{fmt(hrow?.h ?? last.h)}</span></span>
        <span>L <span className="down">{fmt(hrow?.l ?? last.l)}</span></span>
        <span>C {fmt(hrow?.c ?? last.c)}</span>
        <span>Vol {fmtCompact(hrow?.v ?? last.v)}</span>
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
