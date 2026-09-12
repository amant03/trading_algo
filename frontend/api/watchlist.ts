// TradeAlgo serverless account API — watchlist in ONE function.
//   GET    /api/watchlist            -> string[] ([] when anonymous)
//   POST   /api/watchlist?symbol=X   -> {ok,symbol}
//   DELETE /api/watchlist?symbol=X   -> {ok,symbol}
// Self-contained (see api/auth.ts header note). WebCrypto only — no node:
// imports, so this typechecks under the browser tsconfig.
declare const process: { env: Record<string, string | undefined> };

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

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  // Anonymous reads get [] so the frontend falls back to its local list.
  if (!storeReady()) return json([]);
  const claim = await authClaim(request);
  if (!claim) return json([]);
  try {
    const list = (await rget<string[]>(`ta:wl:${claim.id}`)) ?? [];
    return json([...new Set(list.map((s) => String(s).toUpperCase()))]);
  } catch {
    return json([]);
  }
}

async function mutate(request: Request, add: boolean): Promise<Response> {
  if (!storeReady()) return notConfigured();
  const claim = await authClaim(request);
  if (!claim) return err('authentication required', 401);
  const symbol = (new URL(request.url).searchParams.get('symbol') ?? '').trim().toUpperCase();
  if (!symbol) return err('symbol required', 400);
  try {
    if (!(await symbolKnown(symbol))) return err('instrument not found', 404);
    const key = `ta:wl:${claim.id}`;
    const list = (await rget<string[]>(key)) ?? [];
    const upper = list.map((s) => s.toUpperCase());
    if (add && !upper.includes(symbol)) {
      list.push(symbol);
      await rset(key, list.slice(-200));
    } else if (!add && upper.includes(symbol)) {
      await rset(key, list.filter((s) => s.toUpperCase() !== symbol));
    }
    return json({ ok: true, symbol });
  } catch {
    return err('request failed — please try again', 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  return mutate(request, true);
}

export async function DELETE(request: Request): Promise<Response> {
  return mutate(request, false);
}
