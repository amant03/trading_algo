// TradeAlgo serverless account API — all trading routes in ONE function
// (Vercel Hobby caps 12 functions per deployment).
// Routes (via vercel.json rewrites, frontend paths unchanged):
//   GET  /api/portfolio        -> ?op=portfolio   (valued at live quotes;
//                                                 crossed LIMITs settle here)
//   POST /api/portfolio/reset  -> ?op=reset       (fresh Rs 1,00,000 start)
//   GET  /api/orders           -> ?op=orders      (settles crossed LIMITs too)
//   POST /api/orders           -> ?op=orders      {symbol,side,orderType?,quantity,limitPrice?}
//   GET  /api/trades           -> ?op=trades
// MARKET orders fill immediately at the live quote with 0.05% adverse
// slippage; marketable LIMITs fill at once, resting LIMITs stay PENDING.
// Long-only, max 15 distinct symbols, per-user Redis lock around mutations.
// Self-contained (see api/auth.ts header note). WebCrypto only — no node:
// imports, so this typechecks under the browser tsconfig.
declare const process: { env: Record<string, string | undefined> };

const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL ?? '').replace(/\/+$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? '';
const JWT_SECRET = process.env.JWT_SECRET ?? '';
const STARTING_CASH = 100_000;
const MAX_POSITIONS = 15;
const SLIPPAGE = 0.0005;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const UNIVERSE_URL = 'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/universe.json';

function storeReady(): boolean {
  return Boolean(UPSTASH_URL && UPSTASH_TOKEN && JWT_SECRET);
}
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
function err(message: string, status: number): Response {
  return json({ error: message }, status);
}
function notConfigured(): Response {
  return err('account service is not configured yet — the store credentials are missing', 503);
}
async function rdb<T>(cmd: Array<string | number>): Promise<T | null> {
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([cmd]),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`store ${res.status}`);
  const arr = (await res.json()) as Array<{ result: T }>;
  return arr?.[0]?.result ?? null;
}
async function rget<T>(key: string): Promise<T | null> {
  const v = await rdb<string>(['GET', key]);
  if (v == null) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}
async function rset(key: string, value: unknown): Promise<void> {
  await rdb(['SET', key, JSON.stringify(value)]);
}
function unb64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
async function authClaim(req: Request): Promise<{ id: number; email: string } | null> {
  try {
    const h = req.headers.get('authorization') ?? '';
    if (!h.startsWith('Bearer ')) return null;
    const parts = h.slice('Bearer '.length).trim().split('.');
    if (parts.length !== 3) return null;
    const [hh, p, s] = parts;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    const ok = await crypto.subtle.verify('HMAC', key, unb64url(s) as BufferSource, new TextEncoder().encode(`${hh}.${p}`));
    if (!ok) return null;
    const bin = atob(p.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(bin) as { sub: number; email: string; exp: number };
    if (typeof claims.sub !== 'number' || typeof claims.exp !== 'number') return null;
    if (claims.exp * 1000 < Date.now()) return null;
    return { id: claims.sub, email: claims.email };
  } catch {
    return null;
  }
}

interface Acct { cash: number; initial: number; equity: number }
interface PosState { symbol: string; qty: number; avg: number; realized: number }
interface OrderState {
  id: number; accountId: number; instrumentId: number; symbol: string;
  side: 'BUY' | 'SELL'; orderType: 'MARKET' | 'LIMIT'; quantity: number;
  limitPrice: number | null; status: string; filledQty: number;
  avgPrice: number | null; strategy: string | null; createdAt: number; updatedAt: number;
}
interface TradeState {
  id: number; orderId: number | null; instrumentId: number; symbol: string;
  side: string; quantity: number; price: number; realizedPnl: number | null;
  strategy: string | null; ts: number;
}
interface Book { acct: Acct; positions: PosState[]; orders: OrderState[]; trades: TradeState[]; equity: Array<{ ts: number; equity: number }> }

function round2(n: number): number { return Math.round(n * 100) / 100; }
function symId(symbol: string): number {
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}
async function loadBook(uid: number): Promise<Book> {
  const [a, p, o, t, e] = await Promise.all([
    rget<Acct>(`ta:acct:${uid}`),
    rget<PosState[]>(`ta:pos:${uid}`),
    rget<OrderState[]>(`ta:ord:${uid}`),
    rget<TradeState[]>(`ta:trd:${uid}`),
    rget<Array<{ ts: number; equity: number }>>(`ta:eq:${uid}`),
  ]);
  return {
    acct: a ?? { cash: STARTING_CASH, initial: STARTING_CASH, equity: STARTING_CASH },
    positions: p ?? [], orders: o ?? [], trades: t ?? [], equity: e ?? [],
  };
}
async function saveBook(uid: number, b: Book): Promise<void> {
  await rset(`ta:acct:${uid}`, b.acct);
  await rset(`ta:pos:${uid}`, b.positions);
  await rset(`ta:ord:${uid}`, b.orders.slice(0, 200));
  await rset(`ta:trd:${uid}`, b.trades.slice(0, 500));
  await rset(`ta:eq:${uid}`, b.equity.slice(-500));
}
async function acquireLock(uid: number): Promise<boolean> {
  const r = await rdb<string>(['SET', `ta:lock:${uid}`, String(Date.now()), 'NX', 'EX', 10]);
  return r === 'OK';
}
async function releaseLock(uid: number): Promise<void> {
  try { await rdb(['DEL', `ta:lock:${uid}`]); } catch { /* best effort */ }
}
async function quoteOf(symbol: string): Promise<{ price: number; prev: number } | null> {
  for (const host of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
    try {
      const res = await fetch(`${host}/v8/finance/chart/${encodeURIComponent(symbol)}.NS?range=5d&interval=1d`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { chart?: { result?: Array<{ indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } };
      const arr = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
      const nums = arr.filter((v): v is number => typeof v === 'number' && isFinite(v) && v > 0);
      if (nums.length) return { price: nums[nums.length - 1], prev: nums.length > 1 ? nums[nums.length - 2] : nums[nums.length - 1] };
    } catch { /* next host */ }
  }
  return null;
}
async function quotesFor(symbols: string[]): Promise<Map<string, { price: number; prev: number }>> {
  const out = new Map<string, { price: number; prev: number }>();
  await Promise.all(symbols.map(async (s) => {
    const q = await quoteOf(s);
    if (q) out.set(s, q);
  }));
  return out;
}

let uniCache: { at: number; bySym: Map<string, string> } | null = null;
async function symbolName(sym: string): Promise<string> {
  const up = sym.toUpperCase();
  const now = Date.now();
  if (!uniCache || now - uniCache.at > 10 * 60_000) {
    try {
      const res = await fetch(UNIVERSE_URL, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const j = (await res.json()) as { stocks?: Array<{ symbol: string; name: string }> };
        const m = new Map<string, string>();
        for (const s of j.stocks ?? []) m.set(String(s.symbol).toUpperCase(), String(s.name ?? s.symbol));
        uniCache = { at: now, bySym: m };
      }
    } catch { /* keep stale/empty */ }
  }
  return uniCache?.bySym.get(up) ?? up;
}
async function symbolKnown(sym: string): Promise<boolean> {
  await symbolName(sym);
  if (!uniCache) return true;
  return uniCache.bySym.has(sym.toUpperCase());
}

function fillOne(b: Book, order: OrderState, fillPx: number): void {
  const now = Date.now();
  const px = round2(fillPx);
  let realized: number | null = null;
  if (order.side === 'BUY') {
    b.acct.cash = round2(b.acct.cash - round2(px * order.quantity));
    let p = b.positions.find((x) => x.symbol === order.symbol);
    if (!p) {
      p = { symbol: order.symbol, qty: 0, avg: 0, realized: 0 };
      b.positions.push(p);
    }
    p.avg = round2((p.avg * p.qty + px * order.quantity) / (p.qty + order.quantity));
    p.qty += order.quantity;
  } else {
    const p = b.positions.find((x) => x.symbol === order.symbol);
    b.acct.cash = round2(b.acct.cash + round2(px * order.quantity));
    if (p) {
      realized = round2((px - p.avg) * order.quantity);
      p.qty -= order.quantity;
      p.realized = round2(p.realized + realized);
      if (p.qty <= 0) b.positions.splice(b.positions.indexOf(p), 1);
    } else {
      realized = 0;
    }
  }
  const nextTid = b.trades.reduce((m, t) => Math.max(m, t.id), 0) + 1;
  b.trades.unshift({
    id: nextTid, orderId: order.id, instrumentId: order.instrumentId, symbol: order.symbol,
    side: order.side, quantity: order.quantity, price: px, realizedPnl: realized,
    strategy: null, ts: now,
  });
  order.status = 'FILLED';
  order.filledQty = order.quantity;
  order.avgPrice = px;
  order.updatedAt = now;
}

async function pushEquityPoint(uid: number, b: Book): Promise<void> {
  const held = [...new Set(b.positions.map((p) => p.symbol))];
  const marks = new Map<string, number>();
  await Promise.all(held.map(async (s) => {
    const q = await quoteOf(s);
    if (q) marks.set(s, q.price);
  }));
  const eq = round2(b.acct.cash + b.positions.reduce((sum, p) => sum + p.qty * (marks.get(p.symbol) ?? p.avg), 0));
  b.acct.equity = eq;
  b.equity.push({ ts: Date.now(), equity: eq });
  await saveBook(uid, b);
}

/** Fill every crossed resting LIMIT. Returns true if anything changed. */
async function settleLimits(b: Book): Promise<boolean> {
  const pending = b.orders.filter((o) => o.status === 'PENDING' && o.orderType === 'LIMIT' && o.limitPrice != null);
  if (!pending.length) return false;
  let changed = false;
  for (const o of pending) {
    const q = await quoteOf(o.symbol);
    if (!q) continue;
    const crossed = o.side === 'BUY' ? q.price <= (o.limitPrice as number) : q.price >= (o.limitPrice as number);
    if (!crossed) continue;
    if (o.side === 'BUY') {
      const fillPx = Math.min(q.price, o.limitPrice as number) * (1 + SLIPPAGE);
      if (b.acct.cash < fillPx * o.quantity) continue;
      fillOne(b, o, fillPx);
    } else {
      const p = b.positions.find((x) => x.symbol === o.symbol);
      if (!p || p.qty < o.quantity) continue;
      fillOne(b, o, Math.max(q.price, o.limitPrice as number) * (1 - SLIPPAGE));
    }
    changed = true;
  }
  return changed;
}

async function buildPortfolio(uid: number): Promise<object> {
  const b = await loadBook(uid);
  if (await settleLimits(b)) await pushEquityPoint(uid, b);
  else await saveBook(uid, b);
  const heldSyms = [...new Set(b.positions.map((p) => p.symbol))];
  const marks = await quotesFor(heldSyms);
  const names = new Map<string, string>();
  await Promise.all(heldSyms.map(async (s) => names.set(s, await symbolName(s))));
  const positions = b.positions.map((p) => {
    const q = marks.get(p.symbol);
    const last = q?.price ?? p.avg;
    const prev = q?.prev ?? last;
    const mv = round2(p.qty * last);
    const upnl = round2((last - p.avg) * p.qty);
    return {
      instrumentId: symId(p.symbol),
      symbol: p.symbol,
      name: names.get(p.symbol) ?? null,
      sector: null,
      quantity: p.qty,
      avgPrice: p.avg,
      lastPrice: round2(last),
      marketValue: mv,
      unrealizedPnl: upnl,
      unrealizedPnlPct: p.avg > 0 ? round2(((last - p.avg) / p.avg) * 100) : 0,
      realizedPnl: p.realized,
      dayPnl: round2((last - prev) * p.qty),
    };
  });
  const equity = round2(b.acct.cash + positions.reduce((s, p) => s + p.marketValue, 0));
  b.acct.equity = equity;
  await saveBook(uid, b);
  const initial = b.acct.initial > 0 ? b.acct.initial : STARTING_CASH;
  const unrealized = round2(positions.reduce((s, p) => s + p.unrealizedPnl, 0));
  const realized = round2(positions.reduce((s, p) => s + p.realizedPnl, 0));
  const day = round2(positions.reduce((s, p) => s + p.dayPnl, 0));
  const invested = round2(positions.reduce((s, p) => s + p.marketValue, 0));
  const totalPnl = round2(equity - initial);
  return {
    account: { id: uid, cash: b.acct.cash, initialCapital: initial, equity },
    summary: {
      invested,
      unrealizedPnl: unrealized,
      realizedPnl: realized,
      dayPnl: day,
      totalPnl,
      totalPnlPct: round2((totalPnl / initial) * 100),
      availableCash: b.acct.cash,
    },
    positions,
    equityCurve: b.equity.slice(-500),
  };
}

async function handlePlaceOrder(uid: number, request: Request): Promise<Response> {
  let body: { symbol?: string; side?: string; orderType?: string; quantity?: number; limitPrice?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return err('invalid request body', 400);
  }
  const symbol = (body.symbol ?? '').trim().toUpperCase();
  const side = (body.side ?? '').toUpperCase();
  const orderType = ((body.orderType ?? 'MARKET') + '').toUpperCase();
  const qty = Math.floor(Number(body.quantity));
  if (!symbol) return err('symbol required', 400);
  if (side !== 'BUY' && side !== 'SELL') return err('side must be BUY or SELL', 400);
  if (orderType !== 'MARKET' && orderType !== 'LIMIT') return err('orderType must be MARKET or LIMIT', 400);
  if (!Number.isFinite(qty) || qty <= 0) return err('quantity must be a positive integer', 400);
  if (orderType === 'LIMIT' && !Number.isFinite(Number(body.limitPrice))) {
    return err('limitPrice required for LIMIT orders', 400);
  }
  try {
    if (!(await symbolKnown(symbol))) return err('instrument not found', 404);
  } catch {
    return err('request failed — please try again', 500);
  }
  if (!(await acquireLock(uid))) return err('your portfolio is busy — retry in a few seconds', 429);
  try {
    const b = await loadBook(uid);
    const now = Date.now();
    const order: OrderState = {
      id: b.orders.reduce((m, o) => Math.max(m, o.id), 0) + 1,
      accountId: uid, instrumentId: symId(symbol), symbol,
      side: side as 'BUY' | 'SELL', orderType: orderType as 'MARKET' | 'LIMIT',
      quantity: qty, limitPrice: orderType === 'LIMIT' ? Number(body.limitPrice) : null,
      status: 'PENDING', filledQty: 0, avgPrice: null, strategy: null,
      createdAt: now, updatedAt: now,
    };
    const q = await quoteOf(symbol);
    const marketable =
      orderType === 'MARKET' ||
      (q != null && (side === 'BUY' ? (order.limitPrice as number) >= q.price : (order.limitPrice as number) <= q.price));
    if (marketable) {
      if (!q) {
        await releaseLock(uid);
        return err('live price unavailable right now — try again in a few seconds', 503);
      }
      const fillPx = orderType === 'MARKET'
        ? (side === 'BUY' ? q.price * (1 + SLIPPAGE) : q.price * (1 - SLIPPAGE))
        : side === 'BUY'
          ? Math.min(q.price, order.limitPrice as number) * (1 + SLIPPAGE)
          : Math.max(q.price, order.limitPrice as number) * (1 - SLIPPAGE);
      if (side === 'BUY') {
        const heldSyms = new Set(b.positions.map((p) => p.symbol));
        if (!heldSyms.has(symbol) && heldSyms.size >= MAX_POSITIONS) {
          order.status = 'REJECTED';
          b.orders.unshift(order);
          await saveBook(uid, b);
          await releaseLock(uid);
          return err(`rejected: you already hold the maximum of ${MAX_POSITIONS} positions — sell something first`, 400);
        }
        if (b.acct.cash < fillPx * qty) {
          order.status = 'REJECTED';
          b.orders.unshift(order);
          await saveBook(uid, b);
          await releaseLock(uid);
          return err(`rejected: this costs about ₹${Math.round(fillPx * qty).toLocaleString('en-IN')} but you have ₹${Math.round(b.acct.cash).toLocaleString('en-IN')} cash`, 400);
        }
      } else {
        const p = b.positions.find((x) => x.symbol === symbol);
        if (!p || p.qty < qty) {
          order.status = 'REJECTED';
          b.orders.unshift(order);
          await saveBook(uid, b);
          await releaseLock(uid);
          return err(`rejected: you hold ${p?.qty ?? 0} ${symbol} — short selling is not allowed in paper trading`, 400);
        }
      }
      fillOne(b, order, fillPx);
      b.orders.unshift(order);
      await pushEquityPoint(uid, b);
      await releaseLock(uid);
      return json(order, 201);
    }
    b.orders.unshift(order);
    await saveBook(uid, b);
    await releaseLock(uid);
    return json(order, 201);
  } catch {
    await releaseLock(uid);
    return err('request failed — please try again', 500);
  }
}

function opOf(request: Request): string {
  const url = new URL(request.url);
  const byQuery = (url.searchParams.get('op') ?? '').toLowerCase();
  if (byQuery) return byQuery;
  const m = url.pathname.match(/\/api\/(portfolio|orders|trades)(?:\/([^\/?#]+))?/i);
  if (!m) return '';
  if (m[1].toLowerCase() === 'portfolio' && (m[2] ?? '').toLowerCase() === 'reset') return 'reset';
  return m[1].toLowerCase();
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!storeReady()) return notConfigured();
  const claim = await authClaim(request);
  if (!claim) return err('authentication required', 401);
  const op = opOf(request);
  try {
    if (op === 'portfolio') return json(await buildPortfolio(claim.id));
    if (op === 'orders' || op === 'trades') {
      const url = new URL(request.url);
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 200);
      const b = await loadBook(claim.id);
      if (op === 'orders' && (await settleLimits(b))) await pushEquityPoint(claim.id, b);
      else await saveBook(claim.id, b);
      return json((op === 'orders' ? b.orders : b.trades).slice(0, limit));
    }
    return err('not found', 404);
  } catch {
    return err('request failed — please try again', 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!storeReady()) return notConfigured();
  const claim = await authClaim(request);
  if (!claim) return err('authentication required', 401);
  const op = opOf(request);
  try {
    if (op === 'orders') return handlePlaceOrder(claim.id, request);
    if (op === 'reset') {
      await rset(`ta:acct:${claim.id}`, { cash: STARTING_CASH, initial: STARTING_CASH, equity: STARTING_CASH });
      await rset(`ta:pos:${claim.id}`, []);
      await rset(`ta:ord:${claim.id}`, []);
      await rset(`ta:trd:${claim.id}`, []);
      await rset(`ta:eq:${claim.id}`, []);
      return json({ ok: true, cash: STARTING_CASH });
    }
    return err('not found', 404);
  } catch {
    return err('request failed — please try again', 500);
  }
}
