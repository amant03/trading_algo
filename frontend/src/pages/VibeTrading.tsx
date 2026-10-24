import { useEffect, useMemo, useState } from 'react';
import { fmtPct } from '../format';
import { benchSparks, type FactorScore } from '../vibe/alphaBench';
import {
  ADR_PAIRS,
  FX_TICKER,
  SWARM,
  VENUE_PAIRS,
  agentCopy,
  buildReview,
  quoteArbitrage,
  swarmBrief,
  type ArbRow,
  type DeskReview,
  type FundStock,
  type JournalTrade,
} from '../vibe/deskReview';
import { DESK, type DeskInstrument } from '../vibe/markets';
import type { Bar } from '../vibe/engine';

interface Tape {
  ticker: string;
  currency: string;
  last: number;
  changePct: number;
  error?: string;
}

type Section = 'review' | 'shadow' | 'swarm' | 'alpha' | 'lab' | 'sources';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'review', label: 'Review' },
  { id: 'shadow', label: 'Shadow' },
  { id: 'swarm', label: 'Swarm' },
  { id: 'alpha', label: 'Alpha' },
  { id: 'lab', label: 'Lab' },
  { id: 'sources', label: 'Sources' },
];

const inr = (n: number) => `${n < 0 ? '-' : ''}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;

function formatQuote(price: number, currency: string): string {
  const digits = price >= 1000 ? 0 : 2;
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return price.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

async function loadLast(ticker: string): Promise<{ price: number; currency: string; changePct: number }> {
  const res = await fetch(`/api/vibe?ticker=${encodeURIComponent(ticker)}&range=5d`, { cache: 'no-store' });
  const body = (await res.json()) as { currency?: string; rows?: Bar[]; error?: string };
  if (!res.ok || !body.rows || body.rows.length < 2) throw new Error(body.error || 'no bars');
  const last = body.rows[body.rows.length - 1];
  const prev = body.rows[body.rows.length - 2];
  return {
    price: last.c,
    currency: body.currency || '',
    changePct: prev.c > 0 ? (last.c / prev.c - 1) * 100 : 0,
  };
}

export default function VibeTrading() {
  const [section, setSection] = useState<Section>('review');
  const [tape, setTape] = useState<Record<string, Tape>>({});
  const [review, setReview] = useState<DeskReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [arbs, setArbs] = useState<ArbRow[]>([]);
  const [arbState, setArbState] = useState('Reading same-company prices…');
  const [factors, setFactors] = useState<FactorScore[]>([]);
  const [remembered, setRemembered] = useState<string | null>(null);
  const [swarm, setSwarm] = useState(SWARM[0].id);

  useEffect(() => {
    let live = true;
    DESK.forEach((item) => {
      loadLast(item.ticker)
        .then((quote) => {
          if (!live) return;
          setTape((curr) => ({
            ...curr,
            [item.ticker]: { ticker: item.ticker, currency: quote.currency, last: quote.price, changePct: quote.changePct },
          }));
        })
        .catch(() => {
          if (!live) return;
          setTape((curr) => ({ ...curr, [item.ticker]: { ticker: item.ticker, currency: '', last: 0, changePct: 0, error: 'unavailable' } }));
        });
    });

    Promise.all([
      fetch('/paper/latest.json', { cache: 'no-store' }).then((res) => res.json()),
      fetch('/analysis.json', { cache: 'no-store' }).then((res) => res.json()),
    ])
      .then(([paper, analysis]: [{ transactions?: JournalTrade[] }, { stocks?: Record<string, FundStock>; sparklines?: Record<string, [number, number][]> }]) => {
        if (!live) return;
        const next = buildReview(paper.transactions ?? [], analysis.stocks ?? {});
        setReview(next);
        setFactors(benchSparks(analysis.sparklines ?? {}));
        if (next.adopted) {
          const memory = { id: next.adopted.id, label: next.adopted.label, to: next.to };
          localStorage.setItem('vibe-desk-rule-v2', JSON.stringify(memory));
          setRemembered(next.adopted.label);
        } else {
          const raw = localStorage.getItem('vibe-desk-rule-v2');
          setRemembered(raw ? 'The last adopted rule is still stored, and this pass did not replace it.' : null);
        }
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : 'The journal could not be read');
      });

    const tickers = new Set<string>([FX_TICKER]);
    VENUE_PAIRS.forEach(([ns, bo]) => {
      tickers.add(ns);
      tickers.add(bo);
    });
    ADR_PAIRS.forEach((pair) => {
      tickers.add(pair.adr);
      tickers.add(pair.local);
    });
    Promise.all(
      [...tickers].map(async (ticker) => {
        try {
          const quote = await loadLast(ticker);
          return [ticker, quote.price] as const;
        } catch {
          return [ticker, 0] as const;
        }
      }),
    ).then((rows) => {
      if (!live) return;
      const prices: Record<string, number> = {};
      rows.forEach(([ticker, price]) => {
        if (price > 0) prices[ticker] = price;
      });
      const found = quoteArbitrage(prices);
      setArbs(found);
      setArbState(found.length ? '' : 'A price leg did not come back, so the arb board is empty.');
    });

    return () => {
      live = false;
    };
  }, []);

  const agents = useMemo(() => (review ? agentCopy(review, arbs) : null), [review, arbs]);
  const brief = review ? swarmBrief(swarm, review, arbs) : '';

  return (
    <div className="vibe">
      <header className="vibe-hero">
        <div>
          <div className="vibe-kicker">Vibe-Trading · book review</div>
          <h1>Read the trades. Then the price. Then the gap.</h1>
          <p>
            This review does not ask for a symbol. It attributes the paper journal, screens the fundamental book for quality that is still cheap, and compares two prices for the same company. A rule is kept only when the later sells still make more money.
          </p>
        </div>
        <div className="vibe-density">
          <span>Closed sells</span>
          <strong>{review ? review.closed.length : '…'}</strong>
          <em>{review ? `${review.from} → ${review.to}` : 'Reading the journal'}</em>
        </div>
      </header>

      <div className="vibe-board" aria-label="Cross-market tape">
        {DESK.map((item: DeskInstrument) => {
          const row = tape[item.ticker];
          return (
            <div key={item.ticker} className="vibe-chip">
              <span className="vibe-chip-mkt">{item.market}</span>
              <span className="vibe-chip-sym">{item.label}</span>
              {row?.error ? (
                <span className="dim">unavailable</span>
              ) : row ? (
                <span className={row.changePct >= 0 ? 'up' : 'down'}>
                  {formatQuote(row.last, row.currency)} {row.currency} {fmtPct(row.changePct)}
                </span>
              ) : (
                <span className="dim">loading</span>
              )}
            </div>
          );
        })}
      </div>

      <nav className="vibe-tabs" aria-label="Vibe-Trading sections">
        {SECTIONS.map((item) => (
          <button key={item.id} type="button" className={section === item.id ? 'on' : ''} onClick={() => setSection(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>

      {error && <div className="vibe-error">{error}</div>}
      {remembered && <p className="vibe-note">Remembered in this browser: {remembered}</p>}

      {section === 'review' && (
        <Review review={review} agents={agents} arbs={arbs} arbState={arbState} />
      )}
      {section === 'shadow' && review && <Shadow review={review} />}
      {section === 'swarm' && review && (
        <section className="vibe-card">
          <h2>Swarm</h2>
          <p className="vibe-reason">Each preset reads the journal, the value screen, or the same-company gaps. A preset with no book stays quiet.</p>
          <div className="vibe-tabs">
            {SWARM.map((item) => (
              <button key={item.id} type="button" className={swarm === item.id ? 'on' : ''} onClick={() => setSwarm(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <p>{brief}</p>
        </section>
      )}
      {section === 'alpha' && <Alpha factors={factors} />}
      {section === 'lab' && review && <Lab review={review} factors={factors} />}
      {section === 'sources' && <Sources />}

      <p className="vibe-attrib">
        The workflow follows the Vibe-Trading research desk: route, ground, test, deliver. Figures are counted from the paper journal and the fundamental book. No order is sent.
      </p>
    </div>
  );
}

function Review({
  review,
  agents,
  arbs,
  arbState,
}: {
  review: DeskReview | null;
  agents: { quant: string; risk: string; shadow: string } | null;
  arbs: ArbRow[];
  arbState: string;
}) {
  if (!review || !agents) return <p className="vibe-wait">Reading the journal and the fundamental book.</p>;
  const path = cumulative(review.closed.map((row) => row.pnl));
  return (
    <>
      <ol className="vibe-steps">
        <li>Route the journal, the fundamental book, and the same-company quotes.</li>
        <li>Ground every rupee in a sell, a fair-value gap, or two live prices.</li>
        <li>Test rule changes on the earlier sells, then on the later sells.</li>
        <li>Deliver the cause, the cheap quality, and the gap. Leave the rest unadopted.</li>
      </ol>

      <section className="vibe-card">
        <div className="vibe-card-head">
          <div>
            <div className="vibe-kicker">{review.trainCount} earlier sells · {review.testCount} later sells</div>
            <h2>Root causes</h2>
          </div>
          <span className={review.adopted ? 'vibe-badge ok' : 'vibe-badge'}>{review.adopted ? 'Rule adopted' : 'Book unchanged'}</span>
        </div>
        <p className="vibe-reason">{review.reason}</p>
        <div className="vibe-causes">
          {review.causes.map((cause) => (
            <article key={cause.id}>
              <h3>{cause.title}</h3>
              <p>{cause.detail}</p>
            </article>
          ))}
        </div>
        <EquityChart values={path} label="Cumulative closed-sell PnL" />
        <h3>Rule search</h3>
        <table className="vibe-table">
          <thead>
            <tr>
              <th>Rule</th>
              <th>Earlier</th>
              <th>Later</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {review.rules.map((rule) => (
              <tr key={rule.id} className={rule.adopted ? 'on' : ''}>
                <td>{rule.label}</td>
                <td className={rule.trainPnl >= 0 ? 'up' : 'down'}>{inr(rule.trainPnl)}</td>
                <td className={rule.testPnl >= 0 ? 'up' : 'down'}>{inr(rule.testPnl)}</td>
                <td>{rule.id === 'book' ? 'baseline' : rule.adopted ? 'adopted' : rule.trainBeat && rule.holdoutBeat ? 'eligible' : 'rejected'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="vibe-split">
        <article className="vibe-agent">
          <header>Quant</header>
          <p>{agents.quant}</p>
        </article>
        <article className="vibe-agent">
          <header>Risk</header>
          <p>{agents.risk}</p>
        </article>
        <article className="vibe-agent">
          <header>Shadow</header>
          <p>{agents.shadow}</p>
        </article>
      </section>

      <section className="vibe-card">
        <h2>Value for money</h2>
        <p className="vibe-reason">Known ROE of at least 12, PE at most 22, and a last price 20–80% under the modelled fair value. A wider gap is a broken model, not a bargain.</p>
        {review.deals.length === 0 ? (
          <p>Nothing in the fundamental book clears the gate.</p>
        ) : (
          <table className="vibe-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Under fair value</th>
                <th>PE</th>
                <th>ROE</th>
                <th>Journal</th>
              </tr>
            </thead>
            <tbody>
              {review.deals.map((deal) => (
                <tr key={deal.symbol}>
                  <td>
                    <b>{deal.symbol}</b>
                    <div className="dim">{deal.name} · {deal.sector}</div>
                  </td>
                  <td className="up">{deal.marginOfSafety.toFixed(0)}%</td>
                  <td>{deal.pe ?? '—'}</td>
                  <td>{deal.roe == null ? '—' : `${deal.roe.toFixed(1)}%`}</td>
                  <td>{deal.traded ? 'already traded' : 'not in the journal'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="vibe-card">
        <h2>Same-company gaps</h2>
        <p className="vibe-reason">NSE against BSE, and ADRs against the local line using the issuer share count and USDINR. A gap inside dealing costs is not a trade.</p>
        {arbState && <p>{arbState}</p>}
        {arbs.length > 0 && (
          <table className="vibe-table">
            <thead>
              <tr>
                <th>Pair</th>
                <th>Gap</th>
                <th>Read</th>
              </tr>
            </thead>
            <tbody>
              {arbs.map((row) => (
                <tr key={row.id}>
                  <td>{row.pair}</td>
                  <td className={Math.abs(row.gapPct) >= (row.kind === 'adr' ? 1.5 : 0.4) ? 'amber' : ''}>{fmtPct(row.gapPct)}</td>
                  <td>{row.note} {row.actionable ? 'Wide enough to study after costs.' : 'Inside costs.'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function Shadow({ review }: { review: DeskReview }) {
  return (
    <section className="vibe-card">
      <h2>Shadow account</h2>
      <ol className="vibe-steps">
        <li>Read the journal: {review.closed.length} closed sells, {review.from} to {review.to}.</li>
        <li>Profile behavior: mean sell resampled between {inr(review.bootstrap.low)} and {inr(review.bootstrap.high)}. {review.stopSlipCount} of {review.stopCount} stops went past -8.5%.</li>
        <li>Extract the rule the earlier sells support: {review.adopted ? review.adopted.label : 'none that the later sells also support'}.</li>
        <li>Run that rule on the later sells and keep it only if they improve.</li>
        <li>The report is this page. It does not place the shadow.</li>
      </ol>
      <table className="vibe-table">
        <thead>
          <tr>
            <th>Sleeve</th>
            <th>Closed-sell PnL</th>
            <th>Sells</th>
            <th>Win rate</th>
          </tr>
        </thead>
        <tbody>
          {review.strategies.map((row) => (
            <tr key={row.id}>
              <td>{row.id}</td>
              <td className={row.pnl >= 0 ? 'up' : 'down'}>{inr(row.pnl)}</td>
              <td>{row.trades}</td>
              <td>{(row.winRate * 100).toFixed(0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      {review.repeatSymbols.length > 0 && (
        <p className="vibe-note">
          Repeated names: {review.repeatSymbols.map((row) => `${row.symbol} ${row.trades} sells, ${inr(row.pnl)}`).join('; ')}.
        </p>
      )}
    </section>
  );
}

function Alpha({ factors }: { factors: FactorScore[] }) {
  const zoos = [
    ['academic', 'Momentum, reversal, low volatility', 'Scored on the sparkline book'],
    ['fundamental', 'Margin of safety', 'A screen on the Review tab, not a timed coefficient'],
    ['gtja191', 'Guotai Junan 191', 'Needs the full CSI bar store; not scored on this book'],
    ['qlib158', 'Qlib Alpha158', 'Needs the full feature panel; not scored on this book'],
    ['alpha101', 'Kakushadze 101', 'Needs the full bar store; not scored on this book'],
  ];
  return (
    <section className="vibe-card">
      <h2>Alpha library</h2>
      <p className="vibe-reason">Alive means the average cross-sectional rank correlation with the next five closes is above 0.02. Reversed means below -0.02. A missing input drops that name for that date.</p>
      <div className="vibe-split">
        {zoos.map(([id, title, note]) => (
          <article key={id} className="vibe-agent">
            <header>{id}</header>
            <h3>{title}</h3>
            <p>{note}</p>
          </article>
        ))}
      </div>
      <table className="vibe-table">
        <thead>
          <tr>
            <th>Factor</th>
            <th>Mean IC</th>
            <th>Dates</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {factors.map((factor) => (
            <tr key={factor.id}>
              <td>
                <b>{factor.label}</b>
                <div className="dim">{factor.note}</div>
              </td>
              <td>{factor.meanIc == null ? '—' : factor.meanIc.toFixed(3)}</td>
              <td>{factor.dates}</td>
              <td>{factor.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Lab({ review, factors }: { review: DeskReview; factors: FactorScore[] }) {
  const alive = factors.filter((factor) => factor.status === 'alive').map((factor) => factor.label);
  const reversed = factors.filter((factor) => factor.status === 'reversed').map((factor) => factor.label);
  return (
    <section className="vibe-card">
      <div className="vibe-kicker">Research lab · this book</div>
      <h2>What the sells actually paid for</h2>
      <p>
        The paper journal’s closed sells run from {review.from} to {review.to}. {review.causes[0]?.detail} The later slice is the confirmation sample: {review.testCount} sells. {review.reason}
      </p>
      <p>
        On the sparkline window, {alive.length ? `${alive.join(', ')} still rank with the next five closes.` : 'no short-horizon price factor is alive.'} {reversed.length ? `${reversed.join(', ')} rank the wrong way and would be traded in reverse, or not at all.` : ''} The fundamental screen is separate: it looks for quality under fair value, and it does not pretend to have a forward return after today’s fair value.
      </p>
      <p className="vibe-note">Counted sells: {review.closed.length}. Resampled mean band: {inr(review.bootstrap.low)} to {inr(review.bootstrap.high)}.</p>
    </section>
  );
}

function Sources() {
  const rows = [
    ['India journal', 'Paper book', 'Serving', 'Closed sells and sleeve PnL'],
    ['Fundamentals', 'analysis.json', 'Serving', 'Fair value, PE, ROE, Graham and Buffett scores'],
    ['India, US, HK, Canada, UK, Korea, crypto, forex, gold', 'Yahoo daily', 'Serving', 'Tape and same-company quotes'],
    ['USDINR', 'INR=X', 'Serving', 'ADR translation'],
    ['China A-shares, funds, macro, options chains, 13F, filings', 'Not connected', 'Silent', 'A missing source stays blank'],
  ];
  return (
    <section className="vibe-card">
      <h2>Sources and engines</h2>
      <p className="vibe-reason">The India delivery book is the only engine with fills. Other markets on the tape are prices, not backtests. Live broker orders stay off.</p>
      <table className="vibe-table">
        <thead>
          <tr>
            <th>Market</th>
            <th>Source</th>
            <th>State</th>
            <th>Use</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, index) => (
                <td key={`${row[0]}-${index}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Commands on this book</h3>
      <table className="vibe-table">
        <thead>
          <tr>
            <th>Command</th>
            <th>What it reads</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>/attrib</td><td>Sleeve, exit, and name attribution on Review and Shadow.</td></tr>
          <tr><td>/screen</td><td>The value-for-money gate. No symbol is typed.</td></tr>
          <tr><td>/memo</td><td>The Lab note, written from the same counts.</td></tr>
          <tr><td>/dcf</td><td>The fair value already stored on each name. This desk does not fit a second model.</td></tr>
          <tr><td>/earnings</td><td>The journal has no earnings calendar, so the command stays blank.</td></tr>
          <tr><td>/comps</td><td>A comparison needs a subject company. This review does not take one.</td></tr>
        </tbody>
      </table>
    </section>
  );
}

function cumulative(pnls: number[]): number[] {
  const out: number[] = [];
  let total = 0;
  for (const pnl of pnls) {
    total += pnl;
    out.push(total);
  }
  return out;
}

function EquityChart({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const width = 720;
  const height = 180;
  const pad = 12;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = pad + (index / (values.length - 1)) * (width - pad * 2);
      const y = height - pad - ((value - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return <svg className="vibe-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}><polyline points={points} className="book" /></svg>;
}
