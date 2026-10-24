function originOf(request: Request): string {
  const url = new URL(request.url);
  const forwarded = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  if (forwarded) return `${proto}://${forwarded}`;
  return url.origin;
}

/** Public routes worth crawling. Stock pages are discovered from on-site links. */
const PATHS: { path: string; changefreq: string; priority: string }[] = [
  { path: '/', changefreq: 'hourly', priority: '1.0' },
  { path: '/about', changefreq: 'monthly', priority: '0.8' },
  { path: '/paper', changefreq: 'daily', priority: '0.9' },
  { path: '/algorithms', changefreq: 'weekly', priority: '0.8' },
  { path: '/trading', changefreq: 'daily', priority: '0.7' },
  { path: '/vibe', changefreq: 'weekly', priority: '0.6' },
  { path: '/us', changefreq: 'daily', priority: '0.7' },
  { path: '/test', changefreq: 'weekly', priority: '0.5' },
  { path: '/watchlist', changefreq: 'weekly', priority: '0.5' },
  { path: '/signup', changefreq: 'yearly', priority: '0.4' },
  { path: '/login', changefreq: 'yearly', priority: '0.3' },
];

export async function GET(request: Request): Promise<Response> {
  const origin = originOf(request);
  const urls = PATHS.map(
    (row) => `  <url>
    <loc>${origin}${row.path}</loc>
    <changefreq>${row.changefreq}</changefreq>
    <priority>${row.priority}</priority>
  </url>`,
  ).join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
