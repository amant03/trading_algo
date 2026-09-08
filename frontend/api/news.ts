// Google News RSS for the dashboard and per-stock News tab.
// Self-contained so Vercel Node functions do not import other TS modules.

function jsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, max-age=0',
    'Access-Control-Allow-Origin': '*',
  };
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export interface NewsHit {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  symbol: string | null;
}

function parseRss(xml: string, symbol: string | null): NewsHit[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const out: NewsHit[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const titleM = it.match(/<title>([\s\S]*?)<\/title>/);
    const linkM = it.match(/<link>([\s\S]*?)<\/link>/);
    const dateM = it.match(/<pubDate>([^<]*?)<\/pubDate>/);
    const srcM = it.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    if (!titleM || !linkM) continue;
    const title = decode(titleM[1].trim()).replace(/^Top Stories\s*/, '');
    const url = decode(linkM[1].trim());
    if (!title || seen.has(title)) continue;
    seen.add(title);
    out.push({
      title,
      source: srcM ? decode(srcM[1].trim()) : 'Google News',
      url,
      publishedAt: dateM ? new Date(dateM[1]).toISOString() : new Date().toISOString(),
      symbol,
    });
  }
  return out;
}

async function fetchRss(query: string, symbol: string | null): Promise<NewsHit[]> {
  const url =
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(query) +
    '&hl=en-IN&gl=IN&ceid=IN:en';
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      Accept: 'application/rss+xml,application/xml,text/xml,*/*',
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];
  return parseRss(await res.text(), symbol);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') ?? '').trim().toUpperCase();
  const qParam = (url.searchParams.get('q') ?? '').trim();
  try {
    let hits: NewsHit[] = [];
    if (symbol && /^[A-Z0-9][A-Z0-9&-]{0,19}$/.test(symbol)) {
      const queries = [`"${symbol}" NSE`, `${symbol} share price India`];
      for (const q of queries) {
        hits = await fetchRss(q, symbol);
        if (hits.length) break;
      }
    } else {
      const q = qParam || 'NSE OR "Nifty 50" OR "BSE Sensex" OR "Indian stock market"';
      hits = await fetchRss(q, null);
    }
    return new Response(JSON.stringify({ symbol: symbol || null, source: 'google-news', hits: hits.slice(0, 20) }), {
      status: 200,
      headers: jsonHeaders(),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ symbol: symbol || null, hits: [], error: err instanceof Error ? err.message : 'news unavailable' }),
      { status: 200, headers: jsonHeaders() },
    );
  }
}
