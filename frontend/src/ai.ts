// Offline AI-analyst engine.
//
// Pure client-side reasoning over real data (live relay quotes, the OHLCV
// history from /api/chart, fundamentals/opinion/management from CI, news).
// No API keys, no network LLM — deterministic, reproducible and free.
//
// Exposed:
//   - computeTech(rows): indicators + pattern/breakout scan over recent candles
//   - patternList(ctx):  "hidden signals" findings for the AI panel
//   - answer(query, ctx): natural-language Q&A over a stock's data

import type { HistoryRow, StockAnalysis, Snapshot, NewsArticle, PeerInfo } from './types';
import { sma, ema, rsi, macd, bollinger, atr, stochastic, supertrend } from './indicators';
import { fmt, fmtPct } from './format';

export type Stance = 'BUY' | 'HOLD' | 'SELL' | 'UNKNOWN';

export interface TechSignal {
  label: string;
  detail: string;
  bias: 'bullish' | 'bearish' | 'neutral';
}

export interface TradeVerdict {
  stance: Stance;
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'UNKNOWN';
  conviction: number;
  why: string[];
}

export interface TechComputation {
  closes: number[];
  vols: number[];
  opens: number[];
  highs: number[];
  lows: number[];
  price: number;
  prevClose: number;
  changePct: number;
  r14: number | null;
  macdLine: number | null;
  macdSig: number | null;
  macdCrossUp: boolean;
  stK: number | null;
  stD: number | null;
  atrVal: number | null;
  s20: number | null;
  s50: number | null;
  s200: number | null;
  bbPctB: number | null;
  recentHigh: number;
  recentLow: number;
  volRatio: number;
  gapPct: number;
  signals: TechSignal[];
  verdict: TradeVerdict;
}

export interface StockContext {
  symbol: string;
  name: string | null;
  snap: Snapshot | null;
  analysis: StockAnalysis | null;
  news: NewsArticle[];
  rows: HistoryRow[];
  peers: PeerInfo[];
  tech: TechComputation | null;
  stocks: Record<string, StockAnalysis>;
  snapshots: Record<string, Snapshot>;
}

const lastValid = (s: (number | null)[]): number | null => {
  for (let i = s.length - 1; i >= 0; i--) if (s[i] != null) return s[i]!;
  return null;
};

export function computeTech(rows: HistoryRow[]): TechComputation | null {
  if (!rows || rows.length < 15) return null;
  const closes = rows.map((r) => r.c);
  const vols = rows.map((r) => r.v);
  const opens = rows.map((r) => r.o);
  const highs = rows.map((r) => r.h);
  const lows = rows.map((r) => r.l);
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const price = last.c;
  const prevClose = prev.c;
  const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
  const gapPct = prevClose > 0 ? ((last.o - prevClose) / prevClose) * 100 : 0;

  const r14 = lastValid(rsi(closes, 14));
  const macdR = macd(closes, 12, 26, 9);
  const macdLine = lastValid(macdR.line);
  const macdSig = lastValid(macdR.signal);
  const macdPrev = macdR.line[macdR.line.length - 2];
  const macdSigPrev = macdR.signal[macdR.signal.length - 2];
  const macdCrossUp = macdLine != null && macdSig != null && macdPrev != null && macdSigPrev != null && macdLine > macdSig && macdPrev <= macdSigPrev;

  const st = stochastic(rows, 14, 3, 3);
  const stK = last(st.k);
  const stD = last(st.d);

  const a = atr(rows, 14);
  const atrVal = lastValid(a);

  const s20 = lastValid(sma(closes, 20));
  const s50 = lastValid(sma(closes, 50));
  const s200 = lastValid(sma(closes, 200));

  const bb = bollinger(closes, 20, 2);
  const bbU = lastValid(bb.upper);
  const bbL = lastValid(bb.lower);
  const bbPctB = bbU != null && bbL != null ? ((price - bbL) / Math.max(bbU - bbL, 0.0001)) * 100 : null;

  const recent = closes.slice(-20);
  const recentHigh = Math.max(...recent);
  const recentLow = Math.min(...recent);
  const avgVol = vols.slice(-20).reduce((a2, v) => a2 + v, 0) / Math.min(20, vols.length);
  const volRatio = avgVol > 0 ? last.v / avgVol : 1;

  const signals: TechSignal[] = [];
  if (price >= recentHigh * 0.995 && s20 != null && price > s20) {
    signals.push({ label: 'Breakout', detail: `Price ${fmt(price)} is at a ${recent.length}-period high (${fmt(recentHigh)}) and above SMA20 ${fmt(s20)} — classic breakout zone.`, bias: 'bullish' });
  }
  if (s50 != null && s200 != null) {
    if (price > s50 && s50 > s200) signals.push({ label: 'Trend', detail: `Price above SMA50 (${fmt(s50)}) and SMA50 above SMA200 (${fmt(s200)}) — bullish structure.`, bias: 'bullish' });
    else if (price < s50 && s50 < s200) signals.push({ label: 'Trend', detail: `Price below SMA50 (${fmt(s50)}) and SMA50 below SMA200 (${fmt(s200)}) — bearish structure.`, bias: 'bearish' });
  }
  if (r14 != null) {
    if (r14 >= 70) signals.push({ label: 'RSI', detail: `RSI ${r14.toFixed(1)} — overbought; momentum stretched, watch for a pullback.`, bias: 'bearish' });
    else if (r14 <= 30) signals.push({ label: 'RSI', detail: `RSI ${r14.toFixed(1)} — oversold; a bounce risk/reward is improving.`, bias: 'bullish' });
    else signals.push({ label: 'RSI', detail: `RSI ${r14.toFixed(1)} — neutral momentum.`, bias: 'neutral' });
  }
  if (macdLine != null && macdSig != null) {
    signals.push({
      label: 'MACD',
      detail: `MACD ${macdLine.toFixed(2)} ${macdCrossUp ? 'just crossed above' : macdLine > macdSig ? 'is above' : 'is below'} signal ${macdSig.toFixed(2)}${macdCrossUp ? ' — bullish cross.' : macdLine > macdSig ? ' — bullish alignment.' : ' — bearish alignment.'}`,
      bias: macdCrossUp || macdLine > macdSig ? 'bullish' : 'bearish',
    });
  }
  if (bbPctB != null) {
    if (bbPctB > 105) signals.push({ label: 'Bands', detail: `Price ${fmtPct(bbPctB)} above the upper Bollinger band — stretched, mean-reversion candidate.`, bias: 'bearish' });
    else if (bbPctB < -5) signals.push({ label: 'Bands', detail: `Price ${fmtPct(bbPctB)} below the lower Bollinger band — stretched low, bounce candidate.`, bias: 'bullish' });
  }
  if (volRatio > 1.5) signals.push({ label: 'Volume', detail: `Last bar at ${volRatio.toFixed(1)}× the 20-bar average — heavy participation (breakout fuel or climax).`, bias: stK != null && stK > stD ? 'bullish' : 'bearish' });
  if (Math.abs(gapPct) > 0.8) signals.push({ label: 'Gap', detail: `${gapPct >= 0 ? 'Opening' : 'Gapping down'} ${fmtPct(Math.abs(gapPct))} from the prior close.`, bias: gapPct >= 0 ? 'bullish' : 'bearish' });
  if (stK != null && stD != null) {
    signals.push({
      label: 'Stochastic',
      detail: `Stoch %K ${stK.toFixed(0)} vs %D ${stD.toFixed(0)} — ${stK > stD ? 'rising momentum' : stK < stD ? 'fading momentum' : 'flat'}.`,
      bias: stK >= stD ? 'bullish' : 'bearish',
    });
  }

  const upPoints = signals.filter((s) => s.bias === 'bullish').length;
  const downPoints = signals.filter((s) => s.bias === 'bearish').length;
  const trend: TradeVerdict['trend'] =
    s50 != null && s200 != null
      ? price > s50 && s50 > s200
        ? 'UPTREND'
        : price < s50 && s50 < s200
          ? 'DOWNTREND'
          : 'SIDEWAYS'
      : 'UNKNOWN';
  let stance: Stance = 'HOLD';
  const oversold = r14 != null && r14 <= 30;
  const overbought = r14 != null && r14 >= 70;
  if (trend === 'UPTREND' && (upPoints > downPoints || oversold) && !overbought) stance = 'BUY';
  else if (trend === 'DOWNTREND' && (downPoints > upPoints) && !oversold) stance = 'SELL';
  else if (upPoints >= downPoints + 2) stance = 'BUY';
  else if (downPoints >= upPoints + 2) stance = 'SELL';
  const conviction = Math.round(Math.max(5, Math.min(95, 45 + (upPoints - downPoints) * 8)));

  const verdict: TradeVerdict = { stance, trend, conviction, why: signals.map((s) => `${s.label}: ${s.detail}`) };

  return { closes, vols, opens, highs, lows, price, prevClose, changePct, r14, macdLine, macdSig, macdCrossUp, stK, stD, atrVal, s20, s50, s200, bbPctB, recentHigh, recentLow, volRatio, gapPct, signals, verdict };
}

function stanceColor(s: Stance): string {
  return s === 'BUY' ? 'var(--up)' : s === 'SELL' ? 'var(--down)' : s === 'HOLD' ? 'var(--amber)' : 'var(--muted)';
}

/**
 * "Hidden signals" — deterministic findings that a reader would miss without
 * scanning every report/indicator manually.
 */
export function patternList(ctx: StockContext): TechSignal[] {
  const out: TechSignal[] = [];
  const t = ctx.tech;
  const a = ctx.analysis;
  if (t) out.push(...t.signals);

  const m = a?.metrics;
  if (m) {
    if (m.pe != null && m.growth != null && m.growth > 0) {
      const peg = m.pe / (m.growth * 100);
      out.push({ label: 'Valuation', detail: `P/E ${m.pe.toFixed(1)} on earnings growth ${m.growth.toFixed(1)}% → PEG ≈ ${peg.toFixed(2)} (${peg < 1 ? 'underpriced vs growth' : peg < 2 ? 'fairly priced for growth' : 'expensive for its growth'}).`, bias: peg < 1 ? 'bullish' : peg < 2 ? 'neutral' : 'bearish' });
    }
    if (m.debtToEquity != null) {
      out.push({ label: 'Leverage', detail: `D/E ${m.debtToEquity.toFixed(2)} — ${m.debtToEquity <= 0.5 ? 'clean balance sheet, plenty of capacity' : m.debtToEquity <= 1 ? 'moderate leverage' : 'elevated leverage, watch interest costs'}.`, bias: m.debtToEquity <= 0.5 ? 'bullish' : m.debtToEquity <= 1 ? 'neutral' : 'bearish' });
    }
    if (m.fiiHolding != null && m.promoterHolding != null) {
      out.push({ label: 'Ownership', detail: `Promoter ${m.promoterHolding.toFixed(0)}% / FII ${m.fiiHolding.toFixed(0)}% — ${m.fiiHolding >= 20 ? 'strong institutional vote of confidence' : 'lighter institutional ownership'}.`, bias: m.fiiHolding >= 20 ? 'bullish' : 'neutral' });
    }
    if (m.fiftyTwoWeekHigh != null && a.price > 0) {
      const dist = ((m.fiftyTwoWeekHigh - a.price) / m.fiftyTwoWeekHigh) * 100;
      out.push({ label: '52-week zone', detail: `${dist <= 2 ? 'Trading within 2% of its 52-week high — momentum names here tend to continue or reverse hard; watch volume.' : `Trading ${fmtPct(dist)} below the 52-week high (${fmt(m.fiftyTwoWeekHigh)}) — room to run if the trend resumes.`}`, bias: dist <= 2 ? 'neutral' : 'bullish' });
    }
    if (m.roe != null && m.netMargin != null) {
      out.push({ label: 'Moats', detail: `ROE ${m.roe.toFixed(1)}% + net margin ${m.netMargin.toFixed(1)}% ${m.roe >= 15 && m.netMargin >= 10 ? '— classic economic-moat profile' : '— mid-quality economics'}.`, bias: m.roe >= 15 && m.netMargin >= 10 ? 'bullish' : 'neutral' });
    }
  }

  const mgmt = a?.management;
  if (mgmt) out.push({ label: 'Governance', detail: `Management score ${mgmt.score}/100 (${mgmt.grade})${mgmt.cases.length ? ` — ${mgmt.cases.length} legal/${mgmt.cases.map((c) => c.kind).join(', ')} flag(s) in public news` : ' — no legal flags surfaced'}.`, bias: mgmt.score >= 70 && !mgmt.cases.length ? 'bullish' : mgmt.score < 45 || mgmt.cases.length > 0 ? 'bearish' : 'neutral' });

  const snap = ctx.snap;
  if (snap && a) {
    out.push({ label: 'Positioning', detail: `Live price ${fmt(snap.price)} vs yesterday close ${fmt(snap.prevClose)} (${fmtPct(snap.changePct)}) intraday. Fair value band ${fmt(a.verdict.fairValueLow)}–${fmt(a.verdict.fairValueHigh)}.`, bias: snap.changePct >= 0 ? 'bullish' : 'bearish' });
  }

  if (ctx.news.length) {
    const bull = ctx.news.filter((n) => n.title.toLowerCase().includes('profit') || n.title.toLowerCase().includes('growth') || n.title.toLowerCase().includes('wins') || n.title.toLowerCase().includes('approval')).length;
    const bear = ctx.news.filter((n) => n.title.toLowerCase().includes('probe') || n.title.toLowerCase().includes('loss') || n.title.toLowerCase().includes('penalty') || n.title.toLowerCase().includes('slump')).length;
    if (bull + bear > 0) out.push({ label: 'News', detail: `${bull} positive / ${bear} negative headline(s) in the current window — ${bull > bear ? 'net-positive flow' : bull < bear ? 'net-negative flow' : 'balanced flow'}.`, bias: bull > bear ? 'bullish' : bull < bear ? 'bearish' : 'neutral' });
  }

  return out;
}

// ---- Q&A router ---------------------------------------------------------

export interface AiAnswer {
  text: string;
  tone: Stance;
  bullets?: string[];
}

const has = (q: string, words: string[]) => words.some((w) => q.includes(w));

function shortStance(s: string): string {
  const v = s.toLowerCase();
  if (v.includes('strong buy') || v.includes('strong sell')) return v.split(' ')[1] === 'sell' ? 'SELL' : 'BUY';
  if (v.includes('buy')) return 'BUY';
  if (v.includes('sell')) return 'SELL';
  return 'HOLD';
}

function verdictAnswer(ctx: StockContext): AiAnswer {
  const a = ctx.analysis;
  const t = ctx.tech;
  if (!a) return { text: `Not enough data on ${ctx.symbol} for a verdict yet — fundamentals build with each automation run.`, tone: 'HOLD' };
  const o = a.opinion;
  const lt = o?.stance ?? shortStance(a.verdict.rating);
  const ltConv = o?.conviction ?? a.verdict.score;
  const st = t?.verdict.stance ?? 'HOLD';
  const stConv = t?.verdict.conviction ?? 50;
  const m = a.metrics;
  const moS = a.verdict.marginOfSafety;
  const fair = a.verdict.fairValueMid;
  const lines = [
    `Fresh look at ${ctx.symbol} (${ctx.name ?? ''}):`,
    `Long-term = ${lt} (${ltConv}% conviction). Fair value ≈ ${fmt(fair)} vs price ${fmt(a.price)} → ${moS >= 0 ? '+' : ''}${moS}% margin of safety.`,
    `Short-term technical = ${st} (${stConv}% conviction) — ${t ? `${t.verdict.trend} on the chart`.toLowerCase() : 'not enough candles yet'}.`,
  ];
  if (m) {
    lines.push(`Key metrics: P/E ${m.pe?.toFixed(1) ?? '—'}, ROE ${m.roe?.toFixed(1) ?? '—'}%, net margin ${m.netMargin?.toFixed(1) ?? '—'}%, D/E ${m.debtToEquity?.toFixed(2) ?? '—'}, growth ${m.growth?.toFixed(1) ?? '—'}%.`);
  }
  if (o?.risks.length) lines.push(`Main risks: ${o.risks.slice(0, 3).join('; ')}.`);
  const stance: Stance = lt === 'SELL' || st === 'SELL' ? 'SELL' : lt === 'BUY' || st === 'BUY' ? 'BUY' : 'HOLD';
  return { text: lines.join('\n'), tone: stance };
}

function valuationAnswer(ctx: StockContext): AiAnswer {
  const a = ctx.analysis;
  if (!a) return { text: `Valuation data for ${ctx.symbol} pending (builds in the automation run).`, tone: 'HOLD' };
  const v = a.verdict;
  const m = a.metrics;
  const moS = v.marginOfSafety;
  const underw = moS > 0 ? `${moS}% below our fair value` : `${-moS}% above our fair value`;
  const lines = [
    `Fair-value view on ${ctx.symbol}:`,
    `Fair band ${fmt(v.fairValueLow)} – ${fmt(v.fairValueMid)} – ${fmt(v.fairValueHigh)} (low–mid–high). Market price ${fmt(a.price)} is ${underw}.`,
    `Composite score ${v.score}/100 ("${v.rating}").`,
  ];
  if (m) {
    const parts = [`P/E ${m.pe?.toFixed(1) ?? '—'}`, `P/B ${m.pb?.toFixed(1) ?? '—'}`, `P/S ${m.ps?.toFixed(1) ?? '—'}`, `PEG ${m.peg?.toFixed(2) ?? '—'}`, `dividend yield ${m.dividendYield?.toFixed(2) ?? '—'}%`];
    lines.push(`Multiples: ${parts.join(', ')}.`);
    if (m.avgVolume) lines.push(`Average volume ≈ ${fmt(m.avgVolume)} shares.`);
  }
  const tone: Stance = moS >= 10 ? 'BUY' : moS <= -10 ? 'SELL' : 'HOLD';
  return { text: lines.join('\n'), tone };
}

function levelsAnswer(ctx: StockContext): AiAnswer {
  const t = ctx.tech;
  const a = ctx.analysis;
  if (!t) {
    if (a) return { text: `Chart data for ${ctx.symbol} isn't loaded yet — pull the Technical tab first.`, tone: 'HOLD' };
    return { text: `No chart data for ${ctx.symbol}.`, tone: 'HOLD' };
  }
  const sup = [t.recentLow];
  if (a?.metrics.fiftyTwoWeekLow && a.metrics.fiftyTwoWeekLow < t.recentLow) sup.push(a.metrics.fiftyTwoWeekLow);
  const res = [t.recentHigh];
  if (a?.metrics.fiftyTwoWeekHigh && a.metrics.fiftyTwoWeekHigh > t.recentHigh) res.push(a.metrics.fiftyTwoWeekHigh);
  const supTxt = [...new Set(sup.map((x) => fmt(x)))]; 
  const resTxt = [...new Set(res.map((x) => fmt(x)))];
  return {
    text: `Key levels for ${ctx.symbol} (last ${t.closes.length} bars):\nSupport zone: ${supTxt.join(' / ')}.\nResistance zone: ${resTxt.join(' / ')}.\n\nA close ${t.price >= t.recentHigh * 0.995 ? 'is' : 'needs to break'} above ${fmt(t.recentHigh)} for a confirmed breakout${t.gapPct >= 0 ? `; today opened ${fmtPct(t.gapPct)} up` : `; today opened ${fmtPct(t.gapPct)} down`}. ATR ${fmt(t.atrVal ?? 0)} gives you typical intraday wiggle.`,
    tone: t.price >= t.recentHigh * 0.995 ? 'BUY' : 'HOLD',
  };
}

function trendAnswer(ctx: StockContext): AiAnswer {
  const t = ctx.tech;
  if (!t) return { text: `Not enough candles for ${ctx.symbol} yet to read the trend.`, tone: 'HOLD' };
  const s = t.verdict;
  return {
    text: `Trend read for ${ctx.symbol}: ${s.trend}${s.conviction ? ` (${s.conviction}% conviction)` : ''}, technical stance ${s.stance === 'BUY' ? 'long-side' : s.stance === 'SELL' ? 'short-side' : 'neutral'}.\n\n${s.why.slice(0, 4).join('\n')}`,
    tone: s.stance,
  };
}

function mgmtAnswer(ctx: StockContext): AiAnswer {
  const a = ctx.analysis;
  const mgmt = a?.management;
  if (!mgmt) return { text: `Management scan for ${ctx.symbol} is pending (Yahoo officers + public news litigation scan).`, tone: 'HOLD' };
  const lines = [`Management & governance on ${ctx.symbol}: score ${mgmt.score}/100 (${mgmt.grade}).`, mgmt.thesis];
  if (mgmt.founders.length) lines.push(`Leadership: ${mgmt.founders.map((f) => `${f.name} (${f.role})`).join(', ')}.`);
  if (mgmt.cases.length) {
    lines.push('Legal/regulatory flags in public news:');
    for (const c of mgmt.cases.slice(0, 5)) lines.push(`• [${c.kind}] ${c.title}`);
  } else {
    lines.push('No criminal/civil/regulatory cases surfaced in public news.');
  }
  return { text: lines.join('\n'), tone: mgmt.cases.length ? 'SELL' : mgmt.score >= 70 ? 'BUY' : 'HOLD' };
}

function newsAnswer(ctx: StockContext): AiAnswer {
  if (!ctx.news.length) return { text: `No recent headlines for ${ctx.symbol} in the feed window.`, tone: 'HOLD' };
  return {
    text: `Latest news for ${ctx.symbol}:`,
    tone: 'HOLD',
    bullets: ctx.news.slice(0, 6).map((n) => `${n.title} (${n.source})`),
  };
}

function metricsAnswer(ctx: StockContext): AiAnswer {
  const m = ctx.analysis?.metrics;
  if (!m) return { text: `Metrics for ${ctx.symbol} pending.`, tone: 'HOLD' };
  const rows = [
    ['P/E', m.pe], ['P/B', m.pb], ['P/S', m.ps], ['PEG', m.peg],
    ['ROE %', m.roe], ['ROA %', m.roa], ['Net margin %', m.netMargin], ['Op margin %', m.operatingMargin],
    ['Rev growth %', m.revenueGrowth], ['EPS growth %', m.earningsGrowth],
    ['D/E', m.debtToEquity], ['Current ratio', m.currentRatio], ['Div yield %', m.dividendYield],
    ['EPS ₹', m.eps], ['BVPS ₹', m.bookValue], ['Beta', m.beta],
    ['Promoter %', m.promoterHolding], ['FII %', m.fiiHolding], ['52w high ₹', m.fiftyTwoWeekHigh], ['52w low ₹', m.fiftyTwoWeekLow],
  ].filter(([, v]) => v != null) as [string, number][];
  return { text: `Key metrics for ${ctx.symbol}:\n` + rows.map(([k, v]) => `${k}: ${typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : v}`).join('\n'), tone: 'HOLD' };
}

function compareAnswer(ctx: StockContext, other: string): AiAnswer {
  const b = ctx.stocks[other];
  const a = ctx.analysis;
  if (!b || !a) return { text: `Can't compare ${ctx.symbol} with ${other} — one of them isn't in the fundamentals set yet.`, tone: 'HOLD' };
  const row = (sym: string, s: StockAnalysis) => {
    const o = s.opinion;
    const v = s.verdict;
    const m = s.metrics;
    return [
      `  ${sym}: price ${fmt(s.price)} | verdict ${v.rating} (${v.score}/100) | stance ${o?.stance ?? shortStance(v.rating)} | fair ${fmt(v.fairValueMid)} | MoS ${v.marginOfSafety >= 0 ? '+' : ''}${v.marginOfSafety}%`,
      `           P/E ${m.pe?.toFixed(1) ?? '—'} | ROE ${m.roe?.toFixed(1) ?? '—'}% | margin ${m.netMargin?.toFixed(1) ?? '—'}% | D/E ${m.debtToEquity?.toFixed(2) ?? '—'} | growth ${m.growth?.toFixed(1) ?? '—'}%`,
    ].join('\n');
  };
  const aSt = a.opinion?.stance ?? shortStance(a.verdict.rating);
  const bSt = b.opinion?.stance ?? shortStance(b.verdict.rating);
  const tone: Stance = aSt === 'BUY' && bSt !== 'BUY' ? 'BUY' : bSt === 'BUY' && aSt !== 'BUY' ? 'SELL' : 'HOLD';
  return {
    text: `Head-to-head ${ctx.symbol} vs ${other} (long-term analysis):\n${row(ctx.symbol, a)}\n${row(other, b)}\n\nRelative view: ${aSt === bSt ? `same stance (${aSt}) on both — pick on conviction & MoS.` : `${aSt} on ${ctx.symbol} vs ${bSt} on ${other}.`}`,
    tone,
  };
}

function patternAnswer(ctx: StockContext): AiAnswer {
  const pats = patternList(ctx);
  if (!pats.length) return { text: `No hidden signals found for ${ctx.symbol} yet — load the Technical tab and run the pipeline to unlock the pattern scan.`, tone: 'HOLD' };
  const bull = pats.filter((p) => p.bias === 'bullish').length;
  const bear = pats.filter((p) => p.bias === 'bearish').length;
  const tone: Stance = bull > bear ? 'BUY' : bear > bull ? 'SELL' : 'HOLD';
  return {
    text: `Hidden-pattern scan for ${ctx.symbol} — ${bull} bullish vs ${bear} bearish signals:\n\n${pats.map((p) => `• ${p.label}: ${p.detail}`).join('\n\n')}`,
    tone,
  };
}

export function answer(query: string, ctx: StockContext): AiAnswer {
  const q = query.toLowerCase();

  const otherSym = ctx.peers.find((p) => q.includes(p.symbol.toLowerCase()))?.symbol;
  if (otherSym && ctx.stocks[otherSym]) return compareAnswer(ctx, otherSym);

  if (has(q, ['compare', 'vs', 'versus', 'alternative', 'competitor', 'competitor'])) {
    const list = ctx.peers.filter((p) => ctx.stocks[p.symbol]).map((p) => p.symbol);
    if (!list.length) return { text: `We don't have enough peers for ${ctx.symbol} yet.`, tone: 'HOLD' };
    return { text: `Peers of ${ctx.symbol}: ${list.join(', ')}. Ask e.g. "compare ${ctx.symbol} vs ${list[0]}" for a head-to-head.`, tone: 'HOLD' };
  }

  if (has(q, ['breakout', 'break out', 'resistance', 'support', 'level', 'target price', 'sl', 'stop loss'])) return levelsAnswer(ctx);
  if (has(q, ['news', 'headline', 'sentiment', 'drama', 'recently'])) return newsAnswer(ctx);
  if (has(q, ['management', 'founder', 'case', 'legal', 'fraud', 'governance', 'regulat', 'scam'])) return mgmtAnswer(ctx);
  if (has(q, ['fair value', 'fair-value', 'value', 'overvalued', 'undervalued', 'valued', 'worth', 'expensive', 'cheap', 'target'])) return valuationAnswer(ctx);
  if (has(q, ['pe', 'ratio', 'metrics', 'roe', 'margin', 'debt', 'dividend', 'yield', '52w', '52-week', 'holding'])) return metricsAnswer(ctx);
  if (has(q, ['trend', 'momentum', 'direction', 'up or down', 'going up', 'going down', 'move'])) return trendAnswer(ctx);
  if (has(q, ['pattern', 'hidden', 'signal', 'insights', 'insight', 'ai', 'scan', 'anything i', 'should i', 'buy or '])) return patternAnswer(ctx);
  if (has(q, ['buy', 'sell', 'hold', 'invest', 'verdict', 'opinion', 'recommend', 'position'])) return verdictAnswer(ctx);

  // default: full brief
  const v = verdictAnswer(ctx);
  const p = patternAnswer(ctx);
  return {
    text: `${v.text}\n\n--- pattern scan ---\n${p.text}`,
    tone: v.tone,
  };
}

export { stanceColor };