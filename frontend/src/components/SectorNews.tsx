import { useEffect, useState } from 'react';
import { fetchWithTimeout } from '../api';
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

// Raw GitHub first. jsDelivr keeps the previous file for hours after a commit,
// which left this panel on the 28 Sep snapshot while stock news moved on.
// The same-origin copy is only the last deploy's fallback.
const SECTOR_URLS = [
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/sector-news.json',
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@automation-data/frontend/public/sector-news.json',
  '/sector-news.json',
];
const MAP_URLS = [
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/sectors.json',
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@automation-data/frontend/public/sectors.json',
  '/sectors.json',
];

const REFRESH_MS = 10 * 60 * 1000;

// TradingView still files these under Air Freight/Couriers. Sector news follows
// the business: food delivery and quick commerce, not logistics.
const FOOD_DELIVERY = new Set(['ETERNAL', 'SWIGGY']);

const WINDOWS = [
  { id: '1d', label: '1 day', ms: 86_400_000 },
  { id: '1w', label: '1 week', ms: 7 * 86_400_000 },
  { id: '1m', label: '1 month', ms: 30 * 86_400_000 },
] as const;

type WindowId = (typeof WINDOWS)[number]['id'];
type Mood = 'positive' | 'neutral' | 'negative';

function moodOf(items: SectorItem[]): { mood: Mood; score: number } {
  if (!items.length) return { mood: 'neutral', score: 0 };
  let score = 0;
  for (const it of items) {
    const s = classifySentiment(it.title);
    if (s === 'bullish') score += 1;
    else if (s === 'bearish') score -= 1;
  }
  const avg = Math.max(-1, Math.min(1, score / items.length));
  if (avg >= 0.15) return { mood: 'positive', score: avg };
  if (avg <= -0.15) return { mood: 'negative', score: avg };
  return { mood: 'neutral', score: avg };
}

let mapCache: Record<string, { sector: string; industry: string; extra?: string[] }> | null = null;
let newsCache: Record<string, SectorItem[]> | null = null;
let cachedAt = 0;
let inflight: Promise<void> | null = null;

async function fetchFirst<T>(urls: string[], pick: (j: T) => boolean): Promise<T | null> {
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, { cache: 'no-store' }, 12_000);
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('text/html')) continue;
      const data = (await res.json()) as T;
      if (pick(data)) return data;
    } catch {
      // try next mirror — a stalled CDN must not pin the panel
    }
  }
  return null;
}

function loadCaches(): Promise<void> {
  if (mapCache && newsCache && Date.now() - cachedAt < REFRESH_MS) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    const [m, n] = await Promise.all([
      fetchFirst<{ sectors?: Record<string, { sector: string; industry: string; extra?: string[] }> }>(
        MAP_URLS, (j) => !!j?.sectors,
      ),
      fetchFirst<{ sectors?: Record<string, SectorItem[]> }>(
        SECTOR_URLS, (j) => !!j?.sectors,
      ),
    ]);
    if (m?.sectors) mapCache = m.sectors;
    if (n?.sectors) newsCache = n.sectors;
    if (mapCache && newsCache) cachedAt = Date.now();
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Sector-wide headlines for a stock: policy/regulator news affecting its
 *  whole sector (e.g. PBFINTECH sees insurance + IRDAI headlines). */
function Barometer({ score, mood }: { score: number; mood: Mood }) {
  const angle = score * 78;
  return (
    <div className={`baro baro-${mood}`} title={`${mood} sector news`}>
      <svg viewBox="0 0 120 72" aria-hidden="true">
        <path d="M16 60 A44 44 0 0 1 104 60" className="baro-track" />
        <path d="M16 60 A44 44 0 0 1 38 24" className="baro-neg" />
        <path d="M38 24 A44 44 0 0 1 82 24" className="baro-neu" />
        <path d="M82 24 A44 44 0 0 1 104 60" className="baro-pos" />
        <line x1="60" y1="60" x2="60" y2="22" className="baro-needle" transform={`rotate(${angle} 60 60)`} />
        <circle cx="60" cy="60" r="3.5" className="baro-hub" />
      </svg>
      <span className="baro-label">{mood}</span>
    </div>
  );
}

export default function SectorNews({ symbol }: { symbol: string }) {
  const [sectors, setSectors] = useState<string[] | null>(null);
  const [items, setItems] = useState<(SectorItem & { viaSector: string })[] | null>(null);
  const [windowId, setWindowId] = useState<WindowId>('1w');

  useEffect(() => {
    let live = true;
    (async () => {
      await loadCaches();
      const upperSym = symbol.toUpperCase();
      const entry = mapCache?.[upperSym];
      const secList = FOOD_DELIVERY.has(upperSym)
        ? ['Food Delivery']
        : (entry ? [entry.sector, ...(entry.extra ?? [])].filter(Boolean) : []);
      if (!live) return;
      setSectors(secList);
      if (!secList.length) {
        setItems([]);
        return;
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

  if (sectors == null || items == null || sectors.length === 0) return null;
  const span = WINDOWS.find((w) => w.id === windowId) ?? WINDOWS[1];
  const cutoff = Date.now() - span.ms;
  const shown = items.filter((a) => {
    const t = Date.parse(a.publishedAt);
    return Number.isFinite(t) && t >= cutoff;
  });
  const { mood, score } = moodOf(shown);
  return (
    <div className="panel sector-news" style={{ marginBottom: 16 }}>
      <div className="panel-title sector-news-title">
        <div>
          <h3>Sector news — {sectors.join(' + ')}</h3>
          <span className="hint">policy + peers affecting {symbol}</span>
        </div>
        <div className="sector-news-tools">
          <div className="seg" role="group" aria-label="Sector news window">
            {WINDOWS.map((w) => (
              <button key={w.id} type="button" className={w.id === windowId ? 'active' : ''} onClick={() => setWindowId(w.id)}>
                {w.label}
              </button>
            ))}
          </div>
          <Barometer score={score} mood={mood} />
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="empty">No sector headlines in the last {span.label.toLowerCase()} for {sectors.join(' + ')}.</div>
      ) : (
        <div className="stock-news-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '4px 20px' }}>
          {shown.slice(0, 12).map((a, i) => {
            const href = /^https?:\/\//i.test(a.url) ? a.url : '';
            return (
            <div key={i} className="news-art">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer">{a.title}</a>
              ) : (
                <div className="news-headline">{a.title}</div>
              )}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
