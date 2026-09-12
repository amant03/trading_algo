import { FastifyInstance } from 'fastify';
import {
  query,
  publish,
  TOPICS,
  sma,
  ema,
  rsi,
  macd,
  bollinger,
  atr,
  stochastic,
  supertrend,
  Instrument,
  Order,
  Timeframe,
} from '@trading/shared';
import { MarketStore } from './market-store.js';
import { ensureAccount, requireAuth } from './auth.js';

export interface Ctx {
  store: MarketStore;
  instruments: Instrument[];
  bySymbol: Map<string, Instrument>;
}

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '1d'];

function fmtNum(v: unknown): number {
  return typeof v === 'string' ? Number(v) : Number(v ?? 0);
}

export async function registerRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  const { store, instruments, bySymbol } = ctx;

  app.get('/api/health', async () => ({ ok: true, time: Date.now(), services: { ws: true } }));

  // ---------------- market ----------------
  app.get('/api/market/overview', async () => {
    const snaps = [...store.snapshots.values()];
    const gainers = [...snaps].sort((a, b) => b.changePct - a.changePct).slice(0, 10);
    const losers = [...snaps].sort((a, b) => a.changePct - b.changePct).slice(0, 10);
    const active = [...snaps].sort((a, b) => b.dayVolume - a.dayVolume).slice(0, 10);
    const advancers = snaps.filter((s) => s.changePct > 0).length;
    const decliners = snaps.filter((s) => s.changePct < 0).length;

    const sectors = new Map<string, { sum: number; count: number }>();
    for (const s of snaps) {
      const inst = ctx.instruments.find((i) => i.id === s.instrumentId);
      if (!inst?.sector) continue;
      const cur = sectors.get(inst.sector) ?? { sum: 0, count: 0 };
      cur.sum += s.changePct;
      cur.count += 1;
      sectors.set(inst.sector, cur);
    }
    const sectorPerformance = [...sectors.entries()]
      .map(([sector, v]) => ({ sector, changePct: fmtNum(v.sum / v.count) }))
      .sort((a, b) => b.changePct - a.changePct);

    return {
      index: store.indexSnapshot,
      market: {
        advancers,
        decliners,
        unchanged: snaps.length - advancers - decliners,
        breadth: advancers - decliners,
        avgChangePct: fmtNum((snaps.reduce((a, s) => a + s.changePct, 0) / Math.max(snaps.length, 1)).toFixed(2)),
      },
      gainers,
      losers,
      mostActive: active,
      sectorPerformance,
      updatedAt: Date.now(),
    };
  });

  app.get('/api/instruments', async () => {
    // If the API booted before market-data synced the seed into the DB, fall
    // back to a fresh DB read so consumers (incl. the CI UI snapshot) get the
    // full instrument list instead of [].
    const list = instruments.length
      ? instruments
      : (await query<Instrument>('SELECT * FROM instruments ORDER BY id')).rows;
    return list.map((inst) => {
      const snap = store.getSnapshot(inst.id);
      return {
        ...inst,
        price: snap?.price ?? inst.basePrice,
        changePct: snap?.changePct ?? 0,
        change: snap?.change ?? 0,
        dayHigh: snap?.dayHigh ?? inst.basePrice,
        dayLow: snap?.dayLow ?? inst.basePrice,
        dayVolume: snap?.dayVolume ?? 0,
      };
    });
  });

  app.get<{ Params: { symbol: string } }>('/api/instruments/:symbol', async (req, reply) => {
    const inst = bySymbol.get(req.params.symbol.toUpperCase());
    if (!inst) return reply.code(404).send({ error: 'instrument not found' });
    const snap = store.getSnapshot(inst.id);
    const fundamentals = (await query(
      `SELECT * FROM fundamentals WHERE instrument_id = $1`, [inst.id],
    )).rows[0] ?? null;
    return { instrument: inst, snapshot: snap ?? null, fundamentals };
  });

  // ---------------- candles + indicators ----------------
  app.get<{ Params: { symbol: string }; Querystring: { timeframe?: string; limit?: string } }>(
    '/api/instruments/:symbol/candles',
    async (req, reply) => {
      const inst = bySymbol.get(req.params.symbol.toUpperCase());
      if (!inst) return reply.code(404).send({ error: 'instrument not found' });
      const tf = (TIMEFRAMES.includes(req.query.timeframe as Timeframe) ? req.query.timeframe : '1m') as Timeframe;
      const limit = Math.min(Math.max(Number(req.query.limit ?? 300), 10), 2000);
      const res = await query<{ ts: string; open: number; high: number; low: number; close: number; volume: number }>(
        `SELECT ts, open, high, low, close, volume FROM candles
         WHERE instrument_id = $1 AND timeframe = $2 ORDER BY ts DESC LIMIT $3`,
        [inst.id, tf, limit],
      );
      const rows = res.rows.reverse();
      return {
        symbol: inst.symbol,
        timeframe: tf,
        candles: rows.map((r) => ({
          ts: new Date(r.ts).getTime(),
          open: fmtNum(r.open), high: fmtNum(r.high), low: fmtNum(r.low), close: fmtNum(r.close), volume: fmtNum(r.volume),
        })),
      };
    },
  );

  app.get<{ Params: { symbol: string }; Querystring: { timeframe?: string; limit?: string } }>(
    '/api/instruments/:symbol/indicators',
    async (req, reply) => {
      const inst = bySymbol.get(req.params.symbol.toUpperCase());
      if (!inst) return reply.code(404).send({ error: 'instrument not found' });
      const tf = (TIMEFRAMES.includes(req.query.timeframe as Timeframe) ? req.query.timeframe : '1m') as Timeframe;
      const limit = Math.min(Math.max(Number(req.query.limit ?? 300), 60), 2000);
      const res = await query<{ ts: string; open: number; high: number; low: number; close: number }>(
        `SELECT ts, open, high, low, close FROM candles
         WHERE instrument_id = $1 AND timeframe = $2 ORDER BY ts DESC LIMIT $3`,
        [inst.id, tf, limit],
      );
      const rows = res.rows.reverse();
      const closes = rows.map((r) => fmtNum(r.close));
      const ohlc = rows.map((r) => ({ high: fmtNum(r.high), low: fmtNum(r.low), close: fmtNum(r.close) }));

      const s20 = sma(closes, 20);
      const s50 = sma(closes, 50);
      const s200 = sma(closes, 200);
      const e12 = ema(closes, 12);
      const e26 = ema(closes, 26);
      const r14 = rsi(closes, 14);
      const macdArr = macd(closes, 12, 26, 9);
      const bb = bollinger(closes, 20, 2);
      const atrs = atr(ohlc, 14);
      const stoch = stochastic(ohlc, 14, 3, 3);
      const st = supertrend(ohlc, 10, 3);

      return {
        symbol: inst.symbol,
        timeframe: tf,
        ts: rows.map((r) => new Date(r.ts).getTime()),
        close: closes,
        sma20: s20,
        sma50: s50,
        sma200: s200,
        ema12: e12,
        ema26: e26,
        rsi: r14,
        macd: macdArr.map((x) => x.macd),
        macdSignal: macdArr.map((x) => x.signal),
        macdHist: macdArr.map((x) => x.histogram),
        bbUpper: bb.map((x) => x.upper),
        bbMiddle: bb.map((x) => x.middle),
        bbLower: bb.map((x) => x.lower),
        atr: atrs,
        stochK: stoch.map((x) => x.k),
        stochD: stoch.map((x) => x.d),
        stLine: st.map((x) => x.line),
        stDir: st.map((x) => x.direction),
      };
    },
  );

  // ---------------- fundamentals ----------------
  app.get<{ Params: { symbol: string } }>('/api/instruments/:symbol/fundamentals', async (req, reply) => {
    const inst = bySymbol.get(req.params.symbol.toUpperCase());
    if (!inst) return reply.code(404).send({ error: 'instrument not found' });
    const res = await query(
      `SELECT * FROM fundamentals WHERE instrument_id = $1`, [inst.id],
    );
    return res.rows[0] ?? { instrumentId: inst.id, message: 'not generated yet' };
  });

  app.get<{ Params: { symbol: string } }>('/api/instruments/:symbol/relations', async (req, reply) => {
    const inst = bySymbol.get(req.params.symbol.toUpperCase());
    if (!inst) return reply.code(404).send({ error: 'instrument not found' });
    const res = await query(
      `SELECT id, relation_type, entity_name, entity_symbol, weight, note
       FROM company_relations WHERE instrument_id = $1 ORDER BY weight DESC`,
      [inst.id],
    );
    return res.rows.map((r) => ({
      id: r.id, instrumentId: inst.id,
      relationType: r.relation_type, entityName: r.entity_name,
      entitySymbol: r.entity_symbol, weight: fmtNum(r.weight), note: r.note,
    }));
  });

  // ---------------- signals + news ----------------
  app.get<{ Params: { symbol: string }; Querystring: { limit?: string } }>(
    '/api/instruments/:symbol/signals',
    async (req, reply) => {
      const inst = bySymbol.get(req.params.symbol.toUpperCase());
      if (!inst) return reply.code(404).send({ error: 'instrument not found' });
      const limit = Math.min(Number(req.query.limit ?? 25), 100);
      const res = await query(
        `SELECT s.id, s.instrument_id, s.strategy, s.direction, s.price, s.strength, s.reason, s.indicator_snapshot, s.ts
         FROM signals s WHERE s.instrument_id = $1 ORDER BY s.ts DESC LIMIT $2`,
        [inst.id, limit],
      );
      return res.rows.map((r) => ({
        id: r.id, instrumentId: r.instrument_id, symbol: inst.symbol,
        strategy: r.strategy, direction: r.direction, price: fmtNum(r.price),
        strength: fmtNum(r.strength), reason: r.reason, indicatorSnapshot: r.indicator_snapshot,
        ts: new Date(r.ts).getTime(),
      }));
    },
  );

  app.get<{ Params: { symbol: string }; Querystring: { limit?: string } }>(
    '/api/instruments/:symbol/news',
    async (req, reply) => {
      const inst = bySymbol.get(req.params.symbol.toUpperCase());
      if (!inst) return reply.code(404).send({ error: 'instrument not found' });
      const limit = Math.min(Number(req.query.limit ?? 25), 100);
      const res = await query(
        `SELECT id, instrument_id, symbol, headline, summary, source, sentiment, impact, category, tags, event_time, published_at
         FROM news_events WHERE instrument_id = $1 ORDER BY published_at DESC LIMIT $2`,
        [inst.id, limit],
      );
      return res.rows.map((r) => ({
        id: r.id, instrumentId: r.instrument_id, symbol: r.symbol, headline: r.headline,
        summary: r.summary, source: r.source, sentiment: r.sentiment, impact: r.impact,
        category: r.category, tags: r.tags ?? [],
        eventTime: new Date(r.event_time).getTime(), publishedAt: new Date(r.published_at).getTime(),
      }));
    },
  );

  app.get<{ Querystring: { limit?: string; symbol?: string } }>('/api/signals', async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const symbol = req.query.symbol?.toUpperCase();
    const sql = symbol
      ? `SELECT s.id, s.instrument_id, s.strategy, s.direction, s.price, s.strength, s.reason, s.indicator_snapshot, s.ts, i.symbol
         FROM signals s JOIN instruments i ON i.id = s.instrument_id
         WHERE i.symbol = $1 ORDER BY s.ts DESC LIMIT $2`
      : `SELECT s.id, s.instrument_id, s.strategy, s.direction, s.price, s.strength, s.reason, s.indicator_snapshot, s.ts, i.symbol
         FROM signals s JOIN instruments i ON i.id = s.instrument_id
         ORDER BY s.ts DESC LIMIT $1`;
    const params = symbol ? [symbol, limit] : [limit];
    const res = await query(sql, params);
    return res.rows.map((r) => ({
      id: r.id, instrumentId: r.instrument_id, symbol: r.symbol,
      strategy: r.strategy, direction: r.direction, price: fmtNum(r.price),
      strength: fmtNum(r.strength), reason: r.reason, indicatorSnapshot: r.indicator_snapshot,
      ts: new Date(r.ts).getTime(),
    }));
  });

  app.get<{ Querystring: { limit?: string; symbol?: string; category?: string; sentiment?: string; impact?: string } }>(
    '/api/news',
    async (req) => {
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const where: string[] = [];
      const params: unknown[] = [];
      if (req.query.symbol) {
        params.push(req.query.symbol.toUpperCase());
        where.push(`symbol = $${params.length}`);
      }
      if (req.query.category) {
        params.push(req.query.category.toUpperCase());
        where.push(`category = $${params.length}`);
      }
      if (req.query.sentiment) {
        params.push(req.query.sentiment.toUpperCase());
        where.push(`sentiment = $${params.length}`);
      }
      if (req.query.impact) {
        params.push(req.query.impact.toUpperCase());
        where.push(`impact = $${params.length}`);
      }
      params.push(limit);
      const sql = `SELECT id, instrument_id, symbol, headline, summary, source, sentiment, impact, category, tags, event_time, published_at
                   FROM news_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                   ORDER BY published_at DESC LIMIT $${params.length}`;
      const res = await query(sql, params);
      return res.rows.map((r) => ({
        id: r.id, instrumentId: r.instrument_id, symbol: r.symbol, headline: r.headline,
        summary: r.summary, source: r.source, sentiment: r.sentiment, impact: r.impact,
        category: r.category, tags: r.tags ?? [],
        eventTime: new Date(r.event_time).getTime(), publishedAt: new Date(r.published_at).getTime(),
      }));
    },
  );

  // ---------------- portfolio (per-user; auth required) ----------------
  app.get('/api/portfolio', { preHandler: requireAuth }, async (req) => {
    const accountId = await ensureAccount(req.user!.id);
    const acc = (await query(
      'SELECT id, cash_balance, initial_capital, equity FROM accounts WHERE id = $1',
      [accountId],
    )).rows[0];
    const positions = (await query(
      `SELECT p.instrument_id, p.quantity, p.avg_price, p.realized_pnl
       FROM positions p WHERE p.account_id = $1 ORDER BY p.instrument_id`,
      [accountId],
    )).rows;
    const equityRows = (await query(
      `SELECT ts, equity FROM equity_curve WHERE account_id = $1 ORDER BY ts DESC LIMIT 500`,
      [accountId],
    )).rows.reverse();

    let invested = 0;
    let unrealized = 0;
    let dayPnl = 0;
    const posOut = positions.map((p) => {
      const inst = ctx.instruments.find((i) => i.id === Number(p.instrument_id));
      const snap = store.getSnapshot(Number(p.instrument_id));
      const lastPrice = snap?.price ?? inst?.basePrice ?? Number(p.avg_price);
      const mv = Number(p.quantity) * lastPrice;
      const upnl = (lastPrice - Number(p.avg_price)) * Number(p.quantity);
      const upnlPct = ((lastPrice - Number(p.avg_price)) / Number(p.avg_price)) * 100;
      const day = (lastPrice - (snap?.prevClose ?? lastPrice)) * Number(p.quantity);
      invested += mv;
      unrealized += upnl;
      dayPnl += day;
      return {
        instrumentId: Number(p.instrument_id),
        symbol: inst?.symbol ?? store.getSnapshot(Number(p.instrument_id))?.symbol ?? '?',
        name: inst?.name ?? null,
        sector: inst?.sector ?? null,
        quantity: Number(p.quantity),
        avgPrice: fmtNum(p.avg_price),
        lastPrice: fmtNum(lastPrice),
        marketValue: fmtNum(mv),
        unrealizedPnl: fmtNum(upnl),
        unrealizedPnlPct: fmtNum(upnlPct),
        realizedPnl: fmtNum(p.realized_pnl),
        dayPnl: fmtNum(day),
      };
    });

    const cash = fmtNum(acc.cash_balance);
    const equity = fmtNum(acc.equity);
    const initial = fmtNum(acc.initial_capital);
    const realized = posOut.reduce((a, p) => a + p.realizedPnl, 0);
    const totalPnl = equity - initial;

    return {
      account: { id: Number(acc.id), cash, initialCapital: initial, equity },
      summary: {
        invested: fmtNum(invested),
        unrealizedPnl: fmtNum(unrealized),
        realizedPnl: fmtNum(realized),
        dayPnl: fmtNum(dayPnl),
        totalPnl: fmtNum(totalPnl),
        totalPnlPct: fmtNum((totalPnl / initial) * 100),
        availableCash: cash,
      },
      positions: posOut,
      equityCurve: equityRows.map((r) => ({ ts: new Date(r.ts).getTime(), equity: fmtNum(r.equity) })),
    };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/orders', { preHandler: requireAuth }, async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const res = await query(
      `SELECT o.id, o.account_id, o.instrument_id, o.side, o.order_type, o.quantity, o.limit_price,
              o.status, o.filled_qty, o.avg_price, o.strategy, o.created_at, o.updated_at, i.symbol
       FROM orders o JOIN instruments i ON i.id = o.instrument_id
       WHERE o.user_id = $1
       ORDER BY o.created_at DESC LIMIT $2`,
      [req.user!.id, limit],
    );
    return res.rows.map((r) => ({
      id: Number(r.id), accountId: Number(r.account_id), instrumentId: Number(r.instrument_id),
      symbol: r.symbol, side: r.side, orderType: r.order_type, quantity: Number(r.quantity),
      limitPrice: r.limit_price == null ? null : fmtNum(r.limit_price),
      status: r.status, filledQty: Number(r.filled_qty),
      avgPrice: r.avg_price == null ? null : fmtNum(r.avg_price),
      strategy: r.strategy, createdAt: new Date(r.created_at).getTime(), updatedAt: new Date(r.updated_at).getTime(),
    }));
  });

  app.get<{ Querystring: { limit?: string } }>('/api/trades', { preHandler: requireAuth }, async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const res = await query(
      `SELECT t.id, t.order_id, t.instrument_id, t.side, t.quantity, t.price, t.realized_pnl, t.strategy, t.ts, i.symbol
       FROM trades t JOIN instruments i ON i.id = t.instrument_id
       WHERE t.user_id = $1
       ORDER BY t.ts DESC LIMIT $2`,
      [req.user!.id, limit],
    );
    return res.rows.map((r) => ({
      id: Number(r.id), orderId: r.order_id == null ? null : Number(r.order_id),
      instrumentId: Number(r.instrument_id), symbol: r.symbol, side: r.side,
      quantity: Number(r.quantity), price: fmtNum(r.price), realizedPnl: fmtNum(r.realized_pnl),
      strategy: r.strategy, ts: new Date(r.ts).getTime(),
    }));
  });

  // ---------------- trading (per-user; auth required) ----------------
  app.post<{ Body: { symbol: string; side: string; orderType?: string; quantity: number; limitPrice?: number } }>(
    '/api/orders',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { symbol, side, orderType = 'MARKET', quantity, limitPrice } = req.body ?? {};
      const inst = bySymbol.get((symbol ?? '').toUpperCase());
      if (!inst) return reply.code(404).send({ error: 'instrument not found' });
      if (!['BUY', 'SELL'].includes(side)) return reply.code(400).send({ error: 'side must be BUY or SELL' });
      if (!['MARKET', 'LIMIT'].includes(orderType)) return reply.code(400).send({ error: 'orderType must be MARKET or LIMIT' });
      const qty = Math.floor(Number(quantity));
      if (!Number.isFinite(qty) || qty <= 0) return reply.code(400).send({ error: 'quantity must be a positive integer' });
      if (orderType === 'LIMIT' && !Number.isFinite(Number(limitPrice))) {
        return reply.code(400).send({ error: 'limitPrice required for LIMIT orders' });
      }

      const accountId = await ensureAccount(req.user!.id);
      const res = await query<{ id: number }>(
        `INSERT INTO orders (account_id, user_id, instrument_id, side, order_type, quantity, limit_price, status, strategy)
         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', NULL) RETURNING id`,
        [accountId, req.user!.id, inst.id, side, orderType, qty, orderType === 'LIMIT' ? Number(limitPrice) : null],
      );
      const order: Order = {
        id: res.rows[0].id, accountId, userId: req.user!.id, instrumentId: inst.id, symbol: inst.symbol,
        side: side as Order['side'], orderType: orderType as Order['orderType'],
        quantity: qty, limitPrice: orderType === 'LIMIT' ? Number(limitPrice) : null,
        status: 'PENDING', filledQty: 0, avgPrice: null, strategy: null,
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      await publish(TOPICS.orders, order, { key: inst.symbol });
      return reply.code(201).send(order);
    },
  );

  // ---------------- algorithms ----------------
  app.get('/api/algorithms', async () => {
    const res = await query(
      'SELECT strategy, enabled, params FROM algorithm_configs ORDER BY id',
    );
    return res.rows.map((r) => ({ strategy: r.strategy, enabled: r.enabled, params: r.params }));
  });

  app.patch<{ Params: { strategy: string }; Body: { enabled?: boolean; params?: Record<string, number | boolean | string> } }>(
    '/api/algorithms/:strategy',
    async (req, reply) => {
      const strategy = req.params.strategy.toLowerCase();
      const existing = (await query(
        'SELECT enabled, params FROM algorithm_configs WHERE strategy = $1', [strategy],
      )).rows[0];
      if (!existing) return reply.code(404).send({ error: 'strategy not found' });
      const enabled = req.body?.enabled ?? existing.enabled;
      const params = req.body?.params ? { ...existing.params, ...req.body.params } : existing.params;
      await query(
        `UPDATE algorithm_configs SET enabled = $1, params = $2::jsonb, updated_at = now() WHERE strategy = $3`,
        [enabled, JSON.stringify(params), strategy],
      );
      return { strategy, enabled, params };
    },
  );

  // ---------------- watchlist (per-user rows; anonymous reads get [] and
  // fall back to the frontend's local list, which is the source of truth
  // on the static deploy) ----------------
  app.get('/api/watchlist', async (req) => {
    if (!req.user) return [];
    const res = await query<{ symbol: string }>(
      'SELECT symbol FROM watchlists WHERE user_id = $1 AND symbol IS NOT NULL ORDER BY created_at',
      [req.user.id],
    );
    // string[] — same contract as the serverless /api/watchlist (the
    // frontend merges this into its local list).
    return [...new Set(res.rows.map((r) => r.symbol.toUpperCase()))];
  });

  app.post<{ Params: { symbol: string } }>('/api/watchlist/:symbol', { preHandler: requireAuth }, async (req, reply) => {
    const inst = bySymbol.get(req.params.symbol.toUpperCase());
    if (!inst) return reply.code(404).send({ error: 'instrument not found' });
    await query(
      `INSERT INTO watchlists (user_id, symbol, name, instrument_ids)
       VALUES ($1, $2, 'Default', '{}')
       ON CONFLICT (user_id, symbol) DO NOTHING`,
      [req.user!.id, inst.symbol],
    );
    return { ok: true, symbol: inst.symbol };
  });

  app.delete<{ Params: { symbol: string } }>('/api/watchlist/:symbol', { preHandler: requireAuth }, async (req, reply) => {
    const inst = bySymbol.get(req.params.symbol.toUpperCase());
    if (!inst) return reply.code(404).send({ error: 'instrument not found' });
    await query('DELETE FROM watchlists WHERE user_id = $1 AND symbol = $2', [req.user!.id, inst.symbol]);
    return { ok: true, symbol: inst.symbol };
  });
}