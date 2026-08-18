import { useNavigate } from 'react-router-dom';
import { ImpactBadge, SentimentBadge } from './Badge';
import { timeAgo } from '../format';
import type { NewsItem } from '../types';

export default function NewsFeed({ items, limit = 15 }: { items: NewsItem[]; limit?: number }) {
  const navigate = useNavigate();
  if (!items.length) return <div className="empty">No news yet.</div>;
  return (
    <div className="feed">
      {items.slice(0, limit).map((n) => (
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
            <ImpactBadge impact={n.impact} />
            <SentimentBadge sentiment={n.sentiment} />
          </div>
          <div className="news-headline">{n.headline}</div>
          <div className="news-meta">
            <span>{n.source}</span>
            <span>{n.category}</span>
            <span>{timeAgo(n.publishedAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
