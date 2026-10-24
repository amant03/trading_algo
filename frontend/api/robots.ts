function originOf(request: Request): string {
  const url = new URL(request.url);
  const forwarded = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  if (forwarded) return `${proto}://${forwarded}`;
  return url.origin;
}

export async function GET(request: Request): Promise<Response> {
  const origin = originOf(request);
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
