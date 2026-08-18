import { create } from 'zustand';
import type { Snapshot, Signal, NewsItem, Order, Trade } from './types';

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

interface LiveState {
  connected: boolean;
  ready: boolean;
  lastEventAt: number;
  snapshots: Record<string, Snapshot>;
  candles: Record<string, LiveCandle>;
  signals: Signal[];
  news: NewsItem[];
  orders: Order[];
  trades: Trade[];
  setConnected: (v: boolean) => void;
  setReady: (v: boolean) => void;
  touch: () => void;
  updateSnapshots: (items: Snapshot[]) => void;
  updateCandles: (items: LiveCandle[]) => void;
  addSignal: (s: Signal) => void;
  addNews: (n: NewsItem) => void;
  addOrder: (o: Order) => void;
  addTrade: (t: Trade) => void;
}

let socket: WebSocket | null = null;
let retry = 0;

export const useLive = create<LiveState>((set, get) => ({
  connected: false,
  ready: false,
  lastEventAt: 0,
  snapshots: {},
  candles: {},
  signals: [],
  news: [],
  orders: [],
  trades: [],
  setConnected: (v) => set({ connected: v }),
  setReady: (v) => set({ ready: v }),
  touch: () => set({ lastEventAt: Date.now() }),
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
}));

export function connectLive() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);

  socket.onopen = () => {
    retry = 0;
    useLive.getState().setConnected(true);
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
    useLive.getState().setConnected(false);
    const delay = Math.min(1000 * 2 ** retry, 15000);
    retry += 1;
    setTimeout(connectLive, delay);
  };

  socket.onerror = () => socket?.close();
}
