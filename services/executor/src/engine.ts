import {
  Order,
  Position,
  Signal,
  Snapshot,
  Trade,
  withTransaction,
  query,
  publishBatch,
  TOPICS,
  logger,
  round2,
  round4,
} from '@trading/shared';

const ACCOUNT_ID = 1;
const AUTO_RISK_PCT = 0.03; // per-auto-trade notional as % of equity
const MAX_POSITIONS = 15; // cap concurrent auto positions
const SLIPPAGE = 0.0005; // adverse slippage on market fills

interface PositionRow {
  instrumentId: number;
  quantity: number;
  avgPrice: number;
  realizedPnl: number;
}

interface LimitOrder {
  order: Order;
  triggerPrice: number;
}

export class PaperBroker {
  cash = 0;
  initialCapital = 0;
  equity = 0;
  realizedPnl = 0;
  lastPrices = new Map<number, number>();
  positions = new Map<number, PositionRow>();
  limitOrders: LimitOrder[] = [];
  private lastEquitySave = 0;
  private symbols = new Map<number, string>();

  setSymbols(map: Map<number, string>): void {
    this.symbols = map;
  }

  symbolOf(instrumentId: number): string {
    return this.symbols.get(instrumentId) ?? `SYMBOL_${instrumentId}`;
  }

  async init(): Promise<void> {
    await query(
      `INSERT INTO accounts (id, name, cash_balance, initial_capital, equity)
       VALUES ($1, 'Paper Account', 1000000, 1000000, 1000000)
       ON CONFLICT (id) DO NOTHING`,
      [ACCOUNT_ID],
    );
    const acc = (await query<{ cash_balance: number; initial_capital: number; equity: number }>(
      'SELECT cash_balance, initial_capital, equity FROM accounts WHERE id = $1',
      [ACCOUNT_ID],
    )).rows[0];
    this.cash = Number(acc.cash_balance);
    this.initialCapital = Number(acc.initial_capital);
    this.equity = Number(acc.equity);

    const pos = (await query<{ instrument_id: number; quantity: number; avg_price: number; realized_pnl: number }>(
      'SELECT instrument_id, quantity, avg_price, realized_pnl FROM positions WHERE account_id = $1 AND quantity != 0',
      [ACCOUNT_ID],
    )).rows;
    for (const p of pos) {
      this.positions.set(Number(p.instrument_id), {
        instrumentId: Number(p.instrument_id),
        quantity: Number(p.quantity),
        avgPrice: Number(p.avg_price),
        realizedPnl: Number(p.realized_pnl),
      });
      this.realizedPnl += Number(p.realized_pnl);
    }
    logger.info({ cash: this.cash, positions: this.positions.size }, 'paper broker initialised');
  }

  applySnapshot(snapshot: Snapshot): void {
    this.lastPrices.set(snapshot.instrumentId, snapshot.price);
    this.checkLimitOrders();
  }

  /** Recompute equity = cash + mark-to-market positions. Returns true if changed. */
  recomputeEquity(): number {
    let invested = 0;
    for (const pos of this.positions.values()) {
      const price = this.lastPrices.get(pos.instrumentId) ?? pos.avgPrice;
      invested += pos.quantity * price;
    }
    const equity = round2(this.cash + invested);
    if (equity !== this.equity) this.equity = equity;
    return equity;
  }

  async maybeSaveEquity(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastEquitySave < 5000) return;
    this.lastEquitySave = now;
    this.recomputeEquity();
    await query(
      'INSERT INTO equity_curve (account_id, ts, equity) VALUES ($1, to_timestamp($2/1000.0), $3)',
      [ACCOUNT_ID, now, this.equity],
    );
    await query('UPDATE accounts SET cash_balance = $1, equity = $2 WHERE id = $3', [this.cash, this.equity, ACCOUNT_ID]);
    await publishBatch(TOPICS.equity, [{ payload: { accountId: ACCOUNT_ID, ts: now, equity: this.equity, cash: this.cash }, key: 'account' }]);
  }

  /** Process an auto-generated algorithm signal. */
  async onSignal(signal: Signal): Promise<void> {
    const price = this.lastPrices.get(signal.instrumentId) ?? signal.price;
    const pos = this.positions.get(signal.instrumentId);

    if (signal.direction === 'BUY') {
      if (pos && pos.quantity > 0) return; // already long, no pyramiding
      if (this.positions.size >= MAX_POSITIONS) return; // portfolio cap reached
      const notional = this.equity * AUTO_RISK_PCT;
      let qty = Math.max(1, Math.floor(notional / price));
      qty = Math.min(qty, Math.floor(this.cash / price));
      if (qty <= 0) {
        logger.warn({ symbol: signal.symbol }, 'insufficient cash for auto BUY');
        return;
      }
      const order: Order = {
        id: 0, accountId: ACCOUNT_ID, instrumentId: signal.instrumentId, symbol: signal.symbol,
        side: 'BUY', orderType: 'MARKET', quantity: qty, limitPrice: null,
        status: 'PENDING', filledQty: 0, avgPrice: null, strategy: signal.strategy,
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      const created = await this.createOrder(order);
      await this.fillOrder(created, price);
    } else if (signal.direction === 'SELL') {
      if (!pos || pos.quantity <= 0) return;
      const order: Order = {
        id: 0, accountId: ACCOUNT_ID, instrumentId: signal.instrumentId, symbol: signal.symbol,
        side: 'SELL', orderType: 'MARKET', quantity: pos.quantity, limitPrice: null,
        status: 'PENDING', filledQty: 0, avgPrice: null, strategy: signal.strategy,
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      const created = await this.createOrder(order);
      await this.fillOrder(created, price);
    }
  }

  /** Process a manual order from the API. */
  async onOrder(order: Order): Promise<void> {
    if (order.orderType === 'MARKET') {
      const price = this.lastPrices.get(order.instrumentId) ?? order.limitPrice ?? 0;
      await this.fillOrder(order, price);
    } else {
      // LIMIT order: store and wait for price
      await query(
        `UPDATE orders SET status = 'PENDING' WHERE id = $1`,
        [order.id],
      );
      this.limitOrders.push({ order, triggerPrice: order.limitPrice ?? 0 });
      await publishBatch(TOPICS.orders, [{ payload: { ...order, status: 'PENDING' }, key: order.symbol }]);
    }
  }

  private checkLimitOrders(): void {
    const remaining: LimitOrder[] = [];
    for (const lo of this.limitOrders) {
      const price = this.lastPrices.get(lo.order.instrumentId);
      if (price == null) { remaining.push(lo); continue; }
      const crossed =
        lo.order.side === 'BUY' ? price <= lo.triggerPrice : price >= lo.triggerPrice;
      if (crossed) {
        this.fillOrder(lo.order, price).catch((err) =>
          logger.error({ err: (err as Error).message, symbol: lo.order.symbol }, 'limit fill failed'),
        );
      } else {
        remaining.push(lo);
      }
    }
    this.limitOrders = remaining;
  }

  /** Insert an order row and return it with a real id. */
  async createOrder(order: Omit<Order, 'id'>): Promise<Order> {
    const res = await query<{ id: number }>(
      `INSERT INTO orders (account_id, instrument_id, side, order_type, quantity, limit_price, status, strategy)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [ACCOUNT_ID, order.instrumentId, order.side, order.orderType, order.quantity, order.limitPrice, 'PENDING', order.strategy],
    );
    return { ...order, id: res.rows[0].id };
  }

  /** Core fill logic — atomic transaction updating cash, positions, order, trades. */
  async fillOrder(order: Order, marketPrice: number): Promise<void> {
    const price = round4(marketPrice * (1 + (order.side === 'BUY' ? SLIPPAGE : -SLIPPAGE)));

    await withTransaction(async (client) => {
      const current = (await client.query<{ status: string }>(
        'SELECT status FROM orders WHERE id = $1', [order.id],
      )).rows[0];
      if (!current || current.status === 'FILLED' || current.status === 'CANCELLED') return;

      if (order.side === 'BUY') {
        const cost = order.quantity * price;
        if (this.cash < cost) {
          await client.query(`UPDATE orders SET status = 'REJECTED', updated_at = now() WHERE id = $1`, [order.id]);
          throw new Error(`insufficient funds: need ${cost.toFixed(2)}, have ${this.cash.toFixed(2)}`);
        }
        this.cash = round2(this.cash - cost);
        const pos = this.positions.get(order.instrumentId);
        if (pos) {
          const totalQty = pos.quantity + order.quantity;
          pos.avgPrice = round4((pos.avgPrice * pos.quantity + price * order.quantity) / totalQty);
          pos.quantity = totalQty;
        } else {
          this.positions.set(order.instrumentId, {
            instrumentId: order.instrumentId, quantity: order.quantity, avgPrice: price, realizedPnl: 0,
          });
        }
        const p = this.positions.get(order.instrumentId)!;
        await client.query(
          `INSERT INTO positions (account_id, instrument_id, quantity, avg_price)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (account_id, instrument_id) DO UPDATE SET
             quantity = EXCLUDED.quantity, avg_price = EXCLUDED.avg_price, updated_at = now()`,
          [ACCOUNT_ID, order.instrumentId, p.quantity, p.avgPrice],
        );
        await client.query(
          `INSERT INTO trades (order_id, account_id, instrument_id, side, quantity, price, realized_pnl, strategy, ts)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
          [order.id, ACCOUNT_ID, order.instrumentId, order.side, order.quantity, price, 0, order.strategy],
        );
      } else {
        const pos = this.positions.get(order.instrumentId);
        if (!pos || pos.quantity < order.quantity) {
          await client.query(`UPDATE orders SET status = 'REJECTED', updated_at = now() WHERE id = $1`, [order.id]);
          throw new Error('insufficient position for SELL');
        }
        const proceeds = order.quantity * price;
        const pnl = round2((price - pos.avgPrice) * order.quantity);
        pos.quantity -= order.quantity;
        pos.realizedPnl = round2(pos.realizedPnl + pnl);
        this.realizedPnl = round2(this.realizedPnl + pnl);
        this.cash = round2(this.cash + proceeds);
        if (pos.quantity <= 0) {
          this.positions.delete(order.instrumentId);
          await client.query('DELETE FROM positions WHERE account_id = $1 AND instrument_id = $2', [ACCOUNT_ID, order.instrumentId]);
        } else {
          await client.query(
            `UPDATE positions SET quantity = $1, realized_pnl = $2, updated_at = now() WHERE account_id = $3 AND instrument_id = $4`,
            [pos.quantity, pos.realizedPnl, ACCOUNT_ID, order.instrumentId],
          );
        }
        await client.query(
          `INSERT INTO trades (order_id, account_id, instrument_id, side, quantity, price, realized_pnl, strategy, ts)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
          [order.id, ACCOUNT_ID, order.instrumentId, order.side, order.quantity, price, pnl, order.strategy],
        );
      }

      await client.query(
        `UPDATE orders SET status = 'FILLED', filled_qty = $1, avg_price = $2, updated_at = now() WHERE id = $3`,
        [order.quantity, price, order.id],
      );
      await client.query(
        `UPDATE accounts SET cash_balance = $1, equity = $2 WHERE id = $3`,
        [this.cash, this.cash, ACCOUNT_ID],
      );
    });

    this.recomputeEquity();
    const filled: Order = { ...order, status: 'FILLED', filledQty: order.quantity, avgPrice: price, updatedAt: Date.now() };
    const trade: Trade = {
      id: 0, orderId: order.id, accountId: ACCOUNT_ID, instrumentId: order.instrumentId,
      symbol: this.symbolOf(order.instrumentId), side: order.side, quantity: order.quantity,
      price, realizedPnl: order.side === 'SELL' ? round2((price - (order.avgPrice ?? 0)) * order.quantity) : 0,
      strategy: order.strategy, ts: Date.now(),
    };
    await publishBatch(TOPICS.orders, [{ payload: filled, key: filled.symbol }]);
    await publishBatch(TOPICS.trades, [{ payload: trade, key: trade.symbol }]);
    await this.maybeSaveEquity();
    logger.info({ symbol: filled.symbol, side: filled.side, qty: filled.quantity, price, strategy: filled.strategy ?? 'manual' }, 'order filled');
  }
}
