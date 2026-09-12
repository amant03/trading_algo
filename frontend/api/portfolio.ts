// TradeAlgo serverless account API — GET /api/portfolio.
// Per-user paper portfolio valued at live Yahoo quotes, with resting LIMIT
// orders settled on every read (crossed limits fill; nothing needs a cron).
// Self-contained (see api/auth/signup.ts header note). Upstash Redis + JWT.
import { createHmac, timingSafeEqual } from 'node:crypto';

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
function b64url(input: string | Buffer): string {
  return Buffer.from(input as never)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function authClaim(req: Request): { id: number; email: string } | null {
  try {
    const h = req.headers.get('authorization') ?? '';
    if (!h.startsWith('Bearer ')) return null;
    const parts = h.slice('Bearer '.length).trim().split('.');
    if (parts.length !== 3) return null;
    const [hh, p, s] = parts;
    const expected = b64url(createHmac('sha256', JWT_SECRET).update(`${hh}.${p}`).digest());
    const a = Buffer.from(s);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const claims = JSON.parse(Buffer.from(p, 'base64').toString('utf8')) as { sub: number; email: string; exp: number };
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
export function fillOne(b: Book, order: OrderState, fillPx: number): void {
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
export function withSlip(side: 'BUY' | 'SELL', live: number): number {
  return side === 'BUY' ? live * (1 + SLIPPAGE) : live * (1 - SLIPPAGE);
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

/** Settle resting LIMITs, value everything at live marks, persist. Shared by portfolio + orders reads. */
export async function settleAndValue(uid: number, doSettle: boolean): Promise<{
  acct: Acct;
  positions: Array<{
    instrumentId: number; symbol: string; name: string | null; sector: string | null;
    quantity: number; avgPrice: number; lastPrice: number; marketValue: number;
    unrealizedPnl: number; unrealizedPnlPct: number; realizedPnl: number; dayPnl: number;
  }>;
  equityCurve: Array<{ ts: number; equity: number }>;
}> {
  const b = await loadBook(uid);
  if (doSettle) {
    const pending = b.orders.filter((o) => o.status === 'PENDING' && o.orderType === 'LIMIT' && o.limitPrice != null);
    if (pending.length) {
      const marks = await quotesFor([...new Set(pending.map((o) => o.symbol))]);
      let changed = false;
      for (const o of pending) {
        const q = marks.get(o.symbol);
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
      if (changed) {
        const mv = new Map<string, number>();
        const held = [...new Set(b.positions.map((p) => p.symbol))];
        const mq = await quotesFor(held);
        for (const [s, q] of mq) mv.set(s, q.price);
        const eq = round2(b.acct.cash + b.positions.reduce((s, p) => s + p.qty * (mv.get(p.symbol) ?? p.avg), 0));
        b.acct.equity = eq;
        b.equity.push({ ts: Date.now(), equity: eq });
      }
    }
  }
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
  return {
    acct: b.acct,
    positions,
    equityCurve: b.equity.slice(-500),
  };
}

export async function GET(request: Request): Promise<Response> {
  if (!storeReady()) return notConfigured();
  const claim = authClaim(request);
  if (!claim) return err('authentication required', 401);
  try {
    const { acct, positions, equityCurve } = await settleAndValue(claim.id, true);
    const initial = acct.initial > 0 ? acct.initial : STARTING_CASH;
    const unrealized = round2(positions.reduce((s, p) => s + p.unrealizedPnl, 0));
    const realized = round2(positions.reduce((s, p) => s + p.realizedPnl, 0));
    const day = round2(positions.reduce((s, p) => s + p.dayPnl, 0));
    const invested = round2(positions.reduce((s, p) => s + p.marketValue, 0));
    const totalPnl = round2(acct.equity - initial);
    return json({
      account: { id: claim.id, cash: acct.cash, initialCapital: initial, equity: acct.equity },
      summary: {
        invested,
        unrealizedPnl: unrealized,
        realizedPnl: realized,
        dayPnl: day,
        totalPnl,
        totalPnlPct: round2((totalPnl / initial) * 100),
        availableCash: acct.cash,
      },
      positions,
      equityCurve,
    });
  } catch {
    return err('request failed — please try again', 500);
  }
}
