// Import a stock into full platform coverage.
//
// Queues a GitHub Actions `Import Symbol` run: the small automator fetches real
// Yahoo fundamentals + Screener.in competitors + Google News for the symbol and
// persists them to the automation-data branch, so every visitor sees full
// coverage without waiting for the nightly batch.
//
// GET /api/import?symbol=INFY
//
// Uses the REPO_PAT env var (classic PAT with `workflow` scope) that is set on
// the Vercel production environment for this deployment.

const SYM_RE = /^[A-Z][A-Z0-9&-]{0,19}$/;

function jsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, max-age=0',
    'Access-Control-Allow-Origin': '*',
  };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') ?? '').trim().toUpperCase();

  if (!SYM_RE.test(symbol)) {
    return new Response(JSON.stringify({ error: 'missing or invalid symbol' }), {
      status: 400,
      headers: jsonHeaders(),
    });
  }

  const pat = process.env.REPO_PAT;
  if (!pat) {
    return new Response(JSON.stringify({ error: 'import service not configured (REPO_PAT missing)' }), {
      status: 500,
      headers: jsonHeaders(),
    });
  }

  try {
    const res = await fetch('https://api.github.com/repos/amant03/trading_algo/actions/workflows/import-symbol.yml/dispatches', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'tradealgo-vercel',
      },
      body: JSON.stringify({ ref: 'main', inputs: { symbol } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status >= 400) {
      const body = await res.text().catch(() => '');
      return new Response(
        JSON.stringify({ error: `GitHub dispatch failed (${res.status})`, detail: body.slice(0, 200) }),
        { status: 502, headers: jsonHeaders() },
      );
    }
    return new Response(
      JSON.stringify({
        queued: true,
        symbol,
        note: 'Import workflow dispatched — coverage lands on automation-data in ~2 minutes.',
      }),
      { status: 200, headers: jsonHeaders() },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `dispatch error: ${e instanceof Error ? e.message : 'unknown'}` }),
      { status: 502, headers: jsonHeaders() },
    );
  }
}