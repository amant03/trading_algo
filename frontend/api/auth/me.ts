// TradeAlgo serverless account API — logout (stateless sessions: the client
// drops its token) and /me (GET profile, PATCH displayName/hasOnboarded).
// Self-contained (see auth/signup.ts header note). Upstash Redis + HS256 JWT.
import { createHmac, timingSafeEqual } from 'node:crypto';

const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL ?? '').replace(/\/+$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? '';
const JWT_SECRET = process.env.JWT_SECRET ?? '';
const STARTING_CASH = 100_000;

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
async function rset(key: string, value: unknown, exSec?: number): Promise<void> {
  const cmd: Array<string | number> = exSec
    ? ['SET', key, JSON.stringify(value), 'EX', exSec]
    : ['SET', key, JSON.stringify(value)];
  await rdb(cmd);
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

interface StoreUser {
  id: number;
  email: string;
  pass: string;
  displayName: string;
  hasOnboarded: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}
function publicUser(u: StoreUser): object {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    authProvider: 'email',
    hasOnboarded: u.hasOnboarded,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  };
}
async function ensureAcct(uid: number): Promise<void> {
  if ((await rget(`ta:acct:${uid}`)) == null) {
    await rset(`ta:acct:${uid}`, { cash: STARTING_CASH, initial: STARTING_CASH, equity: STARTING_CASH });
  }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PATCH, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!storeReady()) return notConfigured();
  const claim = authClaim(request);
  if (!claim) return err('authentication required', 401);
  try {
    const user = await rget<StoreUser>(`ta:user:${claim.id}`);
    if (!user) return err('authentication required', 401);
    await ensureAcct(user.id);
    return json({ user: publicUser(user), accountId: user.id });
  } catch {
    return err('request failed — please try again', 500);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  if (!storeReady()) return notConfigured();
  const claim = authClaim(request);
  if (!claim) return err('authentication required', 401);
  let body: { displayName?: string; hasOnboarded?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return err('invalid request body', 400);
  }
  try {
    const user = await rget<StoreUser>(`ta:user:${claim.id}`);
    if (!user) return err('authentication required', 401);
    let touched = false;
    if (body.displayName !== undefined) {
      const name = body.displayName.trim();
      if (!name || name.length > 80) return err('display name must be 1-80 characters', 400);
      user.displayName = name;
      touched = true;
    }
    if (body.hasOnboarded !== undefined) {
      user.hasOnboarded = Boolean(body.hasOnboarded);
      touched = true;
    }
    if (!touched) return err('nothing to update', 400);
    await rset(`ta:user:${user.id}`, user);
    await ensureAcct(user.id);
    return json({ user: publicUser(user), accountId: user.id });
  } catch {
    return err('request failed — please try again', 500);
  }
}
