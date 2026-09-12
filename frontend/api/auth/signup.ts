// TradeAlgo serverless account API — signup.
// Self-contained by design: no imports from './x' or '../src/...' (the emitted
// lambda crashes on relative imports), so the helper block is duplicated.
// Free-tier stack: Upstash Redis (REST) for persistence + stateless HS256 JWT.
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL ?? '').replace(/\/+$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? '';
const JWT_SECRET = process.env.JWT_SECRET ?? '';
const JWT_TTL_SEC = 7 * 24 * 3600;
const STARTING_CASH = 100_000;
const EMAIL_RE = /^\S+@\S+\.\S+$/;

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
function ipOf(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim().slice(0, 64);
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
function scryptAsync(password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, opts, (e, dk) => (e ? reject(e) : resolve(dk)));
  });
}
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${dk.toString('hex')}`;
}
function b64url(input: string | Buffer): string {
  return Buffer.from(input as never)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function signToken(userId: number, email: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub: userId, email, iat: now, exp: now + JWT_TTL_SEC }));
  const sig = b64url(createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}
async function throttle(ip: string, scope: string, limit: number, windowSec: number): Promise<boolean> {
  try {
    const key = `ta:rl:${scope}:${ip}`;
    const n = await rdb<number>(['INCR', key]);
    if (n === 1) await rdb(['EXPIRE', key, windowSec]);
    return (n ?? 0) <= limit;
  } catch {
    return true;
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

export async function POST(request: Request): Promise<Response> {
  if (!storeReady()) return notConfigured();
  if (!(await throttle(ipOf(request), 'signup', 20, 60))) return err('too many attempts — try again in a minute', 429);
  let body: { email?: string; password?: string; displayName?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return err('invalid request body', 400);
  }
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  const displayName = (body.displayName ?? '').trim() || email.split('@')[0] || 'Trader';
  if (!EMAIL_RE.test(email)) return err('valid email required', 400);
  if (password.length < 8) return err('password must be at least 8 characters', 400);
  if (displayName.length > 80) return err('display name too long', 400);
  try {
    const dupe = await rdb<string>(['GET', `ta:email:${email}`]);
    if (dupe != null) return err('email already registered', 409);
    const id = (await rdb<number>(['INCR', 'ta:seq:uid'])) ?? Date.now();
    const now = Date.now();
    const user: StoreUser = {
      id, email, pass: await hashPassword(password),
      displayName: displayName.slice(0, 80), hasOnboarded: false,
      createdAt: now, lastLoginAt: now,
    };
    await rset(`ta:user:${id}`, user);
    await rset(`ta:email:${email}`, String(id));
    await rset(`ta:acct:${id}`, { cash: STARTING_CASH, initial: STARTING_CASH, equity: STARTING_CASH });
    return json({ token: signToken(id, email), user: publicUser(user), accountId: id }, 201);
  } catch {
    return err('signup failed — please try again', 500);
  }
}
