import { useMemo } from 'react';
import { useLive } from '../ws';
import { classifySentiment } from '../lib/sentiment';

function Row({ label, items }: { label: string; items: { title: string }[] }) {
  const pos = items.filter((a) => classifySentiment(a.title) === 'bullish').length;
  const neg = items.filter((a) => classifySentiment(a.title) === 'bearish').length;
  const neu = items.length - pos - neg;
  const tot = Math.max(1, items.length);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span className="mono muted" style={{ width: 44 }}>{label}</span>
      <span style={{ flex: 1, height: 6, borderRadius: 3, overflow: 'hidden', display: 'flex', background: 'rgba(255,255,255,0.06)' }}>
        <span style={{ width: `${(pos / tot) * 100}%`, background: 'var(--up)' }} />
        <span style={{ width: `${(neu / tot) * 100}%`, background: 'rgba(148,163,184,0.35)' }} />
        <span style={{ width: `${(neg / tot) * 100}%`, background: 'var(--down)' }} />
      </span>
      <span className="mono" style={{ whiteSpace: 'nowrap' }}>
        <span className="up">+{pos}</span>
        {' / '}
        <span className="down">−{neg}</span>
        {' / '}
        <span className="muted">{neu} neutral</span>
      </span>
    </div>
  );
}

/** Market-wide news mood: past 24 hours and past 30 days. */
export default function NewsSentimentSummary() {
  const newsBySymbol = useLive((s) => s.newsBySymbol);
  const { day, month } = useMemo(() => {
    const now = Date.now();
    const all: { title: string; ts: number }[] = [];
    for (const rows of Object.values(newsBySymbol ?? {})) {
      for (const a of rows ?? []) {
        if (!a?.title) continue;
        const ts = Date.parse(a.publishedAt ?? '');
        if (isFinite(ts)) all.push({ title: a.title, ts });
      }
    }
    return {
      day: all.filter((a) => now - a.ts <= 24 * 3600_000),
      month: all.filter((a) => now - a.ts <= 30 * 24 * 3600_000),
    };
  }, [newsBySymbol]);

  if (!day.length && !month.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
      <Row label="24H" items={day} />
      <Row label="30D" items={month} />
    </div>
  );
}
