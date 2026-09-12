// TradeAlgo serverless account API — POST / DELETE /api/watchlist/:symbol.
// Self-contained (see api/auth/signup.ts header note). Upstash Redis + JWT.
import { createHmac, timingSafeEqual } from 'node:crypto';

const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL ?? '').replace(/\/+$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? '';
const JWT_SECRET = process.env.JWT_SECRET ?? '';
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

let uniCache: { at: number; set: Set<string> } | null = null;
async function symbolKnown(sym: string): Promise<boolean> {
  const up = sym.toUpperCase();
  const now = Date.now();
  if (!uniCache || now - uniCache.at > 10 * 60_000) {
    try {
      const res = await fetch(UNIVERSE_URL, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const j = (await res.json()) as { stocks?: Array<{ symbol: string }> };
        const set = new Set<string>();
        for (const s of j.stocks ?? []) set.add(String(s.symbol).toUpperCase());
        uniCache = { at: now, set };
      }
    } catch { /* keep stale/empty */ }
  }
  if (!uniCache) return true;
  return uniCache.set.has(up);
}

function symbolFromUrl(request: Request): string {
  const m = new URL(request.url).pathname.match(/\/api\/watchlist\/([^\/?#]+)/i);
  return m ? decodeURIComponent(m[1]).trim().toUpperCase() : '';
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!storeReady()) return notConfigured();
  const claim = authClaim(request);
  if (!claim) return err('authentication required', 401);
  const symbol = symbolFromUrl(request);
  if (!symbol) return err('symbol required', 400);
  try {
    if (!(await symbolKnown(symbol))) return err('instrument not found', 404);
    const key = `ta:wl:${claim.id}`;
    const list = (await rget<string[]>(key)) ?? [];
    if (!list.map((s) => s.toUpperCase()).includes(symbol)) {
      list.push(symbol);
      await rset(key, list.slice(-200));
    }
    return json({ ok: true, symbol });
  } catch {
    return err('request failed — please try again', 500);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!storeReady()) return notConfigured();
  const claim = authClaim(request);
  if (!claim) return err('authentication required', 401);
  const symbol = symbolFromUrl(request);
  if (!symbol) return err('symbol required', 400);
  try {
    if (!(await symbolKnown(symbol))) return err('instrument not found', 404);
    const key = `ta:wl:${claim.id}`;
    const list = (await rget<string[]>(key)) ?? [];
    await rset(key, list.filter((s) => s.toUpperCase() !== symbol));
    return json({ ok: true, symbol });
  } catch {
    return err('request failed — please try again', 500);
  }
}
