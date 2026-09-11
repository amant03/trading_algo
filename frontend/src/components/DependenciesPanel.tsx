import { useEffect, useMemo, useState } from 'react';
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

type MixKind = 'filing' | 'rpt-mix' | 'unquantified';

interface WeightedRow {
  row: DepRow;
  pct: number | null;
  kind: MixKind;
}

function disclosedPct(r: DepRow): number | null {
  const ev = (r.evidence ?? '').toLowerCase();
  if (/yoy|holdings? %|% of holdings|net sales at|crossed/.test(ev)) return null;
  const fromText = ev.match(
    /(\d{1,2}(?:\.\d+)?)\s*%\s+of\s+(?:the\s+)?(?:group'?s?\s+)?(?:consolidated\s+)?(?:revenue|sales|turnover|purchases|cost|raw materials?)/,
  );
  if (fromText) {
    const n = Number(fromText[1]);
    if (n > 0 && n <= 100) return n;
  }
  if (r.share && r.share > 0 && r.share <= 100) {
    if (/% of (revenue|sales|turnover|income|purchases|cost|raw material)|accounts for|contributes/.test(ev)) return r.share;
  }
  return null;
}

function weightRows(rows: DepRow[]): WeightedRow[] {
  const filing = new Map<DepRow, number>();
  for (const r of rows) {
    const p = disclosedPct(r);
    if (p != null) filing.set(r, p);
  }
  const amtTotal = rows.reduce((s, r) => s + (r.amount && r.amount > 0 ? r.amount : 0), 0);
  return rows.map((row) => {
    const filed = filing.get(row);
    if (filed != null) return { row, pct: filed, kind: 'filing' as const };
    if (row.amount && row.amount > 0 && amtTotal > 0) {
      return { row, pct: (row.amount / amtTotal) * 100, kind: 'rpt-mix' as const };
    }
    return { row, pct: null, kind: 'unquantified' as const };
  });
}

function pctLabel(w: WeightedRow, side: 'supplier' | 'customer'): string {
  if (w.pct == null) return 'Share not quantified';
  const n = w.pct >= 10 ? w.pct.toFixed(0) : w.pct.toFixed(1);
  if (w.kind === 'filing') {
    return side === 'customer' ? `${n}% of revenue` : `${n}% of purchases`;
  }
  return side === 'customer'
    ? `${n}% of disclosed sales to named counterparties`
    : `${n}% of disclosed purchases from named counterparties`;
}

function originLabel(r: DepRow): string {
  if (r.basis === 'inferred-reverse' && r.via?.symbol) return `Inferred from ${r.via.symbol} filings`;
  if (r.basis === 'disclosed-rpt') return 'Related-party note in the annual report';
  if (r.basis === 'disclosed-report') return r.source;
  return r.source;
}

function explainRow(self: string, w: WeightedRow): string {
  const r = w.row;
  const who = r.symbol ? `${r.name} (${r.symbol})` : r.name;
  const src = r.source;

  if (r.basis === 'inferred-reverse' && r.via) {
    const via = `${r.via.name} (${r.via.symbol})`;
    if (r.side === 'supplier') {
      return `${via} named ${self} as a customer in its ${src.replace(/^.*·\s*/, '')}. That means ${self} buys from ${who} — this name sits on the cost / input side of ${self}. ${via} did not state what percentage of its own sales (or of ${self}'s purchases) this flow represents, so the weight is unquantified until a filing puts a number on it.`;
    }
    return `${via} named ${self} as a supplier in its ${src.replace(/^.*·\s*/, '')}. That means ${self} sells to ${who} — this name sits on the revenue / offtake side of ${self}. The counterparty filing did not quantify the share of ${self}'s sales that this offtake represents.`;
  }

  if (r.side === 'supplier') {
    if (w.kind === 'filing' && w.pct != null) {
      return `${self} disclosed that ${who} accounts for ${w.pct.toFixed(1)}% of its purchases / input cost, per ${src}. A large percentage here is a cost-side concentration: disruption at this supplier would hit ${self}'s input bill and margins more than a diversified vendor book would.`;
    }
    if (w.kind === 'rpt-mix' && w.pct != null) {
      return `${self} recorded purchase / service transactions with ${who} in its related-party note (${src}). Among the named counterparties on the cost side in that filing, this name is ${w.pct.toFixed(1)}% of the disclosed rupee amounts. That is a share of disclosed related-party purchases — not automatically of total raw-material cost — but it is the best size the company itself put on the relationship.`;
    }
    return `${self} named ${who} as a supplier / input counterparty in ${src}, without putting a percentage of total purchases on the relationship. The filing confirms the dependency; the weight of the cost book is not stated.`;
  }

  if (w.kind === 'filing' && w.pct != null) {
    return `${self} disclosed that ${who} accounts for ${w.pct.toFixed(1)}% of its revenue / sales, per ${src}. That is a revenue-side concentration: this offtaker takes a material slice of what ${self} sells, so a lost contract or slower offtake here would show up in the top line.`;
  }
  if (w.kind === 'rpt-mix' && w.pct != null) {
    return `${self} recorded sale / service income from ${who} in its related-party note (${src}). Among the named counterparties on the revenue side in that filing, this name is ${w.pct.toFixed(1)}% of the disclosed rupee amounts. That is a share of disclosed related-party sales — not automatically of total turnover — but it is the size the company attached to this offtake.`;
  }
  return `${self} named ${who} as a customer / offtaker in ${src}, without stating what percentage of total sales this offtake is. The relationship is disclosed; the share of the revenue book is not.`;
}

function DepCard({ self, w }: { self: string; w: WeightedRow }) {
  const navigate = useNavigate();
  const r = w.row;
  const clickable = Boolean(r.symbol);
  const bar = Math.max(0, Math.min(100, w.pct ?? 0));
  return (
    <article
      className={`dep-card ${r.side}${clickable ? ' go' : ''}`}
      onClick={() => r.symbol && navigate(`/stock/${r.symbol}`)}
      role={clickable ? 'link' : undefined}
    >
      <div className="dep-card-top">
        <div>
          <div className="dep-id">{r.symbol ?? r.name}</div>
          {r.symbol && <div className="dep-name">{r.name}</div>}
        </div>
        <div className={`dep-pct ${w.kind}`}>
          <span className="dep-pct-n">{w.pct != null ? `${w.pct >= 10 ? w.pct.toFixed(0) : w.pct.toFixed(1)}%` : '—'}</span>
          <span className="dep-pct-k">{pctLabel(w, r.side)}</span>
        </div>
      </div>
      <div className="dep-mix">
        <span style={{ width: `${bar}%` }} />
      </div>
      <p className="dep-copy">{explainRow(self, w)}</p>
      {r.evidence && (
        <blockquote className="dep-quote">“{r.evidence.trim()}”</blockquote>
      )}
      <div className="dep-origin">{originLabel(r)}{clickable ? ' · click to open this stock' : ''}</div>
    </article>
  );
}

function DepColumn({
  title,
  kicker,
  self,
  rows,
  empty,
}: {
  title: string;
  kicker: string;
  self: string;
  rows: DepRow[];
  empty: string;
}) {
  const weighted = useMemo(() => weightRows(rows), [rows]);
  const known = weighted.filter((w) => w.pct != null);
  const top = known[0];
  return (
    <section className="dep-col">
      <div className="dep-side-h">
        <span>{title}</span>
        <span>{kicker}</span>
      </div>
      {top && (
        <p className="dep-lead">
          {rows.length} named counterpart{rows.length === 1 ? 'y' : 'ies'}.
          The largest quantified name is <b>{top.row.symbol ?? top.row.name}</b> at {pctLabel(top, top.row.side)}.
        </p>
      )}
      {weighted.length ? (
        <div className="dep-list">
          {weighted.map((w, i) => (
            <DepCard key={`${w.row.side}-${w.row.symbol ?? w.row.name}-${i}`} self={self} w={w} />
          ))}
        </div>
      ) : (
        <div className="dep-empty">{empty}</div>
      )}
    </section>
  );
}

function DepSummary({ entry }: { entry: DepEntry }) {
  const rows = [
    ...entry.suppliers.map((r) => ({ r, side: 'supplier' as const })),
    ...entry.customers.map((r) => ({ r, side: 'customer' as const })),
  ];
  const mcapAxes = [
    ...entry.costSplit?.map((c) => `${c.label}: ${c.pct}%`) ?? [],
    ...entry.revenueGeo?.map((g) => `${g.label}: ${g.pct}%`) ?? [],
  ];
  return (
    <div className="dep-block">
      {entry.about?.text && (
        <section className="dep-summary-sec">
          <div className="dep-sec-h"><span>What the business is</span></div>
          <p className="dep-about">{entry.about.text}</p>
          {entry.about.highlights.length > 0 && (
            <ul className="dep-hl">
              {entry.about.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      {(entry.costSplit || entry.revenueGeo) && mcapAxes.length > 0 && (
        <section className="dep-summary-sec">
          <div className="dep-sec-h"><span>Where the money goes & comes from</span></div>
          <ul className="dep-geo">
            {mcapAxes.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </section>
      )}
      {entry.factors && entry.factors.length > 0 && (
        <section className="dep-summary-sec">
          <div className="dep-sec-h"><span>What can move the stock</span></div>
          <ul className="dep-factors">
            {entry.factors.map((f, i) => (
              <li key={i} className="dep-factor">
                <span className="dep-factor-label">{f.label}</span>
                {f.evidence && <span className="dep-factor-ev">“{f.evidence.trim()}”</span>}
                {f.source && <span className="dep-factor-src">— {f.source}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {rows.length > 0 && (
        <section className="dep-summary-sec">
          <div className="dep-sec-h"><span>Counterparty map</span></div>
          <p className="dep-about">
            {rows.length} named counterpart{rows.length === 1 ? 'y' : 'ies'}:{' '}
            {rows.map(({ r }) => r.symbol ?? r.name).join(', ')}.
          </p>
        </section>
      )}
    </div>
  );
}

export default function DependenciesPanel({
  symbol,
  name,
  marketCap,
}: {
  symbol: string;
  name?: string | null;
  marketCap: number | null;
}) {
  const [file, setFile] = useState<DepFile | null>(depFile);
  const [entry, setEntry] = useState<DepEntry | null>(null);
  const [ready, setReady] = useState(Boolean(depFile));
  const self = name?.trim() || symbol;

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
    <div className="panel reveal dep-panel dep-page">
      <div className="panel-title">
        <h3>Dependencies — {symbol}</h3>
        <span className="hint">inputs vs offtake · from company filings</span>
      </div>

      <p className="dep-intro">
        This page maps who <b>{self}</b> depends on for <b>inputs (cost / suppliers)</b> and who it depends on
        for <b>output (revenue / customers)</b>. Names are taken only from what the company (or a listed
        counterparty) disclosed in an annual report, rating rationale, concall or investor presentation —
        nothing is estimated from sector folklore. Where the filing states a percentage of revenue or
        purchases, that figure is shown as a share of the whole book. Where only related-party rupee
        amounts exist, the percentage is that name’s share of the <i>disclosed named counterparties</i> on
        that side, not of total turnover or total COGS.
      </p>

      {!ready ? (
        <div className="empty">Loading supply-chain map…</div>
      ) : !file ? (
        <div className="empty">
          The dependency map is not published yet. The weekly automation will start covering names above ₹{threshold.toLocaleString('en-IN')} cr.
        </div>
      ) : hasRows || entry?.note ? (
        <>
          {entry?.about && <DepSummary entry={entry} />}
          {entry?.note && <div className="dep-note">{entry.note}</div>}
          <div className="dep-split">
            <DepColumn
              title="Cost — suppliers & inputs"
              kicker="who it buys from"
              self={self}
              rows={entry?.suppliers ?? []}
              empty={onlyFact ? 'No concentrated suppliers were disclosed. The cost book is not concentrated on a named vendor in the latest filings.' : 'No disclosed input counterparties yet.'}
            />
            <DepColumn
              title="Revenue — customers & offtake"
              kicker="who it sells to"
              self={self}
              rows={entry?.customers ?? []}
              empty={onlyFact ? 'The customer book is disclosed as diversified — no single offtaker is named as material.' : 'No disclosed offtake counterparties yet.'}
            />
          </div>
          <div className="dep-foot">
            {checked && <>Filings last read on {checked}. </>}
            Percentages labelled “of disclosed purchases/sales” are the mix among named related-party counterparties in the annual report; they are not claimed as a share of total COGS or total revenue unless the filing itself says so.
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
          Filings for {self} were read{checked ? ` on ${checked}` : ''} — no named suppliers or customers were disclosed.
          If another listed company names {symbol} as a counterparty, that reverse link will appear here on the next weekly pass.
        </div>
      ) : aboveBar ? (
        <div className="empty">
          {self} clears the ₹{threshold.toLocaleString('en-IN')} cr coverage bar and is in the weekly rotation
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
