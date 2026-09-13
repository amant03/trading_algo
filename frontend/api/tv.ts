// TradingView snapshot proxy (unofficial scanner endpoint — the same one the
// open-source Mathieu2301/TradingView-API library's getTA() uses).
// No npm dependency needed: the scanner is plain HTTPS POST, so this stays a
// dependency-free, short-lived serverless function (the library's websocket
// Client with Pine indicators cannot run here — no persistent sockets on
// serverless, and its `ws` dep can't ship to browsers; that upgrade path
// belongs on the self-hosted VM service, not this snapshot proxy).
//
// GET /api/tv?symbols=NSE:RELIANCE,NSE:TCS  (max 15, NSE:/BSE: only)
// -> { asOf, symbols: [{ tv, close, changePct, volume, rsi, macd,
//      macdSignal, sma20, sma50, sma200, ema20, bbUpper, bbLower,
//      ta: { "1":{all,ma,other}, ..., "1D":{...}, "1W":{...}, "1M":{...} } }] }
// TA values are raw TradingView recommendation scores in [-1, 1].
// Anonymous, no credentials. Cached 60s. Never throws 500s at the UI for
// upstream hiccups — returns 502 with a plain message instead.

const SCAN_URL = 'https://scanner.tradingview.com/global/scan';
const MAX_SYMBOLS = 15;
const CACHE_MS = 60_000;
const TV_RE = /^(NSE|BSE):[A-Z0-9&.\-]{1,20}$/;

const SNAP_COLS = [
  'close', 'change', 'volume',
  'RSI', 'MACD.macd', 'MACD.signal',
  'SMA20', 'SMA50', 'SMA200', 'EMA20',
  'BB.upper', 'BB.lower',
];

const TA_TFS = ['1', '5', '15', '60', '240', '1D', '1W', '1M'];
const TA_INDS = ['Recommend.Other', 'Recommend.All', 'Recommend.MA'];

function taColumns(): string[] {
  const cols: string[] = [];
  for (const tf of TA_TFS) {
    for (const ind of TA_INDS) {
      cols.push(tf === '1D' ? ind : `${ind}|${tf}`);
    }
  }
  return cols;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': status === 200 ? 'public, max-age=45' : 'no-store, max-age=0',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

interface CacheEntry { at: number; key: string; payload: unknown }
let cache: CacheEntry | null = null;

function num(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const raw = (url.searchParams.get('symbols') ?? '').toUpperCase();
    const tickers = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, MAX_SYMBOLS);
    if (!tickers.length) {
      return json({ error: 'symbols required, e.g. ?symbols=NSE:RELIANCE,NSE:TCS' }, 400);
    }
    for (const t of tickers) {
      if (!TV_RE.test(t)) return json({ error: `bad symbol "${t}" — use NSE:XXXX or BSE:XXXX` }, 400);
    }
    const key = tickers.join(',');
    const now = Date.now();
    if (cache && now - cache.at < CACHE_MS && cache.key === key) {
      return json(cache.payload);
    }
    const columns = [...SNAP_COLS, ...taColumns()];
    const res = await fetch(SCAN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ symbols: { tickers }, columns }),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return json({ error: `tradingview scanner unavailable (http ${res.status}) — try again shortly` }, 502);
    const body = (await res.json()) as { data?: Array<{ s: string; d: Array<number | null> }> };
    const rows = Array.isArray(body.data) ? body.data : [];
    const bySym = new Map(rows.map((r) => [String(r.s).toUpperCase(), r.d]));
    const taStart = SNAP_COLS.length;
    const symbols = tickers.map((t) => {
      const d = bySym.get(t) ?? [];
      const g = (i: number): number | null => (i < d.length ? num(d[i]) : null);
      const ta: Record<string, { all: number | null; ma: number | null; other: number | null }> = {};
      TA_TFS.forEach((tf, ti) => {
        const base = taStart + ti * TA_INDS.length;
        ta[tf] = { other: g(base), all: g(base + 1), ma: g(base + 2) };
      });
      return {
        tv: t,
        close: g(0),
        changePct: g(1),
        volume: g(2),
        rsi: g(3),
        macd: g(4),
        macdSignal: g(5),
        sma20: g(6),
        sma50: g(7),
        sma200: g(8),
        ema20: g(9),
        bbUpper: g(10),
        bbLower: g(11),
        ta,
      };
    });
    const payload = { asOf: new Date(now).toISOString(), symbols };
    cache = { at: now, key, payload };
    return json(payload);
  } catch {
    return json({ error: 'tradingview scanner unreachable — try again shortly' }, 502);
  }
}
