import type { StockReports } from '../types';

function defaultReports(symbol: string, name: string): StockReports {
  const q = encodeURIComponent(`${name} quarterly results`);
  const a = encodeURIComponent(`${name} annual report pdf`);
  return {
    quarterly: {
      label: 'Latest quarterly',
      period: null,
      links: [
        { label: 'Screener — quarterly financials', url: `https://www.screener.in/company/${symbol}/#quarters`, kind: 'financials' },
        { label: 'Search latest quarter results', url: `https://www.google.com/search?q=${q}`, kind: 'search' },
      ],
    },
    annual: {
      label: 'Latest annual',
      period: null,
      links: [
        { label: 'Screener — annual financials', url: `https://www.screener.in/company/${symbol}/`, kind: 'financials' },
        { label: 'BSE filings search', url: `https://www.google.com/search?q=${a}+site%3Abseindia.com`, kind: 'search' },
        { label: 'Search annual report PDF', url: `https://www.google.com/search?q=${a}`, kind: 'search' },
      ],
    },
  };
}

function ReportCard({ title, group }: { title: string; group?: { label: string; period: string | null; links: { label: string; url: string; kind: string }[] } }) {
  if (!group || !group.links.length) {
    return (
      <div className="report-card">
        <div className="report-head">{title}</div>
        <div className="dim" style={{ fontSize: 12 }}>No filing links yet.</div>
      </div>
    );
  }
  return (
    <div className="report-card">
      <div className="report-head">
        {title}
        {group.period ? <span className="mono dim">{group.period}</span> : null}
      </div>
      <div className="report-links">
        {group.links.map((l) => (
          <a key={l.url} className="report-link" href={l.url} target="_blank" rel="noopener noreferrer">
            <span className={`rep-dot ${l.kind}`} />
            {l.label}
          </a>
        ))}
      </div>
    </div>
  );
}

export default function ReportsPanel({ symbol, name, reports }: { symbol?: string; name?: string; reports: StockReports | null }) {
  const resolved = reports ?? (symbol ? defaultReports(symbol, name ?? symbol) : null);
  if (!resolved) {
    return (
      <div className="panel reveal">
        <div className="panel-title">
          <h3>Reports &amp; disclosures</h3>
          <span className="hint">quarterly + annual filings</span>
        </div>
        <div className="empty">Report links appear after the next automation run.</div>
      </div>
    );
  }
  return (
    <div className="panel reveal">
      <div className="panel-title">
        <h3>Reports &amp; disclosures</h3>
        <span className="hint">latest quarterly + annual filings &amp; financials</span>
      </div>
      <div className="report-grid">
        <ReportCard title="Latest quarterly report" group={resolved.quarterly} />
        <ReportCard title="Latest annual report" group={resolved.annual} />
      </div>
    </div>
  );
}
