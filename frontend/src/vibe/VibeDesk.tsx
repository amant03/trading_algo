import { useState } from 'react';
import { fmtPct } from '../format';
import { BROKERS, COMMANDS, ENGINES, INTERVALS, SKILLS, SOURCES, ZOOS, engineFor } from './catalog';
import type { FundStock } from './deskReview';
import { STRATEGY_LABEL, paramsLabel, type Bar, type Improvement } from './engine';
import { barReturns, monteCarlo, portfolioBooks } from './portfolio';
import { factorSnapshot, screenFund, type AgentLines, type JournalSlice } from './stockRun';

export interface DeskCard {
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

const pct = (fraction: number) => fmtPct(fraction * 100);
const inr = (n: number) => `${n < 0 ? '-' : ''}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
const empty = <p className="vibe-wait">Type at least two symbols and run them. This section fills from those names.</p>;

export function Workflow({ cards }: { cards: DeskCard[] | null }) {
  return (
    <section className="vibe-card">
      <h2>Research loop</h2>
      <ol className="vibe-steps">
        <li>Route the names you typed to Yahoo daily bars, the paper journal, and the fundamental book.</li>
        <li>Ground each figure in a close, a closed sell, or a stored fair value.</li>
        <li>Test four rule families on the first 70% of bars. Keep a change only when the last 30% clears the gate.</li>
        <li>Deliver the holdout, the shadow comparison, and the caveats. A figure with no source is left blank.</li>
      </ol>
      {cards ? (
        <table className="vibe-table">
          <thead>
            <tr>
              <th>Figure</th>
              <th>Value</th>
              <th>Kind</th>
            </tr>
          </thead>
          <tbody>
            {cards.flatMap((card) => [
              <tr key={`${card.ticker}-px`}>
                <td>{card.symbol} last</td>
                <td>{card.last.toLocaleString(card.currency === 'INR' ? 'en-IN' : 'en-US', { maximumFractionDigits: 2 })} {card.currency}</td>
                <td>Observed, Yahoo</td>
              </tr>,
              <tr key={`${card.ticker}-hold`}>
                <td>{card.symbol} holdout</td>
                <td>{card.chosen ? pct(card.chosen.testCandidate.metrics.totalReturn) : '—'}</td>
                <td>Derived, next-open backtest, 10 bps</td>
              </tr>,
              <tr key={`${card.ticker}-jn`}>
                <td>{card.symbol} journal</td>
                <td>{card.journal.trades ? inr(card.journal.pnl) : '—'}</td>
                <td>Count of closed sells</td>
              </tr>,
            ])}
          </tbody>
        </table>
      ) : empty}
    </section>
  );
}

export function BacktestDesk({ cards }: { cards: DeskCard[] | null }) {
  return (
    <section className="vibe-card">
      <h2>Backtesting</h2>
      <p className="vibe-reason">Eleven markets are listed. The daily engine runs on the names you typed. A market whose rules are not in this book is named and not pretended.</p>
      <p className="vibe-note">Intervals on the wiki: {INTERVALS.join(', ')}. This run uses 1D. Weekly and monthly are not rebuilt here.</p>
      <table className="vibe-table">
        <thead>
          <tr>
            <th>Market</th>
            <th>On this run</th>
            <th>Rules</th>
          </tr>
        </thead>
        <tbody>
          {ENGINES.map((engine) => {
            const hit = cards?.filter((card) => engineFor(card.ticker) === engine.market) ?? [];
            return (
              <tr key={engine.market}>
                <td>{engine.market}</td>
                <td>{hit.length ? hit.map((card) => card.symbol).join(', ') : 'Not in the names you typed'}</td>
                <td>{engine.rules}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function PortfolioDesk({ cards }: { cards: DeskCard[] | null }) {
  if (!cards) return <section className="vibe-card"><h2>Portfolio</h2>{empty}</section>;
  const books = portfolioBooks(cards.map((card) => barReturns(card.bars)));
  const rows = [
    ['Equal weight', books.equal],
    ['Volatility parity', books.invVol],
    ['Minimum variance', books.minVar],
  ] as const;
  return (
    <section className="vibe-card">
      <h2>Portfolio</h2>
      <p className="vibe-reason">Weights use the daily returns of the names you typed. Minimum variance ignores a return forecast. Turnover-aware rebalancing needs a prior book this run does not have.</p>
      <table className="vibe-table">
        <thead>
          <tr>
            <th>Book</th>
            {cards.map((card) => <th key={card.ticker}>{card.symbol}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, weights]) => (
            <tr key={label}>
              <td>{label}</td>
              {weights.map((weight, index) => <td key={cards[index].ticker}>{(weight * 100).toFixed(1)}%</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Holdout bootstrap</h3>
      <table className="vibe-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>5th</th>
            <th>Median</th>
            <th>95th</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => {
            const band = card.chosen ? monteCarlo(card.chosen.testCandidate.equity) : null;
            return (
              <tr key={card.ticker}>
                <td>{card.symbol}</td>
                <td>{band ? pct(band.low) : '—'}</td>
                <td>{band ? pct(band.median) : '—'}</td>
                <td>{band ? pct(band.high) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="vibe-note">The band resamples the holdout’s own daily moves. It is a range around this sample, not a forecast.</p>
    </section>
  );
}

export function SkillsDesk({ cards }: { cards: DeskCard[] | null }) {
  const [command, setCommand] = useState(COMMANDS[0].id);
  return (
    <section className="vibe-card">
      <h2>Finance skills</h2>
      <p className="vibe-reason">Nine categories. The commands below run on the names you typed. A skill with no book stays quiet.</p>
      <table className="vibe-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>On the wiki</th>
            <th>Here</th>
          </tr>
        </thead>
        <tbody>
          {SKILLS.map((skill) => (
            <tr key={skill.category}>
              <td>{skill.category}</td>
              <td>{skill.count}</td>
              <td>{skill.here}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="vibe-tabs">
        {COMMANDS.map((item) => (
          <button key={item.id} type="button" className={command === item.id ? 'on' : ''} onClick={() => setCommand(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <CommandResult id={command} cards={cards} />
    </section>
  );
}

function CommandResult({ id, cards }: { id: string; cards: DeskCard[] | null }) {
  const blurb = COMMANDS.find((item) => item.id === id)?.blurb;
  if (!cards) return <p className="vibe-wait">{blurb} Type the names first.</p>;
  if (id === 'comps' || id === 'earnings' || id === 'dcf') {
    return (
      <table className="vibe-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Last</th>
            <th>PE</th>
            <th>ROE</th>
            <th>Fair value gap</th>
            <th>Earnings yield</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => {
            const pe = card.fund?.metrics?.pe ?? null;
            const mos = card.fund?.verdict?.marginOfSafety;
            const usable = mos != null && mos >= -80 && mos <= 80;
            return (
              <tr key={card.ticker}>
                <td>{card.symbol}</td>
                <td>{card.last.toFixed(2)}</td>
                <td>{pe ?? '—'}</td>
                <td>{card.fund?.metrics?.roe == null ? '—' : `${card.fund.metrics.roe.toFixed(1)}%`}</td>
                <td>{usable ? `${mos!.toFixed(0)}%` : 'unusable'}</td>
                <td>{pe && pe > 0 ? pct(1 / pe) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  if (id === 'attrib') {
    const total = cards.reduce((acc, card) => acc + card.journal.pnl, 0);
    return (
      <table className="vibe-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Realized</th>
            <th>Share of these names</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => (
            <tr key={card.ticker}>
              <td>{card.symbol}</td>
              <td className={card.journal.pnl >= 0 ? 'up' : 'down'}>{inr(card.journal.pnl)}</td>
              <td>{total === 0 ? '—' : pct(card.journal.pnl / total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (id === 'screen') {
    return (
      <table className="vibe-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Gate</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => {
            const result = screenFund(card.fund);
            return (
              <tr key={card.ticker}>
                <td>{card.symbol}</td>
                <td>{result.pass ? 'clears' : 'fails'}</td>
                <td>{result.why}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  return (
    <>
      {cards.map((card) => (
        <p key={card.ticker}>
          {card.symbol}: {card.chosen ? `${STRATEGY_LABEL[card.chosen.strategy]} ${paramsLabel(card.chosen.strategy, card.chosen.adopted)} holdout ${pct(card.chosen.testCandidate.metrics.totalReturn)}.` : 'no family cleared the later bars.'} {card.agents.shadow}
        </p>
      ))}
    </>
  );
}

export function DataDesk({ cards }: { cards: DeskCard[] | null }) {
  return (
    <section className="vibe-card">
      <h2>Data sources</h2>
      <p className="vibe-reason">A missing source stays blank. This run does not walk a chain of vendors it cannot call.</p>
      <table className="vibe-table">
        <thead>
          <tr>
            <th>Market</th>
            <th>Chain</th>
            <th>This desk</th>
          </tr>
        </thead>
        <tbody>
          {SOURCES.map((source) => (
            <tr key={source.market}>
              <td>{source.market}</td>
              <td>{source.chain}</td>
              <td>{source.here}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cards && <p className="vibe-note">Served just now: {cards.map((card) => `${card.symbol} via Yahoo ${card.ticker}`).join('; ')}.</p>}
    </section>
  );
}

export function BrokersDesk({ cards, halted, onHalt }: { cards: DeskCard[] | null; halted: boolean; onHalt: (next: boolean) => void }) {
  return (
    <section className="vibe-card">
      <h2>Brokers</h2>
      <p className="vibe-reason">No broker is connected. The paper journal is the only book. Live orders stay off, and the halt below is remembered in this browser.</p>
      <p>
        <button type="button" className="vibe-run" onClick={() => onHalt(!halted)}>{halted ? 'Halted' : 'Halt'}</button>
      </p>
      <p className="vibe-note">{halted ? 'Live activity is halted. This desk was not going to send an order.' : 'Halt is clear. This desk still does not send an order.'}</p>
      <table className="vibe-table">
        <thead>
          <tr>
            <th>Access on the wiki</th>
            <th>Brokers</th>
            <th>Here</th>
          </tr>
        </thead>
        <tbody>
          {BROKERS.map((row) => (
            <tr key={row.access}>
              <td>{row.access}</td>
              <td>{row.names}</td>
              <td>Not connected</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cards && (
        <>
          <h3>Paper book for these names</h3>
          <table className="vibe-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Closed sells</th>
                <th>Realized</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((card) => (
                <tr key={card.ticker}>
                  <td>{card.symbol}</td>
                  <td>{card.journal.trades}</td>
                  <td className={card.journal.pnl >= 0 ? 'up' : 'down'}>{card.journal.trades ? inr(card.journal.pnl) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

export function AlphaZoo({ cards }: { cards: DeskCard[] | null }) {
  return (
    <section className="vibe-card">
      <h2>Alpha library</h2>
      <table className="vibe-table">
        <thead>
          <tr>
            <th>Zoo</th>
            <th>Formulas</th>
            <th>Here</th>
          </tr>
        </thead>
        <tbody>
          {ZOOS.map((zoo) => (
            <tr key={zoo.id}>
              <td>{zoo.label}</td>
              <td>{zoo.count}</td>
              <td>{zoo.here}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cards ? (
        <table className="vibe-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>20-bar momentum</th>
              <th>5-bar reversal</th>
              <th>Low volatility</th>
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
                  <td>{factor.lowVol == null ? '—' : factor.lowVol.toFixed(4)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : empty}
    </section>
  );
}

export function Tutorial() {
  return (
    <section className="vibe-card">
      <h2>Hands-on</h2>
      <ol className="vibe-steps">
        <li>Type two symbols. Leave the third empty if you only want a pair.</li>
        <li>Read the holdout beside buy-and-hold. A family with fewer than three later trades does not clear the gate.</li>
        <li>Open Shadow and compare that holdout with the paper book’s closed sells in the same name.</li>
        <li>Open Skills and run /screen and /comps on those names only.</li>
      </ol>
      <p className="vibe-note">The research loop is route, ground, test, deliver. A source this desk cannot call is left blank.</p>
    </section>
  );
}

export function MemoryDesk({ goal, onGoal, history }: { goal: string; onGoal: (value: string) => void; history: { at: string; line: string }[] }) {
  return (
    <section className="vibe-card">
      <h2>Memory</h2>
      <p className="vibe-reason">A goal and the runs you keep stay in this browser. They are not a model memory and they are not sent anywhere.</p>
      <label className="vibe-note">
        Research goal
        <textarea value={goal} onChange={(event) => onGoal(event.target.value)} rows={3} />
      </label>
      {history.length === 0 ? <p>No run is stored yet.</p> : (
        <ul>
          {history.map((item) => <li key={item.at}>{item.at} — {item.line}</li>)}
        </ul>
      )}
    </section>
  );
}

export function LabNote({ cards, edge }: { cards: DeskCard[] | null; edge: string }) {
  if (!cards) return <section className="vibe-card"><h2>Research lab</h2>{empty}</section>;
  return (
    <section className="vibe-card">
      <div className="vibe-kicker">Research lab</div>
      <h2>What these samples paid</h2>
      {cards.map((card) => (
        <p key={card.ticker}>
          {card.symbol}: {card.chosen ? `${STRATEGY_LABEL[card.chosen.strategy]} ${paramsLabel(card.chosen.strategy, card.chosen.adopted)} cleared the later bars at ${pct(card.chosen.testCandidate.metrics.totalReturn)}.` : 'no family cleared the later bars.'} {card.journal.trades ? `Closed sells realized ${inr(card.journal.pnl)}.` : 'The journal has not closed a sell in it.'}
        </p>
      ))}
      <p className="vibe-note">{edge}</p>
    </section>
  );
}
