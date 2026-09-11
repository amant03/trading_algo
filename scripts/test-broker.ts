import { pool, query } from '@trading/shared';
import { PaperBroker } from '../services/executor/src/engine.js';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`ok   ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}`, extra ?? '');
  }
}

async function main(): Promise<void> {
  // create an isolated test user + account (no Kafka paths touched below)
  const email = `brokertest${Date.now()}@example.com`;
  const u = await query<{ id: number }>(
    `INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', 'Broker Test') RETURNING id`,
    [email],
  );
  const userId = Number(u.rows[0].id);
  const a = await query<{ id: number }>(
    `INSERT INTO accounts (user_id, name, cash_balance, initial_capital, equity)
     VALUES ($1, 'Broker Test Paper Account', 100000, 100000, 100000) RETURNING id`,
    [userId],
  );
  const accountId = Number(a.rows[0].id);

  // need a real instrument for FK constraints
  const inst = await query<{ id: number; symbol: string }>(
    `SELECT id, symbol FROM instruments WHERE status = 'ACTIVE' ORDER BY id LIMIT 1`,
  );
  const instrumentId = Number(inst.rows[0].id);
  const symbol = inst.rows[0].symbol as string;

  const broker = new PaperBroker(accountId, userId);
  broker.setSymbols(new Map([[instrumentId, symbol]]));
  await broker.init();
  check('broker init loads fresh cash', broker.cash === 100000 && broker.equity === 100000);

  const created = await broker.createOrder({
    accountId, userId, instrumentId, symbol, side: 'BUY', orderType: 'LIMIT',
    quantity: 2, limitPrice: 10, status: 'PENDING', filledQty: 0, avgPrice: null,
    strategy: null, createdAt: Date.now(), updatedAt: Date.now(),
  });
  check('createOrder writes user_id + account_id', created.id > 0);
  const row = await query<{ account_id: number; user_id: number }>(
    'SELECT account_id, user_id FROM orders WHERE id = $1', [created.id],
  );
  check(
    'order row scoped to user account',
    Number(row.rows[0].account_id) === accountId && Number(row.rows[0].user_id) === userId,
    row.rows[0],
  );

  // LIMIT path: no Kafka publish involved, exercises routing + persistence
  await broker.onOrder({ ...created, limitPrice: 10 });
  check('limit order parked in memory', broker.limitOrders.length === 1);
  const st = await query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [created.id]);
  check('limit order still PENDING in db', st.rows[0].status === 'PENDING');

  // legacy broker untouched by user init
  const legacy = new PaperBroker(1, null);
  legacy.setSymbols(new Map([[instrumentId, symbol]]));
  await legacy.init();
  check('legacy broker init ok', legacy.cash >= 0);

  // isolation: user broker holds no legacy positions and vice versa
  check('user broker starts flat', broker.positions.size === 0);

  // cleanup (cascades via users FK)
  await query('DELETE FROM orders WHERE id = $1', [created.id]);
  await query('DELETE FROM users WHERE id = $1', [userId]);
  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
  await pool.end();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => void 0);
  process.exit(1);
});
