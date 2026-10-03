import { useEffect, useState } from 'react';
import { SentimentBadge } from './Badge';
import { classifySentiment } from '../lib/sentiment';

interface SectorItem {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  symbols: string[];
  kind: 'member' | 'sector';
}

const SECTOR_URLS = [
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@automation-data/frontend/public/sector-news.json',
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/sector-news.json',
  '/sector-news.json',
];
const MAP_URLS = [
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@automation-data/frontend/public/sectors.json',
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/sectors.json',
  '/sectors.json',
];

let mapCache: Record<string, { sector: string; industry: string; extra?: string[] }> | null = null;
let newsCache: Record<string, SectorItem[]> | null = null;

async function fetchFirst<T>(urls: string[], pick: (j: T) => boolean): Promise<T | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('text/html')) continue;
      const data = (await res.json()) as T;
      if (pick(data)) return data;
    } catch {
      // try next mirror
    }
  }
  return null;
}

/** Sector-wide headlines for a stock: policy/regulator news affecting its
 *  whole sector (e.g. PBFINTECH sees insurance + IRDAI headlines). */
export default function SectorNews({ symbol }: { symbol: string }) {
  const [sectors, setSectors] = useState<string[] | null>(null);
  const [items, setItems] = useState<(SectorItem & { viaSector: string })[] | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!mapCache) {
        const m = await fetchFirst<{ sectors?: Record<string, { sector: string; industry: string; extra?: string[] }> }>(
          MAP_URLS, (j) => !!j?.sectors,
        );
        if (m?.sectors) mapCache = m.sectors;
      }
      const entry = mapCache?.[symbol.toUpperCase()];
      const secList = entry ? [entry.sector, ...(entry.extra ?? [])].filter(Boolean) : [];
      const sec = secList[0] ?? null;
      if (!live) return;
      setSectors(secList);
      if (!secList.length) return;
      if (!newsCache) {
        const n = await fetchFirst<{ sectors?: Record<string, SectorItem[]> }>(
          SECTOR_URLS, (j) => !!j?.sectors,
        );
        if (n?.sectors) newsCache = n.sectors;
      }
      if (!live) return;
      // Merge primary + secondary sector buckets, newest first, deduped.
      const merged: (SectorItem & { viaSector: string })[] = [];
      const seen = new Set<string>();
      for (const s of secList) {
        for (const it of newsCache?.[s] ?? []) {
          if (!seen.has(it.title)) {
            seen.add(it.title);
            merged.push({ ...it, viaSector: s });
          }
        }
      }
      merged.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
      setItems(merged);
    })();
    return () => { live = false; };
  }, [symbol]);

  if (sectors == null || items == null) return null;
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-title">
        <h3>Sector news — {sectors.join(' + ')}</h3>
        <span className="hint">policy + peers affecting {symbol}</span>
      </div>
      {items.length === 0 ? (
        <div className="empty">No sector headlines yet for {sectors.join(' + ')}.</div>
      ) : (
        <div className="stock-news-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '4px 20px' }}>
          {items.slice(0, 12).map((a, i) => (
            <div key={i} className="news-art">
              <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a>
              <div className="news-meta">
                <span>{a.source}</span>
                <SentimentBadge sentiment={classifySentiment(a.title)} />
                <span>{new Date(a.publishedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                {a.kind === 'sector' ? (
                  <span style={{ color: 'var(--cyan)' }}>{a.viaSector} wire</span>
                ) : (
                  <span className="muted">{a.symbols.slice(0, 3).join(' · ')}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
