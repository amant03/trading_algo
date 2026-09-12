// TradeAlgo serverless account API — all /api/auth/* routes in ONE function
// (Vercel Hobby caps 12 functions per deployment).
// Routes (via vercel.json rewrite /api/auth/:p* -> /api/auth?op=:p*):
//   POST ?op=signup  {email,password,displayName?} -> 201 {token,user,accountId}
//   POST ?op=login   {email,password} -> {token,user,accountId}
//   POST ?op=logout  -> {ok:true}            GET ?op=me -> {user,accountId}
//   PATCH ?op=me     {displayName?,hasOnboarded?} -> {user,accountId}
// Self-contained by design: no imports from './x' or '../src/...' (the emitted
// lambda crashes on relative imports). WebCrypto only — no node: imports, so
// this typechecks under the browser tsconfig used for the deployment bundle.
// Free-tier stack: Upstash Redis (REST) for persistence + stateless HS256 JWT.
declare const process: { env: Record<string, string | undefined> };

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
function hex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function unhex(s: string): Uint8Array {
  const a = new Uint8Array(Math.floor(s.length / 2));
  for (let i = 0; i < a.length; i++) a[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return a;
}
function b64urlBytes(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 120_000, hash: 'SHA-256' }, key, 256);
  return `pbkdf2$120000$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const iter = Number(parts[1]);
    if (!Number.isFinite(iter) || iter <= 0 || iter > 1_000_000) return false;
    const salt = unhex(parts[2]);
    const expected = unhex(parts[3]);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations: iter, hash: 'SHA-256' }, key, expected.length * 8));
    if (bits.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}
async function hmacKey(mode: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, [mode],
  );
}
async function signToken(userId: number, email: string): Promise<string> {
  const header = b64urlBytes(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64urlBytes(new TextEncoder().encode(JSON.stringify({ sub: userId, email, iat: now, exp: now + JWT_TTL_SEC })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey('sign'), new TextEncoder().encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64urlBytes(sig)}`;
}
async function authClaim(req: Request): Promise<{ id: number; email: string } | null> {
  try {
    const h = req.headers.get('authorization') ?? '';
    if (!h.startsWith('Bearer ')) return null;
    const parts = h.slice('Bearer '.length).trim().split('.');
    if (parts.length !== 3) return null;
    const [hh, p, s] = parts;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey('verify'), unb64url(s) as BufferSource, new TextEncoder().encode(`${hh}.${p}`));
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
async function bodyOf<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

async function handleSignup(request: Request): Promise<Response> {
  if (!(await throttle(ipOf(request), 'signup', 20, 60))) return err('too many attempts — try again in a minute', 429);
  const body = await bodyOf<{ email?: string; password?: string; displayName?: string }>(request);
  if (!body) return err('invalid request body', 400);
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
    await ensureAcct(id);
    return json({ token: await signToken(id, email), user: publicUser(user), accountId: id }, 201);
  } catch {
    return err('signup failed — please try again', 500);
  }
}

async function handleLogin(request: Request): Promise<Response> {
  if (!(await throttle(ipOf(request), 'login', 20, 60))) return err('too many attempts — try again in a minute', 429);
  const body = await bodyOf<{ email?: string; password?: string }>(request);
  if (!body) return err('invalid request body', 400);
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  if (!EMAIL_RE.test(email) || !password) return err('invalid email or password', 401);
  try {
    const idRaw = await rget<string | number>(`ta:email:${email}`);
    const user = idRaw == null ? null : await rget<StoreUser>(`ta:user:${String(idRaw)}`);
    if (!user || !(await verifyPassword(password, user.pass))) {
      return err('invalid email or password', 401);
    }
    user.lastLoginAt = Date.now();
    await rset(`ta:user:${user.id}`, user);
    await ensureAcct(user.id);
    return json({ token: await signToken(user.id, user.email), user: publicUser(user), accountId: user.id });
  } catch {
    return err('login failed — please try again', 500);
  }
}

async function handleGetMe(request: Request): Promise<Response> {
  const claim = await authClaim(request);
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

async function handlePatchMe(request: Request): Promise<Response> {
  const claim = await authClaim(request);
  if (!claim) return err('authentication required', 401);
  const body = await bodyOf<{ displayName?: string; hasOnboarded?: boolean }>(request);
  if (!body) return err('invalid request body', 400);
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

function opOf(request: Request): string {
  const url = new URL(request.url);
  const byQuery = (url.searchParams.get('op') ?? '').toLowerCase();
  if (byQuery) return byQuery;
  const m = url.pathname.match(/\/api\/auth\/([^\/?#]+)/i);
  return (m ? m[1] : '').toLowerCase();
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!storeReady()) return notConfigured();
  if (opOf(request) === 'me') return handleGetMe(request);
  return err('not found', 404);
}

export async function POST(request: Request): Promise<Response> {
  if (!storeReady()) return notConfigured();
  const op = opOf(request);
  if (op === 'signup') return handleSignup(request);
  if (op === 'login') return handleLogin(request);
  if (op === 'logout') return json({ ok: true });
  return err('not found', 404);
}

export async function PATCH(request: Request): Promise<Response> {
  if (!storeReady()) return notConfigured();
  if (opOf(request) === 'me') return handlePatchMe(request);
  return err('not found', 404);
}
