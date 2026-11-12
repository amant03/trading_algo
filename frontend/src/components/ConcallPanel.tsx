import { useEffect, useState } from 'react';
import type { ConcallBrief, ConcallEntry, ConcallImpact, ConcallSwot } from '../types';
import { fetchWithTimeout } from '../api';

const cache = new Map<string, ConcallEntry | null>();
const inflight = new Map<string, Promise<ConcallEntry | null>>();

function urlsFor(symbol: string): string[] {
  const file = `${encodeURIComponent(symbol)}.json`;
  return [
    `https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/cc/${file}`,
    `https://raw.githubusercontent.com/amant03/trading_algo/main/frontend/public/cc/${file}`,
    `/cc/${file}`,
  ];
}

async function loadConcall(symbol: string): Promise<ConcallEntry | null> {
  const key = symbol.trim().toUpperCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;
  const pending = inflight.get(key);
  if (pending) return pending;
  const task = (async () => {
    for (const url of urlsFor(key)) {
      try {
        const res = await fetchWithTimeout(url, { cache: 'no-store' }, 12000);
        if (!res.ok) continue;
        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('text/html')) continue;
        const json = (await res.json()) as ConcallEntry;
        if (!json || json.symbol !== key) continue;
        cache.set(key, json);
        return json;
      } catch { /* next source */ }
    }
    cache.set(key, null);
    return null;
  })().finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

function pct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function toneColor(tone: ConcallBrief['tone']): string {
  if (tone === 'confident') return 'var(--up)';
  if (tone === 'cautious') return 'var(--amber)';
  return 'var(--cyan)';
}

function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const SWOT: { key: keyof ConcallSwot; label: string }[] = [
  { key: 'willDo', label: 'What management says it will do' },
  { key: 'willEndure', label: 'What it will endure, and how' },
  { key: 'strengths', label: 'Strengths they cite' },
  { key: 'weaknesses', label: 'Weaknesses they acknowledge' },
  { key: 'opportunities', label: 'Opportunities' },
  { key: 'threats', label: 'Threats' },
];

function SwotGrid({ swot }: { swot: ConcallSwot }) {
  return (
    <div className="cc-swot">
      {SWOT.map((row) => (
        <div key={row.key} className="cc-card">
          <div className="cc-k">{row.label}</div>
          {swot[row.key].length ? swot[row.key].map((line) => (
            <p key={line} className="cc-li">{line}</p>
          )) : <p className="cc-li">Not stated in this transcript.</p>}
        </div>
      ))}
    </div>
  );
}

function ImpactTable({ rows }: { rows: ConcallImpact[] }) {
  if (!rows.length) return <div className="empty">No price window yet — the next daily run fills this once the filing date is known.</div>;
  return (
    <div className="cc-table-wrap">
      <table className="cc-table">
        <thead>
          <tr>
            <th>Filing</th>
            <th>When</th>
            <th>1-day</th>
            <th>5 sessions</th>
            <th>vs Nifty, 5 sessions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.kind}-${r.url}`}>
              <td>
                <a href={r.url} target="_blank" rel="noopener noreferrer">{r.label}</a>
                <div className="dim" style={{ fontSize: 10.5, marginTop: 2 }}>{r.kind.replace('-', ' ')}</div>
              </td>
              <td className="mono">{when(r.date)}</td>
              <td className={r.return1d != null && r.return1d >= 0 ? 'up' : 'down'}>{pct(r.return1d)}</td>
              <td className={r.return5d != null && r.return5d >= 0 ? 'up' : 'down'}>{pct(r.return5d)}</td>
              <td className={r.excess5d != null && r.excess5d >= 0 ? 'up' : 'down'}>{pct(r.excess5d)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ConcallPanel({ symbol, compact = false }: { symbol: string; compact?: boolean }) {
  const [entry, setEntry] = useState<ConcallEntry | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setEntry(undefined);
    loadConcall(symbol).then((row) => {
      if (live) setEntry(row);
    });
    return () => { live = false; };
  }, [symbol]);

  if (entry === undefined) {
    if (compact) return null;
    return <div className="panel"><div className="empty">Loading the concall read…</div></div>;
  }
  if (!entry?.latest) {
    if (compact) return null;
    return (
      <div className="panel">
        <div className="panel-title">
          <h3>Concall</h3>
          <span className="hint">screener.in transcript</span>
        </div>
        <div className="empty">
          {entry?.checkedAt
            ? `Checked ${when(entry.checkedAt)}. Screener has no transcript linked for ${symbol} yet. Announcements and ratings still show below when the page lists them.`
            : `No concall read for ${symbol} yet. The daily automation downloads the latest transcript, annual report, credit rating and announcements from Screener and publishes this section.`}
        </div>
        {entry?.announcements?.length ? entry.announcements.slice(0, 4).map((a) => (
          <div key={a.url} className="news-art">
            <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a>
            <div className="news-meta"><span>{when(a.date)}</span></div>
          </div>
        )) : null}
      </div>
    );
  }

  const call = entry.latest;
  if (compact) {
    return (
      <div className="panel reveal" style={{ marginTop: 16 }}>
        <div className="panel-title">
          <h3>Concall · {call.period ?? 'latest'}</h3>
          <span className="cc-tone" style={{ color: toneColor(call.tone) }}>{call.tone}</span>
        </div>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, marginTop: 0 }}>{call.summary}</p>
        <div className="hint">Open the Concalls tab for the SWOT, the price reaction, and the headlines that line up.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel">
        <div className="panel-title">
          <h3>Concall · {call.period ?? entry.symbol}</h3>
          <span className="cc-tone" style={{ color: toneColor(call.tone) }}>{call.tone}</span>
        </div>
        <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.55 }}>{call.summary}</p>
        <div className="hint" style={{ marginBottom: 10 }}>
          Lines are taken from the transcript
          {call.eventDate ? ` · call ${when(call.eventDate)}` : ''}
          {entry.checkedAt ? ` · checked ${when(entry.checkedAt)}` : ''}
          {' · '}
          <a href={call.url} target="_blank" rel="noopener noreferrer">source PDF</a>
        </div>
        {call.highlights.length > 0 && (
          <ul style={{ margin: '0 0 14px', paddingLeft: 18 }}>
            {call.highlights.map((h) => <li key={h} className="cc-li">{h}</li>)}
          </ul>
        )}
        <SwotGrid swot={call.swot} />
      </div>

      {entry.prior?.summary && (
        <div className="panel">
          <div className="panel-title">
            <h3>Previous call · {entry.prior.period ?? 'prior'}</h3>
            <span className="cc-tone" style={{ color: toneColor(entry.prior.tone) }}>{entry.prior.tone}</span>
          </div>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{entry.prior.summary}</p>
          {entry.prior.url && (
            <a href={entry.prior.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>Previous transcript</a>
          )}
        </div>
      )}

      <div className="panel">
        <div className="panel-title">
          <h3>How the filing moved the price</h3>
          <span className="hint">close vs prior close · excess is versus Nifty</span>
        </div>
        <ImpactTable rows={entry.impacts} />
      </div>

      <div className="panel">
        <div className="panel-title">
          <h3>News that lines up</h3>
          <span className="hint">same themes as the call</span>
        </div>
        {entry.newsMatches.length ? entry.newsMatches.map((n) => (
          <div key={n.url} className="news-art">
            <a href={n.url} target="_blank" rel="noopener noreferrer">{n.title}</a>
            <div className="news-meta">
              <span>{n.source}</span>
              <span>{n.aroundFiling ? 'around the filing' : 'later headline'}</span>
              {n.overlap && <span>overlap {n.overlap}</span>}
            </div>
          </div>
        )) : <div className="empty">No stored headline shares a distinctive phrase with this call.</div>}
      </div>

      <div className="report-grid">
        <div className="report-card">
          <div className="report-head">Annual report {entry.annual?.year ?? ''}</div>
          {entry.annual ? (
            <>
              <p className="cc-li">{entry.annual.summary || 'Linked. The daily reader keeps a short extract when the PDF is small enough to read.'}</p>
              <a className="report-link" href={entry.annual.url} target="_blank" rel="noopener noreferrer">
                <span className="rep-dot" />{entry.annual.label}
              </a>
            </>
          ) : <div className="dim" style={{ fontSize: 12 }}>No annual report link on the company page yet.</div>}
        </div>
        <div className="report-card">
          <div className="report-head">Credit rating</div>
          {entry.rating ? (
            <>
              <p className="cc-li">
                <b style={{ color: entry.rating.action === 'downgraded' ? 'var(--down)' : entry.rating.action === 'upgraded' ? 'var(--up)' : 'inherit' }}>
                  {entry.rating.action}
                </b>
                {entry.rating.date ? ` · ${when(entry.rating.date)}` : ''}
                {entry.rating.summary ? ` — ${entry.rating.summary}` : ''}
              </p>
              <a className="report-link" href={entry.rating.url} target="_blank" rel="noopener noreferrer">
                <span className="rep-dot" />{entry.rating.label}
              </a>
            </>
          ) : <div className="dim" style={{ fontSize: 12 }}>No credit-rating link on the company page.</div>}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">
          <h3>Announcements</h3>
          <span className="hint">latest filings on the company page</span>
        </div>
        {entry.announcements.length ? entry.announcements.map((a) => (
          <div key={a.url} className="news-art">
            <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a>
            <div className="news-meta">
              <span>{when(a.date)}</span>
            </div>
            {a.summary && a.summary !== a.title && <p className="cc-li" style={{ marginTop: 4 }}>{a.summary}</p>}
          </div>
        )) : <div className="empty">No recent announcements listed.</div>}
      </div>
    </div>
  );
}
