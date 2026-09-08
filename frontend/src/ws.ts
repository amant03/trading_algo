import { create } from 'zustand';
import { get } from './api';
import type { Snapshot, Signal, NewsItem, Order, Trade, MarketOverview } from './types';

export interface LiveCandle {
  instrumentId: number;
  symbol: string;
  timeframe: string;
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type FeedMode = 'live' | 'polling' | 'snapshot' | 'offline';

interface LiveState {
  mode: FeedMode;
  ready: boolean;
  lastEventAt: number;
  overview: MarketOverview | null;
  snapshots: Record<string, Snapshot>;
  candles: Record<string, LiveCandle>;
  signals: Signal[];
  news: NewsItem[];
  orders: Order[];
  trades: Trade[];
  setMode: (m: FeedMode) => void;
  setReady: (v: boolean) => void;
  touch: () => void;
  setOverview: (o: MarketOverview | null) => void;
  updateSnapshots: (items: Snapshot[]) => void;
  updateCandles: (items: LiveCandle[]) => void;
  addSignal: (s: Signal) => void;
  addNews: (n: NewsItem) => void;
  addOrder: (o: Order) => void;
  addTrade: (t: Trade) => void;
  replaceSignals: (items: Signal[]) => void;
  replaceNews: (items: NewsItem[]) => void;
}

let socket: WebSocket | null = null;
let retry = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

export const useLive = create<LiveState>((set, get) => ({
  mode: 'offline',
  ready: false,
  lastEventAt: 0,
  overview: null,
  snapshots: {},
  candles: {},
  signals: [],
  news: [],
  orders: [],
  trades: [],
  setMode: (m) => set({ mode: m }),
  setReady: (v) => set({ ready: v }),
  touch: () => set({ lastEventAt: Date.now() }),
  setOverview: (o) => set({ overview: o }),
  updateSnapshots: (items) => {
    const snapshots = { ...get().snapshots };
    for (const item of items) snapshots[item.symbol] = item;
    set({ snapshots });
  },
  updateCandles: (items) => {
    const candles = { ...get().candles };
    for (const c of items) candles[`${c.symbol}:${c.timeframe}`] = c;
    set({ candles });
  },
  addSignal: (s) => set((st) => ({ signals: [s, ...st.signals].slice(0, 200) })),
  addNews: (n) => set((st) => ({ news: [n, ...st.news].slice(0, 200) })),
  addOrder: (o) => set((st) => ({ orders: [o, ...st.orders].slice(0, 200) })),
  addTrade: (t) => set((st) => ({ trades: [t, ...st.trades].slice(0, 200) })),
  replaceSignals: (items) => set({ signals: items.slice(0, 200) }),
  replaceNews: (items) => set({ news: items.slice(0, 200) }),
}));

interface QuoteLike {
  symbol?: string | null;
  price?: number | null;
  changePct?: number | null;
  dayHigh?: number | null;
  dayLow?: number | null;
  dayVolume?: number | null;
  basePrice?: number | null;
}

/** Map /api/instruments rows or snapshot.json quotes into Snapshot shape. */
function quotesToSnapshots(list: QuoteLike[]): Snapshot[] {
  const now = Date.now();
  return list
    .filter((q) => q.symbol)
    .map((q) => {
      const price = Number(q.price ?? q.basePrice ?? 0);
      const changePct = Number(q.changePct ?? 0);
      return {
        instrumentId: 0,
        symbol: String(q.symbol),
        price,
        prevClose: price - price * (changePct / 100),
        change: price * (changePct / 100),
        changePct,
        dayOpen: price - price * (changePct / 100),
        dayHigh: Number(q.dayHigh ?? price),
        dayLow: Number(q.dayLow ?? price),
        dayVolume: Number(q.dayVolume ?? 0),
        ts: now,
      } satisfies Snapshot;
    });
}

async function pollOnce(): Promise<boolean> {
  try {
    const [quotes, overview, sigs, news] = await Promise.all([
      get<QuoteLike[]>('/api/instruments'),
      get<MarketOverview>('/api/market/overview').catch(() => null),
      get<Signal[]>('/api/signals?limit=60').catch(() => null),
      get<NewsItem[]>('/api/news?limit=60').catch(() => null),
    ]);
    const live = useLive.getState();
    if (quotes.length) live.updateSnapshots(quotesToSnapshots(quotes));
    if (overview) live.setOverview(overview);
    if (sigs && !live.signals.length) live.replaceSignals(sigs);
    else if (sigs && sigs.length > live.signals.length) live.replaceSignals(sigs);
    if (news && !live.news.length) live.replaceNews(news);
    useLive.getState().setMode('polling');
    return true;
  } catch {
    return false;
  }
}

function startPolling(): void {
  if (pollTimer) return;
    const tick = async () => {
    if (useLive.getState().mode === 'live') return; // WS took over
    const ok = await pollOnce();
    if (!ok && useLive.getState().mode !== 'snapshot') {
      useLive.getState().setMode('offline');
    }
  };
  void tick();
  pollTimer = setInterval(tick, 4000);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Last-resort datasets: CI commits a fresh snapshot to the automation-data
 *  branch on every run (fetched live, no redeploy needed); the bundle also
 *  ships frontend/public/snapshot.json as a second fallback. */
const SNAPSHOT_URLS = [
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/snapshot.json',
  '/snapshot.json',
];

async function loadCiSnapshot(): Promise<boolean> {
  for (const url of SNAPSHOT_URLS) {
    try {
      const snap = await fetch(url, { cache: 'no-store' });
      if (!snap.ok) continue;
      const data = (await snap.json()) as {
        generatedAt?: string;
        overview?: MarketOverview | null;
        instruments?: QuoteLike[] | null;
        signals?: Signal[] | null;
        news?: NewsItem[] | null;
      };
      if (!data.instruments?.length) continue;
      const live = useLive.getState();
      live.updateSnapshots(quotesToSnapshots(data.instruments));
      if (data.overview) live.setOverview(data.overview);
      if (data.signals?.length) live.replaceSignals(data.signals);
      if (data.news?.length) live.replaceNews(data.news);
      if (live.mode === 'offline') live.setMode('snapshot');
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

export function connectLive() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = import.meta.env.VITE_WS_URL ?? `${proto}://${location.host}/ws`;

  // If no backend is reachable at all, fall back to the last CI-committed
  // snapshot so the terminal never renders an empty shell.
  if (!fallbackTimer) {
    fallbackTimer = setTimeout(async () => {
      const st = useLive.getState();
      if (st.mode === 'offline' && !Object.keys(st.snapshots).length) {
        const ok = await loadCiSnapshot();
        if (!ok) console.warn('[live] no CI snapshot available');
      }
    }, 6000);
  }

  try {
    socket = new WebSocket(url);
  } catch {
    startPolling();
    return;
  }

  socket.onopen = () => {
    retry = 0;
    stopPolling();
    useLive.getState().setMode('live');
  };

  socket.onmessage = (ev) => {
    let msg: { type: string; payload: unknown };
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    const live = useLive.getState();
    live.touch();
    switch (msg.type) {
      case 'ready':
        live.setReady(true);
        break;
      case 'snapshot':
        live.updateSnapshots(msg.payload as Snapshot[]);
        break;
      case 'candle':
        live.updateCandles(msg.payload as LiveCandle[]);
        break;
      case 'signal':
        live.addSignal(msg.payload as Signal);
        break;
      case 'news':
        live.addNews(msg.payload as NewsItem);
        break;
      case 'order':
        live.addOrder(msg.payload as Order);
        break;
      case 'trade':
        live.addTrade(msg.payload as Trade);
        break;
      default:
        break;
    }
  };

  socket.onclose = () => {
    const st = useLive.getState();
    if (st.mode === 'live') st.setMode('offline');
    startPolling(); // degrade to REST polling instead of a blank screen
    const delay = Math.min(1000 * 2 ** retry, 15000);
    retry += 1;
    setTimeout(connectLive, delay);
  };

  socket.onerror = () => socket?.close();
}
