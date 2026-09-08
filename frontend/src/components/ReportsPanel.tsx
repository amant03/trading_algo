import type { StockReports } from '../types';

function ReportCard({ title, group }: { title: string; group?: { label: string; period: string | null; links: { label: string; url: string; kind: string }[] } }) {
  if (!group || !group.links.length) {
    return (
      <div className="report-card">
        <div className="report-head">{title}</div>
        <div className="dim" style={{ fontSize: 12 }}>Pending — attached by the next automation run.</div>
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

export default function ReportsPanel({ reports }: { reports: StockReports | null }) {
  if (!reports) {
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
        <ReportCard title="Latest quarterly report" group={reports.quarterly} />
        <ReportCard title="Latest annual report" group={reports.annual} />
      </div>
    </div>
  );
}