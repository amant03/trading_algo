// TradeAlgo serverless account API — GET /api/trades (list).
// Self-contained (see api/auth/signup.ts header note). Upstash Redis + JWT.
import { createHmac, timingSafeEqual } from 'node:crypto';

const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL ?? '').replace(/\/+$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? '';
const JWT_SECRET = process.env.JWT_SECRET ?? '';

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

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!storeReady()) return notConfigured();
  const claim = authClaim(request);
  if (!claim) return err('authentication required', 401);
  try {
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 200);
    const trades = (await rget<unknown[]>(`ta:trd:${claim.id}`)) ?? [];
    return json(trades.slice(0, limit));
  } catch {
    return err('request failed — please try again', 500);
  }
}
