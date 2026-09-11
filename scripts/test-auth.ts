import Fastify from 'fastify';
import { pool, query } from '@trading/shared';
import { authHook, registerAuthRoutes, hashPassword, verifyPassword, signToken, verifyToken } from '../services/api/src/auth.js';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}`, extra ?? '');
  }
}

async function main(): Promise<void> {
  // --- crypto unit checks (no DB) ---
  const h = await hashPassword('correct-horse-9');
  check('hash verifies', await verifyPassword('correct-horse-9', h));
  check('hash rejects wrong pw', !(await verifyPassword('wrong', h)));
  check('hash rejects garbage', !(await verifyPassword('x', 'not-a-hash')));
  const t0 = signToken(123, 'a@b.c', 60);
  const c0 = verifyToken(t0);
  check('jwt roundtrip', c0?.sub === 123 && c0?.email === 'a@b.c');
  check('jwt rejects tampered', verifyToken(`${t0.slice(0, -2)}xx`) === null);
  check('jwt rejects expired', verifyToken(signToken(1, 'a@b.c', -10)) === null);

  // --- HTTP route checks (live local DB, no Kafka touched by auth routes) ---
  const app = Fastify({ logger: false });
  app.addHook('onRequest', authHook);
  await registerAuthRoutes(app);

  const email = `testuser${Date.now()}@example.com`;
  const badEmail = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'nope', password: 'x' } });
  check('signup rejects bad email', badEmail.statusCode === 400);
  const shortPw = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'short' } });
  check('signup rejects short pw', shortPw.statusCode === 400);
  const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'valid-pass-1', displayName: 'Tester' } });
  check('signup 201', signup.statusCode === 201, signup.body);
  const sBody = signup.json() as { token: string; user: { id: number; email: string; hasOnboarded: boolean }; accountId: number };
  check('signup returns token+user+account', Boolean(sBody.token) && sBody.user.email === email && sBody.accountId > 1);
  const dupe = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: email.toUpperCase(), password: 'valid-pass-1' } });
  check('signup duplicate (case-insensitive) 409', dupe.statusCode === 409);
  const badLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'nope-nope-nope' } });
  check('login wrong pw 401', badLogin.statusCode === 401);
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'valid-pass-1' } });
  check('login 200', login.statusCode === 200, login.body);
  const token = (login.json() as { token: string }).token;
  const noAuth = await app.inject({ method: 'GET', url: '/auth/me' });
  check('me without token 401', noAuth.statusCode === 401);
  const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${token}` } });
  check('me with token 200', me.statusCode === 200 && (me.json() as { user: { email: string } }).user.email === email, me.body);
  const badToken = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: 'Bearer bogus.token.here' } });
  check('me with bad token 401', badToken.statusCode === 401);
  const patch = await app.inject({ method: 'PATCH', url: '/auth/me', headers: { authorization: `Bearer ${token}` }, payload: { hasOnboarded: true } });
  check('patch onboarded', patch.statusCode === 200 && (patch.json() as { user: { hasOnboarded: boolean } }).user.hasOnboarded === true, patch.body);
  const logout = await app.inject({ method: 'POST', url: '/auth/logout' });
  check('logout ok', logout.statusCode === 200);
  const unauthOrders = await app.inject({ method: 'GET', url: '/api/nope' });
  void unauthOrders;

  // portfolio/orders/trades/watchlist now require auth — verify 401s via direct route registration is covered by typecheck;
  // trading-route scoping is exercised below against the real routes module with a stub ctx.
  const { registerRoutes } = await import('../services/api/src/routes.js');
  const app2 = Fastify({ logger: false });
  app2.addHook('onRequest', authHook);
  await registerRoutes(app2, { store: { getSnapshot: () => null } as never, instruments: [], bySymbol: new Map() });
  const p401 = await app2.inject({ method: 'GET', url: '/api/portfolio' });
  check('portfolio without token 401', p401.statusCode === 401, p401.body);
  const o401 = await app2.inject({ method: 'POST', url: '/api/orders', payload: { symbol: 'TCS', side: 'BUY', quantity: 1 } });
  check('orders POST without token 401', o401.statusCode === 401, o401.body);
  const wAnon = await app2.inject({ method: 'GET', url: '/api/watchlist' });
  check('watchlist anonymous returns []', wAnon.statusCode === 200 && JSON.stringify(wAnon.json()) === '[]', wAnon.body);
  const wPost401 = await app2.inject({ method: 'POST', url: '/api/watchlist/TCS', payload: {} });
  check('watchlist POST without token 401', wPost401.statusCode === 401, wPost401.body);

  // cleanup test user (cascades account/orders/watchlist via FK)
  await query('DELETE FROM users WHERE email = $1', [email]);

  await app.close();
  await app2.close();
  await pool.end();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => void 0);
  process.exit(1);
});
