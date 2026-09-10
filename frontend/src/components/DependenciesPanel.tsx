import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DepEntry, DepFile, DepRow } from '../types';

const DEPENDENCY_URLS = [
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/dependencies.json',
  'https://raw.githubusercontent.com/amant03/trading_algo/main/frontend/public/dependencies.json',
  '/dependencies.json',
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@automation-data/frontend/public/dependencies.json',
];

const THRESHOLD_CR = 5000;

let depFile: DepFile | null = null;
let depPromise: Promise<DepFile | null> | null = null;

async function loadDepFile(): Promise<DepFile | null> {
  if (depFile) return depFile;
  if (depPromise) return depPromise;
  depPromise = (async () => {
    for (const url of DEPENDENCY_URLS) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const json = (await res.json()) as DepFile;
        if (json?.data) {
          depFile = json;
          return json;
        }
      } catch { /* try next */ }
    }
    return null;
  })();
  return depPromise;
}

function originLabel(r: DepRow): string {
  if (r.basis === 'inferred-reverse' && r.via?.symbol) return `via ${r.via.symbol}`;
  if (r.basis === 'disclosed-rpt') return 'related-party note';
  if (r.basis === 'disclosed-report') return 'filings';
  return r.source;
}

function shareLabel(r: DepRow): string | null {
  if (r.share && r.share > 0) {
    return `${r.share}% of ${r.side === 'customer' ? 'revenue' : 'cost'}`;
  }
  return null;
}

function DepRowCard({ row }: { row: DepRow }) {
  const navigate = useNavigate();
  const share = shareLabel(row);
  const clickable = Boolean(row.symbol);
  return (
    <button
      type="button"
      className={`dep-row ${row.side}${clickable ? ' go' : ''}`}
      onClick={() => row.symbol && navigate(`/stock/${row.symbol}`)}
      disabled={!clickable}
      title={row.evidence}
    >
      <span className="dep-rail" />
      <span className="dep-body">
        <span className="dep-top">
          <span className="dep-id">{row.symbol ?? row.name}</span>
          {share && <span className="dep-share">{share}</span>}
        </span>
        {row.symbol && <span className="dep-name">{row.name}</span>}
        <span className="dep-origin">{originLabel(row)}</span>
      </span>
    </button>
  );
}

function DepSide({ title, hint, rows, empty }: { title: string; hint: string; rows: DepRow[]; empty: string }) {
  return (
    <div className="dep-side">
      <div className="dep-side-h">
        <span>{title}</span>
        <span>{hint}</span>
      </div>
      {rows.length ? (
        <div className="dep-list">
          {rows.map((r, i) => (
            <DepRowCard key={`${r.side}-${r.symbol ?? r.name}-${i}`} row={r} />
          ))}
        </div>
      ) : (
        <div className="dep-empty">{empty}</div>
      )}
    </div>
  );
}

export default function DependenciesPanel({ symbol, marketCap }: { symbol: string; marketCap: number | null }) {
  const [file, setFile] = useState<DepFile | null>(depFile);
  const [entry, setEntry] = useState<DepEntry | null>(null);
  const [ready, setReady] = useState(Boolean(depFile));

  useEffect(() => {
    let live = true;
    loadDepFile().then((f) => {
      if (!live) return;
      setFile(f);
      setEntry(f?.data?.[symbol] ?? null);
      setReady(true);
    });
    return () => { live = false; };
  }, [symbol]);

  const capCr = marketCap != null && marketCap > 0
    ? (marketCap > 1e7 ? marketCap / 1e7 : marketCap)
    : null;
  const aboveBar = capCr != null && capCr > THRESHOLD_CR;
  const threshold = file?.thresholdCr ?? THRESHOLD_CR;
  const checked = entry?.checkedAt
    ? new Date(entry.checkedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;
  const hasRows = Boolean(entry && (entry.suppliers.length || entry.customers.length));
  const onlyFact = Boolean(entry?.note) && !hasRows;

  return (
    <div className="panel reveal dep-panel">
      <div className="panel-title">
        <h3>Dependencies — {symbol}</h3>
        <span className="hint">cost vs revenue · weekly filings</span>
      </div>

      {!ready ? (
        <div className="empty">Loading supply-chain map…</div>
      ) : !file ? (
        <div className="empty">
          Dependency map is not published yet — the next weekly automation run will start covering names above ₹{threshold.toLocaleString('en-IN')} cr.
        </div>
      ) : hasRows || entry?.note ? (
        <>
          {entry?.note && (
            <div className="dep-note">{entry.note}</div>
          )}
          <div className="dep-split">
            <DepSide
              title="Cost"
              hint="inputs · suppliers"
              rows={entry?.suppliers ?? []}
              empty={onlyFact ? 'No concentrated suppliers disclosed.' : 'No disclosed input counterparties yet.'}
            />
            <DepSide
              title="Revenue"
              hint="outputs · customers"
              rows={entry?.customers ?? []}
              empty={onlyFact ? 'Customer book is diversified — no single offtaker named.' : 'No disclosed offtake counterparties yet.'}
            />
          </div>
          <div className="dep-foot">
            Ranked by disclosed share of revenue/cost, then related-party amounts.
            Names other listed companies report as dealing with {symbol} are included and marked “via”.
            {checked && <> Last checked {checked}.</>}
            {entry?.sources?.length ? (
              <>
                {' '}Sources:{' '}
                {entry.sources.map((s, i) => (
                  <span key={s.url}>
                    {i > 0 && ' · '}
                    <a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a>
                  </span>
                ))}
              </>
            ) : null}
          </div>
        </>
      ) : entry && !hasRows ? (
        <div className="empty">
          Filings for {symbol} were read{checked ? ` on ${checked}` : ''} — no named suppliers or customers were disclosed.
          If another listed company names {symbol} as a counterparty, it will appear here on the next weekly pass.
        </div>
      ) : aboveBar ? (
        <div className="empty">
          {symbol} clears the ₹{threshold.toLocaleString('en-IN')} cr coverage bar and is in the weekly rotation
          ({file.coverage}/{file.universe} names mapped). It will land here as soon as this week’s batch reaches it.
        </div>
      ) : (
        <div className="empty">
          Direct filing reads start at ₹{threshold.toLocaleString('en-IN')} cr market cap so mid-cap and large-cap names are covered first.
          {symbol} still appears here when a covered company names it as a supplier or customer.
        </div>
      )}
    </div>
  );
}
