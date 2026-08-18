import {
  Candle,
  EquityPoint,
  NewsEvent,
  Order,
  Signal,
  Snapshot,
  Timeframe,
  Trade,
} from '@trading/shared';

/** In-memory live market state, fed by Kafka consumers, served over REST + WS. */
export class MarketStore {
  snapshots = new Map<number, Snapshot>();
  indexSnapshot: Snapshot | null = null;
  lastCandles = new Map<string, Candle>(); // `${instrumentId}:${timeframe}`
  signals: Signal[] = [];
  news: NewsEvent[] = [];
  latestTrades: Trade[] = [];
  latestOrders: Order[] = [];
  equityPoints: EquityPoint[] = [];
  private maxSignals = 300;
  private maxNews = 300;

  onSnapshot(snapshot: Snapshot): void {
    if (snapshot.instrumentId === 0) {
      this.indexSnapshot = snapshot;
    } else {
      this.snapshots.set(snapshot.instrumentId, snapshot);
    }
  }

  onCandle(candle: Candle): void {
    this.lastCandles.set(`${candle.instrumentId}:${candle.timeframe}`, candle);
  }

  onSignal(signal: Signal): void {
    this.signals.unshift(signal);
    if (this.signals.length > this.maxSignals) this.signals.length = this.maxSignals;
  }

  onNews(event: NewsEvent): void {
    this.news.unshift(event);
    if (this.news.length > this.maxNews) this.news.length = this.maxNews;
  }

  onTrade(trade: Trade): void {
    this.latestTrades.unshift(trade);
    if (this.latestTrades.length > 50) this.latestTrades.length = 50;
  }

  onOrder(order: Order): void {
    this.latestOrders.unshift(order);
    if (this.latestOrders.length > 50) this.latestOrders.length = 50;
  }

  onEquity(point: EquityPoint): void {
    this.equityPoints.push(point);
    if (this.equityPoints.length > 500) this.equityPoints.length = 500;
  }

  getSnapshot(instrumentId: number): Snapshot | undefined {
    return this.snapshots.get(instrumentId);
  }

  getLastCandle(instrumentId: number, timeframe: Timeframe): Candle | undefined {
    return this.lastCandles.get(`${instrumentId}:${timeframe}`);
  }
}