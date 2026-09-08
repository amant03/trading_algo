import { create } from 'zustand';
import { get, post, del } from './api';
import type { Snapshot, Signal, NewsItem, NewsArticle, Order, Trade, MarketOverview, Instrument, StockAnalysis, Sparkline } from './types';

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

export type FeedMode = 'live' | 'relay' | 'polling' | 'snapshot' | 'offline';

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
  instruments: Instrument[];
  snapshotAt: number | null;
  fundamentals: Record<string, StockAnalysis>;
  sparklines: Record<string, Sparkline>;
  newsBySymbol: Record<string, NewsArticle[]>;
  watchlist: string[];
  setMode: (m: FeedMode) => void;
  setReady: (v: boolean) => void;
  touch: () => void;
  setOverview: (o: MarketOverview | null) => void;
  setInstruments: (items: Instrument[]) => void;
  setSnapshotAt: (t: number | null) => void;
  setAnalysis: (f: Record<string, StockAnalysis>, s: Record<string, Sparkline>) => void;
  setNewsBySymbol: (rec: Record<string, NewsArticle[]>) => void;
  setWatchlist: (list: string[]) => void;
  toggleWatch: (sym: string) => boolean;
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
let relayTimer: ReturnType<typeof setInterval> | null = null;
let snapshotTimer: ReturnType<typeof setInterval> | null = null;

// ---- persistent watchlist (works on the static deploy with no backend) ----
const WL_KEY = 'tradealgo.watchlist.v1';

function loadWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(WL_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return [...new Set(arr.filter((x): x is string => typeof x === 'string'))];
    }
  } catch {
    // ignore corrupt storage
  }
  return [];
}

function saveWatchlist(list: string[]): void {
  try {
    localStorage.setItem(WL_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable — skip persistence
  }
}

/** Merge the server watchlist in when a real backend is reachable. */
export async function syncWatchlist(): Promise<void> {
  try {
    const server = await get<string[]>('/api/watchlist');
    if (!Array.isArray(server)) return;
    const st = useLive.getState();
    const merged = [...new Set([...st.watchlist, ...server])];
    useLive.getState().setWatchlist(merged);
    saveWatchlist(merged);
  } catch {
    // no backend — local list stands
  }
}

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
  instruments: [],
  snapshotAt: null,
  fundamentals: {},
  sparklines: {},
  newsBySymbol: {},
  watchlist: loadWatchlist(),
  setMode: (m) => set({ mode: m }),
  setReady: (v) => set({ ready: v }),
  touch: () => set({ lastEventAt: Date.now() }),
  setOverview: (o) => set({ overview: o }),
  setInstruments: (items) => set({ instruments: items }),
  setSnapshotAt: (t) => set({ snapshotAt: t }),
  setAnalysis: (f, s) => set((st) => ({ fundamentals: { ...st.fundamentals, ...f }, sparklines: { ...st.sparklines, ...s } })),
  setNewsBySymbol: (rec) => set((st) => ({ newsBySymbol: { ...st.newsBySymbol, ...rec } })),
  setWatchlist: (list) => set({ watchlist: list }),
  toggleWatch: (sym) => {
    const cur = get().watchlist;
    const had = cur.includes(sym);
    const next = had ? cur.filter((s) => s !== sym) : [...cur, sym];
    set({ watchlist: next });
    saveWatchlist(next);
    // best-effort server sync — never blocks or errors the UI on the static
    // deploy (there is no backend, so /api/watchlist 404s; local wins).
    if (!had) post(`/api/watchlist/${encodeURIComponent(sym)}`, {}).catch(() => {});
    else del(`/api/watchlist/${encodeURIComponent(sym)}`).catch(() => {});
    return !had;
  },
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
  id?: number | null;
  name?: string | null;
  sector?: string | null;
  isin?: string | null;
  exchange?: string | null;
  marketCap?: number | null;
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

/** Normalise snapshot/REST instrument rows into the frontend Instrument type. */
function toInstruments(list: QuoteLike[]): Instrument[] {
  return list
    .filter((q) => q.symbol)
    .map((q) => {
      const price = Number(q.price ?? q.basePrice ?? 0);
      return {
        id: Number(q.id ?? 0),
        symbol: String(q.symbol),
        name: String(q.name ?? q.symbol),
        sector: String(q.sector ?? ''),
        isin: String(q.isin ?? ''),
        exchange: String(q.exchange ?? 'NSE'),
        marketCap: Number(q.marketCap ?? 0),
        basePrice: price,
      } satisfies Instrument;
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
    if (quotes.length) {
      live.updateSnapshots(quotesToSnapshots(quotes));
      live.setInstruments(toInstruments(quotes));
    }
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
    if (!ok && useLive.getState().mode === 'polling') {
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

function startRelay(): void {
  if (relayTimer) return;
  // Near-live quotes keep coming even on the static deploy (no backend): the
  // /api/live serverless function proxies Yahoo and we overlay the prices.
  const tick = async () => {
    const st = useLive.getState();
    if (st.mode === 'live') return;
    try {
      const res = await fetch('/api/live', { cache: 'no-store' });
      if (!res.ok) throw new Error(`relay ${res.status}`);
      const data = (await res.json()) as { ts: number; quotes: QuoteLike[] };
      if (!data.quotes?.length) throw new Error('no quotes');
      const live = useLive.getState();
      const hasSnaps = Object.keys(live.snapshots).length > 0;
      live.updateSnapshots(quotesToSnapshots(data.quotes));
      if (!hasSnaps) live.setInstruments(toInstruments(data.quotes));
      live.touch();
      if (live.mode === 'snapshot' || live.mode === 'relay') {
        const ov = live.overview;
        live.setOverview(
          ov
            ? { ...ov, updatedAt: data.ts }
            : { index: { symbol: 'NIFTY 50', price: 0, changePct: 0, timestamp: data.ts }, market: { advancers: 0, decliners: 0, unchanged: 0, total: 0 }, sectorPerformance: [], gainers: [], losers: [], topVolume: [], updatedAt: data.ts },
        );
        live.setSnapshotAt(data.ts);
        live.setMode('relay');
      }
    } catch {
      const live = useLive.getState();
      if (live.mode === 'relay') live.setMode('snapshot');
    }
  };
  void tick();
  relayTimer = setInterval(tick, 15_000);
}

function stopRelay(): void {
  if (relayTimer) {
    clearInterval(relayTimer);
    relayTimer = null;
  }
}

/** Last-resort datasets: CI commits a fresh snapshot to the automation-data
 *  branch on every run (fetched live, no redeploy needed); the bundle also
 *  ships frontend/public/snapshot.json as a second fallback. */
const SNAPSHOT_URLS = [
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/snapshot.json',
  '/snapshot.json',
];

const ANALYSIS_URLS = [
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/analysis.json',
  '/analysis.json',
];

const NEWS_URLS = [
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/news.json',
  '/news.json',
];

async function loadNews(): Promise<boolean> {
  for (const url of NEWS_URLS) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const data = (await res.json()) as { generatedAt?: string; items?: Record<string, NewsArticle[]> };
      if (!data.items) continue;
      useLive.getState().setNewsBySymbol(data.items);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function loadAnalysis(): Promise<boolean> {
  for (const url of ANALYSIS_URLS) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        stocks?: Record<string, StockAnalysis>;
        sparklines?: Record<string, Sparkline>;
      };
      if (!data.stocks) continue;
      useLive.getState().setAnalysis(data.stocks, data.sparklines ?? {});
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function loadCiSnapshot(): Promise<boolean> {
  for (const url of SNAPSHOT_URLS) {
    try {
      const snap = await fetch(url, { cache: 'no-store' });
      if (!snap.ok) continue;
      const data = (await snap.json()) as {
        generatedAt?: string;
        overview?: MarketOverview | null;
        instruments?: Array<Record<string, unknown> & QuoteLike> | null;
        signals?: Signal[] | null;
        news?: NewsItem[] | null;
      };
      const viable = data.instruments?.length || data.signals?.length || data.news?.length;
      if (!viable) continue;
      const live = useLive.getState();
      if (data.instruments?.length) {
        live.updateSnapshots(quotesToSnapshots(data.instruments));
        live.setInstruments(toInstruments(data.instruments));
      }
      if (data.overview) live.setOverview(data.overview);
      if (data.signals?.length) live.replaceSignals(data.signals);
      if (data.news?.length) live.replaceNews(data.news);
      if (data.generatedAt) live.setSnapshotAt(new Date(data.generatedAt).getTime());
      if (live.mode === 'offline') live.setMode('snapshot');
      void loadAnalysis();
      void loadNews();
      startRelay();
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

/** Snapshot loading retries every 30s until it lands, so a transient GitHub
 *  raw fetch failure no longer leaves the UI stuck on the offline gate. */
function ensureSnapshot(): void {
  if (snapshotTimer) return;
  const attempt = async () => {
    const st = useLive.getState();
    if (st.mode !== 'offline' || Object.keys(st.snapshots).length) return;
    const ok = await loadCiSnapshot();
    if (!ok) console.warn('[live] snapshot unavailable, retrying in 30s');
  };
  void attempt();
  snapshotTimer = setInterval(attempt, 30_000);
}

export function connectLive() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = import.meta.env.VITE_WS_URL ?? `${proto}://${location.host}/ws`;

  // No backend reachable at boot? Load the last CI-committed snapshot (and
  // keep retrying) so the terminal never renders an empty shell.
  ensureSnapshot();
  void syncWatchlist();
  void loadAnalysis();
  void loadNews();
  setInterval(() => {
    void loadNews();
    void loadAnalysis();
  }, 600_000);

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
    // If the snapshot/relay already took over, don't keep reconnecting to /ws.
    if (st.mode === 'snapshot' || st.mode === 'relay') return;
    startPolling(); // degrade to REST polling instead of a blank screen
    const delay = Math.min(1000 * 2 ** retry, 15000);
    retry += 1;
    setTimeout(connectLive, delay);
  };

  socket.onerror = () => socket?.close();
}