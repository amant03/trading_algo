import { create } from 'zustand';
import { get, post, del } from './api';
import { NSE_UNIVERSE } from './lib/nse';
import type { Snapshot, Signal, NewsItem, NewsArticle, Order, Trade, MarketOverview, Instrument, StockAnalysis, Sparkline, UniverseStock } from './types';

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
  universe: UniverseStock[];
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
  setUniverse: (items: UniverseStock[]) => void;
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
let relayTimer: ReturnType<typeof setTimeout> | null = null;
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
  universe: [],
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
  setUniverse: (items) => set({ universe: items }),
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
    // watchlisted symbols get priority on-demand fundamentals immediately
    if (!had) void ensureFundamentals([sym]);
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
  change?: number | null;
  prevClose?: number | null;
  dayHigh?: number | null;
  dayLow?: number | null;
  dayVolume?: number | null;
  volume?: number | null;
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
      const prevClose = Number(q.prevClose ?? (price - price * (changePct / 100)));
      const change = Number(q.change ?? price - prevClose);
      return {
        instrumentId: 0,
        symbol: String(q.symbol),
        price,
        prevClose,
        change,
        changePct,
        dayOpen: prevClose,
        dayHigh: Number(q.dayHigh ?? price),
        dayLow: Number(q.dayLow ?? price),
        dayVolume: Number(q.dayVolume ?? q.volume ?? 0),
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
    const [quotes, overview, sigs] = await Promise.all([
      get<QuoteLike[]>('/api/instruments'),
      get<MarketOverview>('/api/market/overview').catch(() => null),
      get<Signal[]>('/api/signals?limit=60').catch(() => null),
    ]);
    const live = useLive.getState();
    if (quotes.length) {
      live.updateSnapshots(quotesToSnapshots(quotes));
      applyQuoteInstruments(toInstruments(quotes));
    }
    if (overview) live.setOverview(overview);
    if (sigs && !live.signals.length) live.replaceSignals(sigs);
    else if (sigs && sigs.length > live.signals.length) live.replaceSignals(sigs);
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

const CAP_LABEL: Record<string, string> = { large: 'Large cap', mid: 'Mid cap', small: 'Small cap' };

function universeToInstruments(stocks: UniverseStock[]): Instrument[] {
  return stocks.map((u, i) => ({
    id: i + 1,
    symbol: u.symbol,
    name: u.name,
    sector: CAP_LABEL[u.cap] ?? u.cap,
    isin: u.isin,
    exchange: u.exchange,
    marketCap: u.mktCap ?? 0,
    basePrice: 0,
  }));
}

function applyQuoteInstruments(incoming: Instrument[]): void {
  if (!incoming.length) return;
  const live = useLive.getState();
  if (!live.instruments.length) {
    live.setInstruments(incoming);
    return;
  }
  const have = new Set(live.instruments.map((i) => i.symbol));
  const extra = incoming.filter((i) => !have.has(i.symbol));
  if (extra.length) live.setInstruments([...live.instruments, ...extra]);
}

function seedInstrumentsIfEmpty(): void {
  const live = useLive.getState();
  if (live.instruments.length || live.universe.length) return;
  live.setInstruments(
    NSE_UNIVERSE.map((u, i) => ({
      id: i + 1,
      symbol: u.symbol,
      name: u.name,
      sector: u.sector,
      isin: '',
      exchange: 'NSE',
      marketCap: 0,
      basePrice: 0,
    })),
  );
}

const UNIVERSE_URLS = [
  '/universe.json',
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@main/frontend/public/universe.json',
  'https://raw.githubusercontent.com/amant03/trading_algo/main/frontend/public/universe.json',
];

async function loadUniverse(): Promise<boolean> {
  const data = await loadJson<{ stocks?: UniverseStock[] }>(UNIVERSE_URLS);
  if (!data?.stocks?.length) return false;
  const live = useLive.getState();
  live.setUniverse(data.stocks);
  live.setInstruments(universeToInstruments(data.stocks));
  return true;
}

export async function refreshSymbols(symbols: string[]): Promise<void> {
  const extra = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 24);
  if (!extra.length) return;
  try {
    const res = await fetch(`/api/live?symbols=${encodeURIComponent(extra.join(','))}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { ts: number; quotes: QuoteLike[]; index?: { symbol: string; price: number; changePct: number; timestamp?: number } | null };
    if (!data.quotes?.length) return;
    const live = useLive.getState();
    live.updateSnapshots(quotesToSnapshots(data.quotes));
    live.touch();
  } catch {
    // ignore — chart/page still work off /api/chart
  }
}

function overviewFromQuotes(quotes: QuoteLike[], ts: number, index?: { symbol: string; price: number; changePct: number; timestamp?: number } | null): MarketOverview {
  const snaps = quotesToSnapshots(quotes);
  const adv = snaps.filter((s) => s.changePct > 0.02).length;
  const dec = snaps.filter((s) => s.changePct < -0.02).length;
  const unchanged = snaps.length - adv - dec;
  const bySector = new Map<string, number[]>();
  for (const q of quotes) {
    const sector = String(q.sector ?? '');
    if (!sector) continue;
    const arr = bySector.get(sector) ?? [];
    arr.push(Number(q.changePct ?? 0));
    bySector.set(sector, arr);
  }
  const sectorPerformance = [...bySector.entries()]
    .map(([sector, vals]) => ({
      sector,
      changePct: vals.reduce((a, b) => a + b, 0) / vals.length,
      count: vals.length,
    }))
    .sort((a, b) => b.changePct - a.changePct);
  const ranked = [...snaps].sort((a, b) => b.changePct - a.changePct);
  const byVol = [...snaps].sort((a, b) => b.dayVolume - a.dayVolume);
  const idx = index && index.price > 0
    ? { symbol: index.symbol || 'NIFTY 50', price: index.price, changePct: index.changePct, timestamp: index.timestamp ?? ts }
    : { symbol: 'NIFTY 50', price: 0, changePct: 0, timestamp: ts };
  return {
    index: idx,
    market: { advancers: adv, decliners: dec, unchanged, total: snaps.length },
    sectorPerformance,
    gainers: ranked.slice(0, 10),
    losers: [...ranked].reverse().slice(0, 10),
    topVolume: byVol.slice(0, 10),
    updatedAt: ts,
  };
}

function isIstSessionNow(): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
  if (wd === 'Sat' || wd === 'Sun') return false;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const hm = hour * 60 + minute;
  return hm >= 9 * 60 && hm <= 15 * 60 + 40;
}

function startRelay(): void {
  if (relayTimer) return;
  seedInstrumentsIfEmpty();
  const tick = async () => {
    const st = useLive.getState();
    if (st.mode === 'live') return;
    try {
      const res = await fetch('/api/live', { cache: 'no-store' });
      if (!res.ok) throw new Error(`relay ${res.status}`);
      const data = (await res.json()) as {
        ts: number;
        quotes: QuoteLike[];
        index?: { symbol: string; price: number; changePct: number; timestamp?: number } | null;
      };
      if (!data.quotes?.length) throw new Error('no quotes');
      const live = useLive.getState();
      live.updateSnapshots(quotesToSnapshots(data.quotes));
      applyQuoteInstruments(toInstruments(data.quotes));
      live.touch();
      live.setOverview(overviewFromQuotes(data.quotes, data.ts, data.index));
      live.setSnapshotAt(data.ts);
      if (live.mode !== 'live') live.setMode('relay');
      const watched = useLive.getState().watchlist;
      if (watched.length) void refreshSymbols(watched);
    } catch {
      const live = useLive.getState();
      if (live.mode === 'relay' && Object.keys(live.snapshots).length) live.setMode('snapshot');
    }
  };
  void tick();
  const cadence = () => (isIstSessionNow() ? 8_000 : 25_000);
  const loop = () => {
    relayTimer = setTimeout(() => {
      void tick().finally(loop);
    }, cadence());
  };
  loop();
}

function stopRelay(): void {
  if (relayTimer) {
    clearTimeout(relayTimer);
    relayTimer = null;
  }
}

/** Last-resort datasets: CI commits a fresh snapshot to the automation-data
 *  branch on every run (fetched live, no redeploy needed); the bundle also
 *  ships frontend/public/snapshot.json as a second fallback. */
const SNAPSHOT_URLS = [
  '/snapshot.json',
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@automation-data/frontend/public/snapshot.json',
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/snapshot.json',
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@main/frontend/public/snapshot.json',
];

const ANALYSIS_URLS = [
  '/analysis.json',
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@automation-data/frontend/public/analysis.json',
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/analysis.json',
];

const NEWS_URLS = [
  '/news.json',
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@automation-data/frontend/public/news.json',
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/news.json',
];

async function loadJson<T>(urls: string[]): Promise<T | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('text/html')) continue;
      const data = (await res.json()) as T;
      if (data && typeof data === 'object') return data;
    } catch {
      continue;
    }
  }
  return null;
}

async function loadNews(): Promise<boolean> {
  const data = await loadJson<{ generatedAt?: string; items?: Record<string, NewsArticle[]> }>(NEWS_URLS);
  if (data?.items) {
    const live = useLive.getState();
    live.setNewsBySymbol(data.items);
    const flat: NewsArticle[] = [];
    for (const [sym, rows] of Object.entries(data.items)) {
      for (const a of rows) flat.push({ ...a, symbol: a.symbol || sym });
    }
    applyNewsFeed(articlesToFeed(flat));
  }
  void fetchRelayNews();
  return Boolean(data?.items);
}

function articlesToFeed(articles: NewsArticle[]): NewsItem[] {
  return articles
    .filter((a) => a.title && a.url)
    .map((a, i) => ({
      id: i + 1,
      instrumentId: null,
      symbol: a.symbol || null,
      headline: a.title,
      summary: null,
      source: a.source || 'Google News',
      category: 'NEWS',
      sentiment: 'NEUTRAL',
      impact: 'LOW',
      tags: [],
      publishedAt: Date.parse(a.publishedAt) || Date.now(),
      url: a.url,
    }));
}

function applyNewsFeed(items: NewsItem[]): void {
  if (!items.length) return;
  const live = useLive.getState();
  const byHead = new Map<string, NewsItem>();
  for (const n of [...items, ...live.news.filter((n) => n.url)]) {
    if (!byHead.has(n.headline)) byHead.set(n.headline, n);
  }
  live.replaceNews([...byHead.values()].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 48));
}

export async function fetchRelayNews(symbol?: string): Promise<NewsArticle[]> {
  try {
    const path = symbol
      ? `/api/news?symbol=${encodeURIComponent(symbol)}`
      : '/api/news';
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as { hits?: Array<{ title?: string; source?: string; url?: string; publishedAt?: string; symbol?: string | null }> };
    const hits: NewsArticle[] = (data.hits ?? [])
      .filter((h) => h.title && h.url)
      .map((h) => ({
        title: String(h.title),
        source: String(h.source || 'Google News'),
        url: String(h.url),
        publishedAt: h.publishedAt || new Date().toISOString(),
        symbol: h.symbol || symbol || '',
      }));
    if (symbol && hits.length) useLive.getState().setNewsBySymbol({ [symbol]: hits });
    applyNewsFeed(articlesToFeed(hits));
    return hits;
  } catch {
    return [];
  }
}

async function loadAnalysis(): Promise<boolean> {
  const data = await loadJson<{
    stocks?: Record<string, StockAnalysis>;
    sparklines?: Record<string, Sparkline>;
  }>(ANALYSIS_URLS);
  if (!data?.stocks) return false;
  useLive.getState().setAnalysis(data.stocks, data.sparklines ?? {});
  return true;
}

// ---- on-demand fundamentals ----------------------------------------------
// Fills the gaps the nightly batch hasn't reached yet by asking the
// /api/funda relay (free Yahoo data). Watchlisted/previously viewed stocks are
// prioritised automatically — no clicks required. Prices keep streaming via
// the /api/live + /api/chart relays regardless.

const fundaFetching = new Set<string>();

export async function ensureFundamentals(symbols: string[]): Promise<void> {
  const missing = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].filter((s) => {
    if (fundaFetching.has(s)) return false;
    const existing = useLive.getState().fundamentals[s];
    return !existing || !existing.financials;
  });
  if (!missing.length) return;
  for (const s of missing) fundaFetching.add(s);
  try {
    for (let i = 0; i < missing.length; i += 8) {
      const batch = missing.slice(i, i + 8);
      try {
        const res = await fetch(`/api/funda?symbols=${encodeURIComponent(batch.join(','))}`, { cache: 'no-store' });
        if (!res.ok) continue;
        const data = (await res.json()) as { stocks?: Record<string, StockAnalysis> };
        if (data?.stocks) useLive.getState().setAnalysis(data.stocks, {});
      } catch {
        // relay hiccup — a later ensure call retries
      }
    }
  } finally {
    for (const s of missing) fundaFetching.delete(s);
  }
}

async function loadCiSnapshot(): Promise<boolean> {
  const data = await loadJson<{
    generatedAt?: string;
    overview?: MarketOverview | null;
    instruments?: Array<Record<string, unknown> & QuoteLike> | null;
    signals?: Signal[] | null;
    news?: NewsItem[] | null;
  }>(SNAPSHOT_URLS);
  if (!data) return false;
  const viable = data.instruments?.length || data.signals?.length || data.news?.length;
  if (!viable) return false;
  const live = useLive.getState();
  if (data.instruments?.length) {
    live.updateSnapshots(quotesToSnapshots(data.instruments));
    applyQuoteInstruments(toInstruments(data.instruments));
  }
  if (data.overview) live.setOverview(data.overview);
  if (data.signals?.length) live.replaceSignals(data.signals);
  if (data.generatedAt) live.setSnapshotAt(new Date(data.generatedAt).getTime());
  if (live.mode === 'offline') live.setMode('snapshot');
  void loadAnalysis();
  void loadNews();
  return true;
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
  seedInstrumentsIfEmpty();
  void loadUniverse();
  ensureSnapshot();
  startRelay();
  void syncWatchlist();
  void loadAnalysis();
  void loadNews();
  setInterval(() => {
    void loadNews();
    void loadAnalysis();
    ensureFundamentals(useLive.getState().watchlist.slice(0, 12));
  }, 600_000);
  // watchlist edits trigger on-demand fundamentals for the newly added symbol
  useLive.subscribe((st, prev) => {
    if (st.watchlist !== prev.watchlist) void ensureFundamentals(st.watchlist.slice(0, 12));
  });

  const staticHost = import.meta.env.PROD && !import.meta.env.VITE_WS_URL;
  if (staticHost) return;

  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = import.meta.env.VITE_WS_URL ?? `${proto}://${location.host}/ws`;

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