import { useNavigate } from 'react-router-dom';
import { ImpactBadge, SentimentBadge } from './Badge';
import { timeAgo } from '../format';
import type { NewsItem } from '../types';

export default function NewsFeed({ items, limit = 15 }: { items: NewsItem[]; limit?: number }) {
  const navigate = useNavigate();
  if (!items.length) return <div className="empty">No headlines yet — retry in a moment.</div>;
  return (
    <div className="feed">
      {items.slice(0, limit).map((n) => {
        const real = Boolean(n.url);
        return (
          <div key={n.id} className="news-item">
            <div className="news-head">
              {n.symbol ? (
                <span
                  className="sym mono"
                  style={{ fontWeight: 600, cursor: 'pointer', color: 'var(--cyan)', fontSize: 12 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/stock/${n.symbol}`);
                  }}
                >
                  {n.symbol}
                </span>
              ) : null}
              {!real && <ImpactBadge impact={n.impact} />}
              {!real && <SentimentBadge sentiment={n.sentiment} />}
            </div>
            {n.url ? (
              <a className="news-headline" href={n.url} target="_blank" rel="noopener noreferrer">
                {n.headline}
              </a>
            ) : (
              <div className="news-headline">{n.headline}</div>
            )}
            <div className="news-meta">
              <span>{n.source}</span>
              {n.category && n.category !== 'NEWS' ? <span>{n.category}</span> : null}
              <span>{timeAgo(n.publishedAt)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
