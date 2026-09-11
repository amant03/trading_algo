import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import type { BinaryLike, ScryptOptions } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config, isDev, logger, query, type User } from '@trading/shared';

function scryptAsync(password: BinaryLike, salt: BinaryLike, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, dk) => (err ? reject(err) : resolve(dk)));
  });
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;
export const VIRTUAL_STARTING_CASH = 100000;

// ---------------------------------------------------------------------------
// password hashing (scrypt, stdlib only — no native deps)
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = await scryptAsync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${dk.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (![n, r, p].every(Number.isFinite)) return false;
    const dk = await scryptAsync(password, Buffer.from(parts[4], 'hex'), KEYLEN, { N: n, r, p });
    const expected = Buffer.from(parts[5], 'hex');
    return dk.length === expected.length && timingSafeEqual(dk, expected);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// JWT (HS256, stdlib only). Stateless sessions; logout = client drops token.
// ---------------------------------------------------------------------------

function b64url(input: string | Buffer): string {
  return Buffer.from(input as never)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface JwtClaims {
  sub: number;
  email: string;
  iat: number;
  exp: number;
}

function secret(): string {
  const s = config.auth.jwtSecret;
  if (!isDev && s === 'dev-only-insecure-secret-change-me') {
    logger.warn('JWT_SECRET is the dev default in production — set a real secret');
  }
  return s;
}

export function signToken(userId: number, email: string, ttlSec = config.auth.tokenTtlSec): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub: userId, email, iat: now, exp: now + ttlSec }));
  const sig = b64url(createHmac('sha256', secret()).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

export function verifyToken(token: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = b64url(createHmac('sha256', secret()).update(`${h}.${p}`).digest());
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(p, 'base64').toString('utf8')) as JwtClaims;
    if (typeof claims.sub !== 'number' || typeof claims.exp !== 'number') return null;
    if (claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// request integration
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: number; email: string };
  }
}

/** Attaches req.user when a valid Bearer token is present. Never rejects — per-route requireAuth enforces. */
export async function authHook(req: FastifyRequest): Promise<void> {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return;
  const claims = verifyToken(h.slice('Bearer '.length).trim());
  if (claims) req.user = { id: claims.sub, email: claims.email };
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user) {
    void reply.code(401).send({ error: 'authentication required' });
  }
}

interface UserRow {
  id: number;
  email: string;
  password_hash: string | null;
  display_name: string;
  auth_provider: string;
  has_onboarded: boolean;
  created_at: Date;
  last_login_at: Date | null;
}

export function toPublicUser(r: UserRow): User {
  return {
    id: Number(r.id),
    email: r.email,
    displayName: r.display_name,
    authProvider: r.auth_provider === 'google' ? 'google' : 'email',
    hasOnboarded: Boolean(r.has_onboarded),
    createdAt: new Date(r.created_at).getTime(),
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at).getTime() : null,
  };
}

/** Lazily ensure the user's paper account exists; returns its id. */
export async function ensureAccount(userId: number): Promise<number> {
  const existing = await query<{ id: number }>('SELECT id FROM accounts WHERE user_id = $1', [userId]);
  if (existing.rows[0]) return Number(existing.rows[0].id);
  const who = await query<{ display_name: string }>('SELECT display_name FROM users WHERE id = $1', [userId]);
  const displayName = who.rows[0]?.display_name ?? 'Trader';
  const created = await query<{ id: number }>(
    `INSERT INTO accounts (user_id, name, cash_balance, initial_capital, equity)
     VALUES ($1, $2, $3, $3, $3)
     ON CONFLICT (user_id) DO NOTHING RETURNING id`,
    [userId, `${displayName} Paper Account`.slice(0, 60), VIRTUAL_STARTING_CASH],
  );
  if (created.rows[0]) return Number(created.rows[0].id);
  const again = await query<{ id: number }>('SELECT id FROM accounts WHERE user_id = $1', [userId]);
  if (!again.rows[0]) throw new Error('account creation failed');
  return Number(again.rows[0].id);
}

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { email?: string; password?: string; displayName?: string } }>(
    '/auth/signup',
    async (req, reply) => {
      const email = (req.body?.email ?? '').trim().toLowerCase();
      const password = req.body?.password ?? '';
      const displayName = (req.body?.displayName ?? '').trim() || email.split('@')[0] || 'Trader';
      if (!EMAIL_RE.test(email)) return reply.code(400).send({ error: 'valid email required' });
      if (password.length < 8) return reply.code(400).send({ error: 'password must be at least 8 characters' });
      if (displayName.length > 80) return reply.code(400).send({ error: 'display name too long' });
      const dupe = await query<{ id: number }>('SELECT id FROM users WHERE email = $1', [email]);
      if (dupe.rows[0]) return reply.code(409).send({ error: 'email already registered' });
      const passwordHash = await hashPassword(password);
      const created = await query<UserRow>(
        `INSERT INTO users (email, password_hash, display_name, auth_provider)
         VALUES ($1, $2, $3, 'email') RETURNING *`,
        [email, passwordHash, displayName.slice(0, 80)],
      );
      const user = toPublicUser(created.rows[0]);
      const accountId = await ensureAccount(user.id);
      logger.info({ userId: user.id, email }, 'user signed up');
      return reply.code(201).send({ token: signToken(user.id, user.email), user, accountId });
    },
  );

  app.post<{ Body: { email?: string; password?: string } }>('/auth/login', async (req, reply) => {
    const email = (req.body?.email ?? '').trim().toLowerCase();
    const password = req.body?.password ?? '';
    if (!EMAIL_RE.test(email) || !password) {
      return reply.code(401).send({ error: 'invalid email or password' });
    }
    const found = await query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    const row = found.rows[0];
    if (!row || !row.password_hash || !(await verifyPassword(password, row.password_hash))) {
      return reply.code(401).send({ error: 'invalid email or password' });
    }
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [row.id]);
    const user = toPublicUser({ ...row, last_login_at: new Date() });
    const accountId = await ensureAccount(user.id);
    return { token: signToken(user.id, user.email), user, accountId };
  });

  // Stateless sessions: the client drops its token. Endpoint exists so the
  // frontend has a symmetric logout call (and for future server blocklists).
  app.post('/auth/logout', async () => ({ ok: true }));

  app.get('/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const found = await query<UserRow>('SELECT * FROM users WHERE id = $1', [req.user!.id]);
    if (!found.rows[0]) return reply.code(401).send({ error: 'authentication required' });
    const user = toPublicUser(found.rows[0]);
    const accountId = await ensureAccount(user.id);
    return { user, accountId };
  });

  app.patch<{ Body: { displayName?: string; hasOnboarded?: boolean } }>(
    '/auth/me',
    { preHandler: requireAuth },
    async (req, reply) => {
      const patches: string[] = [];
      const params: unknown[] = [];
      if (req.body?.displayName !== undefined) {
        const name = req.body.displayName.trim();
        if (!name || name.length > 80) return reply.code(400).send({ error: 'display name must be 1-80 characters' });
        params.push(name);
        patches.push(`display_name = $${params.length}`);
      }
      if (req.body?.hasOnboarded !== undefined) {
        params.push(Boolean(req.body.hasOnboarded));
        patches.push(`has_onboarded = $${params.length}`);
      }
      if (!patches.length) return reply.code(400).send({ error: 'nothing to update' });
      params.push(req.user!.id);
      const updated = await query<UserRow>(
        `UPDATE users SET ${patches.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      if (!updated.rows[0]) return reply.code(401).send({ error: 'authentication required' });
      const user = toPublicUser(updated.rows[0]);
      const accountId = await ensureAccount(user.id);
      return { user, accountId };
    },
  );
}
