import { useState, type FormEvent } from 'react';
import { fmtPct } from '../format';
import '../vibe/names.css';
import { FX_TICKER, SWARM, quoteArbitrage, type ArbRow, type FundStock, type JournalTrade } from '../vibe/deskReview';
import { STRATEGY_LABEL, dailyReturns, edgeDensity, paramsLabel, type Bar, type Improvement } from '../vibe/engine';
import { findInstrument, localDate } from '../vibe/markets';
import {
  factorSnapshot,
  fundSlice,
  journalSlice,
  researchBars,
  stockAgents,
  tickerCandidates,
  type AgentLines,
  type JournalSlice,
} from '../vibe/stockRun';

interface Loaded {
  query: string;
  ticker: string;
  symbol: string;
  name: string;
  currency: string;
  last: number;
  changePct: number;
  bars: Bar[];
  runs: Improvement[];
  chosen: Improvement | null;
  fund: FundStock | null;
  journal: JournalSlice;
  agents: AgentLines;
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
const pct = (fraction: number) => fmtPct(fraction * 100);

function formatQuote(price: number, currency: string): string {
  const digits = price >= 1000 ? 0 : 2;
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return price.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

async function fetchChart(ticker: string): Promise<{ ticker: string; name: string; currency: string; rows: Bar[] }> {
  const res = await fetch(`/api/vibe?ticker=${encodeURIComponent(ticker)}&range=2y`, { cache: 'no-store' });
  const body = (await res.json()) as { ticker?: string; name?: string; currency?: string; rows?: Bar[]; error?: string };
  if (!res.ok || !body.rows || body.rows.length < 30) throw new Error(body.error || 'no bars');
  return { ticker: body.ticker || ticker, name: body.name || ticker, currency: body.currency || '', rows: body.rows };
}

export default function VibeTrading() {
  const [names, setNames] = useState(['', '', '']);
  const [cards, setCards] = useState<Loaded[] | null>(null);
  const [gaps, setGaps] = useState<ArbRow[]>([]);
  const [edge, setEdge] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('review');
  const [swarm, setSwarm] = useState(SWARM[0].id);
  const [memory, setMemory] = useState<string | null>(null);
  const filled = names.filter((name) => name.trim()).length;

  async function run(event: FormEvent) {
    event.preventDefault();
    const queries = names.map((name) => name.trim()).filter(Boolean);
    if (queries.length < 2) {
      setError('Type at least two symbols. The third box can stay empty.');
      return;
    }
    setBusy(true);
    setError(null);
    setCards(null);
    try {
      const [paper, analysis] = (await Promise.all([
        fetch('/paper/latest.json', { cache: 'no-store' }).then((res) => res.json()),
        fetch('/analysis.json', { cache: 'no-store' }).then((res) => res.json()),
      ])) as [{ transactions?: JournalTrade[] }, { stocks?: Record<string, FundStock> }];
      const stocks = analysis.stocks ?? {};
      const trades = paper.transactions ?? [];
      const loaded: Loaded[] = [];
      for (const query of queries) {
        const resolved = tickerCandidates(query, Object.values(stocks));
        if ('error' in resolved) throw new Error(resolved.error);
        let chart: { ticker: string; name: string; currency: string; rows: Bar[] } | null = null;
        for (const ticker of resolved.candidates) {
          try {
            chart = await fetchChart(ticker);
            break;
          } catch {
            chart = null;
          }
        }
        if (!chart) throw new Error(`No daily bars came back for ${query}.`);
        const research = researchBars(chart.rows);
        const journal = journalSlice(resolved.symbol, trades);
        const last = chart.rows[chart.rows.length - 1];
        const prev = chart.rows[chart.rows.length - 2];
        loaded.push({
          query,
          ticker: chart.ticker,
          symbol: resolved.symbol,
          name: chart.name,
          currency: chart.currency,
          last: last.c,
          changePct: prev.c > 0 ? (last.c / prev.c - 1) * 100 : 0,
          bars: chart.rows,
          runs: research.runs,
          chosen: research.chosen,
          fund: fundSlice(resolved.symbol, stocks),
          journal,
          agents: stockAgents(chart.ticker, research.runs, research.chosen, journal),
        });
      }
      setCards(loaded);
      const prices: Record<string, number> = {};
      loaded.forEach((card) => {
        prices[card.ticker] = card.last;
      });
      const needsFx = loaded.some((card) => ['INFY', 'WIT', 'HDB', 'IBN'].includes(card.ticker)) && loaded.some((card) => card.ticker.endsWith('.NS'));
      if (needsFx) {
        try {
          const fx = await fetchChart(FX_TICKER);
          prices[FX_TICKER] = fx.rows[fx.rows.length - 1].c;
        } catch {
          /* an ADR gap without USDINR stays off the board */
        }
      }
      setGaps(quoteArbitrage(prices));
      const series = loaded.map((card) => {
        const zone = findInstrument(card.ticker)?.timeZone ?? 'UTC';
        return dailyReturns(card.bars, card.bars.map((bar) => localDate(bar.t, zone)));
      });
      const density = edgeDensity(series);
      setEdge(
        density.density == null
          ? 'The two series do not share enough movement to measure a link.'
          : `${loaded.length} names, ${density.defined} pair${density.defined === 1 ? '' : 's'} measured. ${(density.density * 100).toFixed(0)}% of those pairs move together (correlation at least 0.5).`,
      );
      const adopted = loaded
        .filter((card) => card.chosen)
        .map((card) => `${card.symbol} ${STRATEGY_LABEL[card.chosen!.strategy]} ${paramsLabel(card.chosen!.strategy, card.chosen!.adopted)}`);
      if (adopted.length) {
        localStorage.setItem('vibe-stock-adopted-v1', JSON.stringify({ lines: adopted }));
        setMemory(adopted.join(' · '));
      } else {
        setMemory(null);
      }
      setSection('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The run failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vibe">
      <header className="vibe-hero">
        <div>
          <div className="vibe-kicker">Vibe-Trading</div>
          <h1>Type two or three names.</h1>
          <p>Nothing is selected for you. After you run those names, the desk pulls their daily bars, walks each rule family forward, and keeps a parameter change only when the last 30% of bars still clears the risk gate.</p>
        </div>
      </header>

      <form className="vibe-names" onSubmit={run}>
        {names.map((value, index) => (
          <label key={index}>
            Stock {index + 1}
            {index === 2 ? ' · optional' : ''}
            <input
              value={value}
              placeholder="Type a symbol"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setNames((curr) => curr.map((item, i) => (i === index ? event.target.value : item)))}
            />
          </label>
        ))}
        <button className="vibe-run" type="submit" disabled={busy || filled < 2}>
          {busy ? 'Running' : 'Run these names'}
        </button>
      </form>

      {error && <div className="vibe-error">{error}</div>}
      {memory && <p className="vibe-note">Remembered in this browser: {memory}</p>}

      {!cards && !busy && <p className="vibe-wait">The board stays empty until you type at least two symbols. A company name from the fundamental book works too.</p>}
      {busy && <p className="vibe-wait">Pulling daily bars and testing the rule families on the first 70% of each sample.</p>}

      {cards && (
        <>
          <div className="vibe-board" aria-label="Names you entered">
            {cards.map((card) => (
              <div key={card.ticker} className="vibe-chip">
                <span className="vibe-chip-mkt">{card.ticker}</span>
                <span className="vibe-chip-sym">{card.symbol}</span>
                <span className={card.changePct >= 0 ? 'up' : 'down'}>
                  {formatQuote(card.last, card.currency)} {card.currency} {fmtPct(card.changePct)}
                </span>
              </div>
            ))}
          </div>
          <p className="vibe-note">{edge}</p>

          <nav className="vibe-tabs" aria-label="Vibe-Trading sections">
            {SECTIONS.map((item) => (
              <button key={item.id} type="button" className={section === item.id ? 'on' : ''} onClick={() => setSection(item.id)}>
                {item.label}
              </button>
            ))}
          </nav>

          {section === 'review' && <Review cards={cards} gaps={gaps} />}
          {section === 'shadow' && <Shadow cards={cards} />}
          {section === 'swarm' && <Swarm cards={cards} swarm={swarm} setSwarm={setSwarm} gaps={gaps} />}
          {section === 'alpha' && <Alpha cards={cards} />}
          {section === 'lab' && <Lab cards={cards} edge={edge} />}
          {section === 'sources' && <Sources />}
        </>
      )}

      <p className="vibe-attrib">Route, ground, test, deliver. Figures come from the bars of the names you typed, and from the paper journal where those symbols already have a closed sell. No order is sent.</p>
    </div>
  );
}

function Review({ cards, gaps }: { cards: Loaded[]; gaps: ArbRow[] }) {
  return (
    <>
      {cards.map((card) => (
        <section key={card.ticker} className="vibe-card">
          <div className="vibe-card-head">
            <div>
              <div className="vibe-kicker">{card.name}</div>
              <h2>{card.symbol}</h2>
            </div>
            <span className={card.chosen ? 'vibe-badge ok' : 'vibe-badge'}>{card.chosen ? 'Rule adopted' : 'Seed kept'}</span>
          </div>
          <CloseChart bars={card.bars} label={`${card.symbol} close`} />
          <div className="vibe-metrics">
            <Metric label="Last" value={`${formatQuote(card.last, card.currency)} ${card.currency}`} />
            <Metric label="Day" value={fmtPct(card.changePct)} tone={card.changePct >= 0 ? 'up' : 'down'} />
            <Metric label="Holdout" value={card.chosen ? pct(card.chosen.testCandidate.metrics.totalReturn) : '—'} />
            <Metric label="Sharpe" value={card.chosen ? card.chosen.testCandidate.metrics.sharpe.toFixed(2) : '—'} />
            <Metric label="Drawdown" value={card.chosen ? pct(card.chosen.testCandidate.metrics.maxDrawdown) : '—'} />
          </div>
          <p className="vibe-reason">{card.agents.quant}</p>
          <table className="vibe-table">
            <thead>
              <tr>
                <th>Family</th>
                <th>Adopted params</th>
                <th>Holdout</th>
                <th>Trades</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {card.runs.map((run) => (
                <tr key={run.strategy} className={card.chosen?.strategy === run.strategy ? 'on' : ''}>
                  <td>{STRATEGY_LABEL[run.strategy]}</td>
                  <td>{paramsLabel(run.strategy, run.adopted)}</td>
                  <td className={run.testCandidate.metrics.totalReturn >= 0 ? 'up' : 'down'}>{pct(run.testCandidate.metrics.totalReturn)}</td>
                  <td>{run.testCandidate.metrics.trades}</td>
                  <td>{run.accepted ? (card.chosen?.strategy === run.strategy ? 'adopted' : 'eligible') : 'gate kept the seed'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <FundLine fund={card.fund} />
          <div className="vibe-split">
            <article className="vibe-agent">
              <header>Quant</header>
              <p>{card.agents.quant}</p>
            </article>
            <article className="vibe-agent">
              <header>Risk</header>
              <p>{card.agents.risk}</p>
            </article>
            <article className="vibe-agent">
              <header>Shadow</header>
              <p>{card.agents.shadow}</p>
            </article>
          </div>
        </section>
      ))}
      {gaps.length > 0 && (
        <section className="vibe-card">
          <h2>Same-company gap</h2>
          <p className="vibe-reason">Only the names you typed. A missing leg is left off.</p>
          <table className="vibe-table">
            <thead>
              <tr>
                <th>Pair</th>
                <th>Gap</th>
                <th>Read</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((row) => (
                <tr key={row.id}>
                  <td>{row.pair}</td>
                  <td>{fmtPct(row.gapPct)}</td>
                  <td>{row.note} {row.actionable ? 'Wide enough to study after costs.' : 'Inside costs.'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function FundLine({ fund }: { fund: FundStock | null }) {
  if (!fund) return <p className="vibe-note">This symbol is not in the fundamental book, so PE, ROE, and fair value stay blank.</p>;
  const mos = fund.verdict?.marginOfSafety;
  const usable = mos != null && mos >= -80 && mos <= 80;
  return (
    <p className="vibe-note">
      {fund.sector || 'Unclassified'} · PE {fund.metrics?.pe ?? '—'} · ROE {fund.metrics?.roe == null ? '—' : `${fund.metrics.roe.toFixed(1)}%`} · {fund.verdict?.rating || 'Unrated'}
      {usable ? ` · ${mos!.toFixed(0)}% versus the stored fair value` : ' · the stored fair value is too far from the price to use'}
    </p>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="vibe-metric">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function Shadow({ cards }: { cards: Loaded[] }) {
  return (
    <section className="vibe-card">
      <h2>Shadow account</h2>
      <ol className="vibe-steps">
        <li>Read only the names you typed.</li>
        <li>Count the paper book’s closed sells in those symbols.</li>
        <li>Extract the parameter set the earlier bars support.</li>
        <li>Keep it only when the later bars still clear the gate.</li>
        <li>Set that holdout beside the journal’s same rule family. No order is placed.</li>
      </ol>
      {cards.map((card) => (
        <article key={card.ticker}>
          <h3>{card.symbol}</h3>
          <p>{card.agents.shadow}</p>
          {card.journal.sleeves.length > 0 && (
            <table className="vibe-table">
              <thead>
                <tr>
                  <th>Sleeve in the journal</th>
                  <th>Realized</th>
                  <th>Sells</th>
                </tr>
              </thead>
              <tbody>
                {card.journal.sleeves.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td className={row.pnl >= 0 ? 'up' : 'down'}>{inr(row.pnl)}</td>
                    <td>{row.trades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>
      ))}
    </section>
  );
}

function Swarm({ cards, swarm, setSwarm, gaps }: { cards: Loaded[]; swarm: string; setSwarm: (id: string) => void; gaps: ArbRow[] }) {
  const preset = SWARM.find((item) => item.id === swarm) ?? SWARM[0];
  return (
    <section className="vibe-card">
      <h2>Swarm</h2>
      <p className="vibe-reason">Each preset reads the names you typed. A preset with no book on those names stays quiet.</p>
      <div className="vibe-tabs">
        {SWARM.map((item) => (
          <button key={item.id} type="button" className={swarm === item.id ? 'on' : ''} onClick={() => setSwarm(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <p>{swarmText(preset.id, preset.grounded, cards, gaps)}</p>
    </section>
  );
}

function swarmText(id: string, grounded: boolean, cards: Loaded[], gaps: ArbRow[]): string {
  if (!grounded) return 'This preset needs a book these names do not have: options, credit, funds, social posts, or a model score. It stays silent.';
  if (id === 'risk_committee') return cards.map((card) => card.agents.risk).join(' ');
  if (id === 'statistical_arbitrage_desk' || id === 'pairs_research_lab' || id === 'macro_rates_fx_desk') {
    return gaps.length ? gaps.map((row) => `${row.pair}: ${fmtPct(row.gapPct)}. ${row.note}`).join(' ') : 'Type both legs of a pair, such as a local line and its ADR, before a gap can be read.';
  }
  if (id === 'value_investing_committee' || id === 'fundamental_research_team' || id === 'equity_research_team') {
    return cards.map((card) => (card.fund ? `${card.symbol} PE ${card.fund.metrics?.pe ?? '—'}, ROE ${card.fund.metrics?.roe ?? '—'}, ${card.fund.verdict?.rating ?? 'unrated'}.` : `${card.symbol} has no fundamental row.`)).join(' ');
  }
  return cards.map((card) => card.agents.quant).join(' ');
}

function Alpha({ cards }: { cards: Loaded[] }) {
  return (
    <section className="vibe-card">
      <h2>Alpha library</h2>
      <p className="vibe-reason">Two or three names cannot support a cross-sectional rank correlation. These are each name’s own trailing returns. The published 191, 158, and 101 sets are not recomputed.</p>
      <table className="vibe-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>20-bar momentum</th>
            <th>5-bar reversal</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => {
            const factor = factorSnapshot(card.bars);
            return (
              <tr key={card.ticker}>
                <td>{card.symbol}</td>
                <td>{factor.mom20 == null ? '—' : pct(factor.mom20)}</td>
                <td>{factor.rev5 == null ? '—' : pct(factor.rev5)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Lab({ cards, edge }: { cards: Loaded[]; edge: string }) {
  return (
    <section className="vibe-card">
      <div className="vibe-kicker">Research lab · names you typed</div>
      <h2>What these samples paid</h2>
      {cards.map((card) => (
        <p key={card.ticker}>
          {card.symbol}: {card.chosen ? `${STRATEGY_LABEL[card.chosen.strategy]} ${paramsLabel(card.chosen.strategy, card.chosen.adopted)} cleared the later bars at ${pct(card.chosen.testCandidate.metrics.totalReturn)}.` : 'no family cleared the later bars, so the seed stays.'} {card.journal.trades ? `The journal’s closed sells in it realized ${inr(card.journal.pnl)}.` : 'The journal has not closed a sell in it.'}
        </p>
      ))}
      <p className="vibe-note">{edge}</p>
    </section>
  );
}

function Sources() {
  const rows = [
    ['Names you type', 'Yahoo daily', 'On run', 'Two years of bars, then the walk-forward'],
    ['Paper journal', 'Closed sells', 'On run', 'Only the symbols you typed'],
    ['Fundamentals', 'analysis.json', 'On run', 'PE, ROE, rating, and fair value when the symbol is in the book'],
    ['USDINR', 'INR=X', 'When an ADR pair is typed', 'Translates the ADR into rupees'],
    ['China A-shares, funds, options, filings', 'Not connected', 'Silent', 'A missing source stays blank'],
  ];
  return (
    <section className="vibe-card">
      <h2>Sources and engines</h2>
      <p className="vibe-reason">The India delivery engine is the paper journal. The bars you request are priced, then backtested here. Live broker orders stay off.</p>
      <table className="vibe-table">
        <thead>
          <tr>
            <th>Input</th>
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
    </section>
  );
}

function CloseChart({ bars, label }: { bars: Bar[]; label: string }) {
  const values = bars.map((bar) => bar.c);
  if (values.length < 2) return null;
  const width = 720;
  const height = 160;
  const pad = 12;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = pad + (index / (values.length - 1)) * (width - pad * 2);
      const y = height - pad - ((value - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg className="vibe-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <polyline points={points} className="book" />
    </svg>
  );
}
