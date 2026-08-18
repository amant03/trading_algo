export const TOPICS = {
  ticks: 'market.ticks',
  candles: 'market.candles',
  snapshots: 'market.snapshots',
  signals: 'market.signals',
  orders: 'market.orders',
  trades: 'market.trades',
  news: 'market.news',
  fundamentals: 'market.fundamentals',
  equity: 'market.equity',
} as const;

export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

export const TIME = {
  startOfDay: '02:00', // internal clock anchor (constant, not wall clock)
} as const;
