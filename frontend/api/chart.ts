// OHLCV chart relay for the static deploy. Mirrors Google Finance ranges
// (1D defaults to 1-minute bars during the NSE cash session).

import { RANGES, fetchChart, jsonHeaders, type OHLCV } from './nse';

const TTL_MS = 20_000;
const cache: Record<string, { at: number; rows: OHLCV[] }> = {};

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') ?? url.searchParams.get('Symbol') ?? '')
    .toUpperCase()
    .trim();
  const range = (url.searchParams.get('range') ?? '1d').toLowerCase();

  if (!/^[A-Z0-9][A-Z0-9&-]{0,19}$/.test(symbol) && symbol !== '^NSEI' && symbol !== 'NIFTY50' && symbol !== 'NIFTY') {
    return new Response(JSON.stringify({ error: 'missing or invalid symbol' }), {
      status: 400,
      headers: jsonHeaders(),
    });
  }
  const spec = RANGES[range];
  if (!spec) {
    return new Response(JSON.stringify({ error: 'unsupported range', ranges: Object.keys(RANGES), default: '1d' }), {
      status: 400,
      headers: jsonHeaders(),
    });
  }

  const now = Date.now();
  const key = `${symbol}:${range}`;
  const hit = cache[key];
  if (hit && now - hit.at < TTL_MS) {
    return new Response(
      JSON.stringify({ symbol, range, interval: spec.interval, currency: 'INR', source: 'cache', rows: hit.rows }),
      { status: 200, headers: jsonHeaders() },
    );
  }

  const rows = await fetchChart(symbol, range, spec.interval);
  if (!rows) {
    return new Response(JSON.stringify({ error: 'chart unavailable for symbol' }), {
      status: 404,
      headers: jsonHeaders(),
    });
  }

  cache[key] = { at: now, rows };
  return new Response(
    JSON.stringify({ symbol, range, interval: spec.interval, currency: 'INR', source: 'yahoo', rows }),
    { status: 200, headers: jsonHeaders() },
  );
}
