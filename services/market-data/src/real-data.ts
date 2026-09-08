import {
  Candle,
  Snapshot,
  Instrument,
  TOPICS,
  logger,
  publishBatch,
  query,
  round4,
} from '@trading/shared';
import { insertCandles } from './backfill.js';

/**
 * Real NSE market data via Yahoo Finance (free, no API key).
 *  - syncRealHistory(): 2 years of real daily candles per symbol -> `candles`
 *    (timeframe '1d'), and re-anchors each instrument's base price to the real
 *    last close so the live simulator oscillates around real levels.
 *  - refreshRealQuotes(): current NSE quotes for all symbols in 2-3 HTTP
 *    calls -> `market.snapshots`, so the dashboard shows real prices.
 * Every symbol failure is isolated — a delisted ticker never breaks the run.
 */

const UA = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const yahooSymbol = (symbol: string): string => `${symbol}.NS`;

async function yahooJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: UA,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      logger.warn({ url: url.split('?')[0], status: res.status }, 'yahoo request failed');
      return null;
    }
    return (await res.json()) as unknown;
  } catch (err) {
    logger.warn({ url: url.split('?')[0], err: (err as Error).message }, 'yahoo request error');
    return null;
  }
}

interface ChartResult {
  timestamp?: number[];
  indicators?: {
    quote?: {
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
      volume?: (number | null)[];
    }[];
  };
}

/** Pull 2y of real daily bars for every instrument. Returns bar count. */
export async function syncRealHistory(instruments: Instrument[]): Promise<number> {
  let bars = 0;
  let synced = 0;
  for (const inst of instruments) {
    try {
      const data = (await yahooJson(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(inst.symbol))}?range=2y&interval=1d`,
      )) as { chart?: { result?: ChartResult[] } } | null;
      const r = data?.chart?.result?.[0];
      const q = r?.indicators?.quote?.[0];
      if (!r?.timestamp?.length || !q) {
        logger.warn({ symbol: inst.symbol }, 'no yahoo history (delisted/renamed?)');
        continue;
      }
      const rows: Candle[] = [];
      for (let i = 0; i < r.timestamp.length; i++) {
        const c = q.close?.[i];
        if (c == null) continue;
        const o = q.open?.[i] ?? c;
        const h = q.high?.[i] ?? Math.max(o, c);
        const l = q.low?.[i] ?? Math.min(o, c);
        rows.push({
          instrumentId: inst.id,
          symbol: inst.symbol,
          timeframe: '1d',
          ts: r.timestamp[i] * 1000,
          open: round4(o),
          high: round4(h),
          low: round4(l),
          close: round4(c),
          volume: Math.round(q.volume?.[i] ?? 0),
        });
      }
      if (!rows.length) continue;
      await insertCandles(rows);
      bars += rows.length;
      synced += 1;
      const last = rows[rows.length - 1];
      await query('UPDATE instruments SET base_price = $1 WHERE id = $2', [last.close, inst.id]);
      inst.basePrice = last.close; // anchor live sim to the real close
    } catch (err) {
      logger.warn({ symbol: inst.symbol, err: (err as Error).message }, 'yahoo history failed');
    }
    await sleep(200); // be polite to the free endpoint
  }
  logger.info({ synced, instruments: instruments.length, bars }, 'real NSE daily history synced');
  return bars;
}

interface ChartMeta {
  regularMarketPrice?: number | null;
  regularMarketTime?: number | null;
  chartPreviousClose?: number | null;
  previousClose?: number | null;
  regularMarketDayHigh?: number | null;
  regularMarketDayLow?: number | null;
  regularMarketVolume?: number | null;
}

/**
 * Publish one fresh real quote per instrument. The free v7/finance/quote
 * endpoint now returns 401 to scripted clients, so we source quotes from the
 * same v8 chart endpoint that history uses (range=1d): the latest bar's
 * close + meta fields give price/prev/day OHLCV. Symbols with no coverage
 * (e.g. renames/delistings) are skipped, not fatal. Requests are pooled (8
 * at a time) to stay polite to the free endpoint.
 */
export async function refreshRealQuotes(instruments: Instrument[]): Promise<number> {
  const snaps: Snapshot[] = [];
  let cursor = 0;
  const workerCount = 8;
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const idx = cursor++;
      const inst = instruments[idx];
      if (!inst) return;
      const data = (await yahooJson(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(inst.symbol))}?range=1d&interval=1d`,
      )) as { chart?: { result?: [{ meta?: ChartMeta; indicators?: { quote?: { close?: (number | null)[] }[] } }] } } | null;
      const r = data?.chart?.result?.[0];
      const meta = r?.meta;
      const lastClose = r?.indicators?.quote?.[0]?.close?.filter((c): c is number => c != null).pop();
      const price = meta?.regularMarketPrice ?? lastClose;
      if (price == null) continue;
      const prev = meta?.chartPreviousClose ?? meta?.previousClose ?? price;
      snaps.push({
        instrumentId: inst.id,
        symbol: inst.symbol,
        price: round4(price),
        prevClose: round4(prev),
        change: round4(price - prev),
        changePct: prev ? round4(((price - prev) / prev) * 100) : 0,
        dayOpen: round4(prev),
        dayHigh: round4(meta?.regularMarketDayHigh ?? price),
        dayLow: round4(meta?.regularMarketDayLow ?? price),
        dayVolume: Math.round(meta?.regularMarketVolume ?? 0),
        ts: meta?.regularMarketTime ? meta.regularMarketTime * 1000 : Date.now(),
      });
    }
  });
  await Promise.all(workers);
  if (snaps.length) {
    await publishBatch(
      TOPICS.snapshots,
      snaps.map((s) => ({ payload: s, key: s.symbol })),
    );
  }
  logger.info({ quotes: snaps.length, instruments: instruments.length }, 'real NSE quotes published');
  return snaps.length;
}
