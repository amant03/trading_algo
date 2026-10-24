import { useEffect, useMemo, useState } from 'react';
import { fmtPct } from '../format';
import { DESK, findInstrument, localDate, type DeskInstrument } from '../vibe/markets';
import {
  FEE,
  INITIAL_CASH,
  STRATEGY_LABEL,
  defaultParams,
  improve,
  paramsLabel,
  parsePrompt,
  dailyReturns,
  edgeDensity,
  type Bar,
  type Improvement,
  type Params,
  type StrategyId,
} from '../vibe/engine';

interface ChartPayload {
  ticker: string;
  name: string;
  currency: string;
  range: string;
  rows: Bar[];
}

interface Tape {
  ticker: string;
  name: string;
  currency: string;
  last: number;
  changePct: number;
  bars: Bar[];
  dates: string[];
  error?: string;
}

interface PaperStrategy {
  id: string;
  label: string;
  equity: number;
  pnl: number;
  trades: number;
  winRate: number | null;
}

interface MemoryEntry {
  ticker: string;
  strategy: StrategyId;
  params: Params;
  at: number;
  holdoutSharpe: number;
}

const MEM_KEY = 'vibe-desk-adopted-v1';
const TRADABLE: StrategyId[] = ['ma_cross', 'rsi_reversal', 'macd_cross', 'donchian'];

const pct = (fraction: number) => fmtPct(fraction * 100);

function formatQuote(price: number, currency: string): string {
  const digits = price >= 1000 ? 0 : 2;
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return price.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
const n2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '—');
const pfText = (n: number | null) => (n == null ? 'no losses' : n.toFixed(2));

function readMemory(): MemoryEntry | null {
  try {
    const raw = localStorage.getItem(MEM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MemoryEntry;
    if (!parsed?.ticker || !parsed.params) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeMemory(entry: MemoryEntry) {
  localStorage.setItem(MEM_KEY, JSON.stringify(entry));
}

async function loadChart(ticker: string, range: string): Promise<ChartPayload> {
  const res = await fetch(`/api/vibe?ticker=${encodeURIComponent(ticker)}&range=${range}`, { cache: 'no-store' });
  const body = (await res.json()) as ChartPayload & { error?: string };
  if (!res.ok) throw new Error(body.error || 'Chart unavailable');
  if (!Array.isArray(body.rows) || body.rows.length < 2) throw new Error('No daily bars');
  return body;
}

export default function VibeTrading() {
  const [prompt, setPrompt] = useState('Improve a 20/50 moving-average cross on RELIANCE and validate it out of sample.');
  const [picked, setPicked] = useState('RELIANCE.NS');
  const [strategy, setStrategy] = useState<StrategyId>('ma_cross');
  const [tape, setTape] = useState<Record<string, Tape>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Improvement | null>(null);
  const [runMeta, setRunMeta] = useState<{ ticker: string; name: string; currency: string; bars: number; range: string } | null>(null);
  const [paper, setPaper] = useState<PaperStrategy[] | null>(null);
  const [memory, setMemory] = useState<MemoryEntry | null>(null);

  useEffect(() => {
    setMemory(readMemory());
    let live = true;
    DESK.forEach((item) => {
      loadChart(item.ticker, '1y')
        .then((payload) => {
          if (!live) return;
          const rows = payload.rows;
          const last = rows[rows.length - 1];
          const prev = rows[rows.length - 2];
          setTape((curr) => ({
            ...curr,
            [item.ticker]: {
              ticker: item.ticker,
              name: payload.name,
              currency: payload.currency,
              last: last.c,
              changePct: prev.c > 0 ? (last.c / prev.c - 1) * 100 : 0,
              bars: rows,
              dates: rows.map((row) => localDate(row.t, item.timeZone)),
            },
          }));
        })
        .catch((err: unknown) => {
          if (!live) return;
          setTape((curr) => ({
            ...curr,
            [item.ticker]: {
              ticker: item.ticker,
              name: item.label,
              currency: '',
              last: 0,
              changePct: 0,
              bars: [],
              dates: [],
              error: err instanceof Error ? err.message : 'unavailable',
            },
          }));
        });
    });
    fetch('/paper/latest.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { strategies?: PaperStrategy[] } | null) => {
        if (live && body?.strategies) setPaper(body.strategies);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const density = useMemo(() => {
    const series = DESK.map((item) => tape[item.ticker])
      .filter((row): row is Tape => !!row && row.bars.length > 30)
      .map((row) => dailyReturns(row.bars, row.dates));
    if (series.length < 2) return null;
    return edgeDensity(series, 0.5);
  }, [tape]);

  const loadedCount = Object.values(tape).filter((row) => row.bars.length > 0).length;

  const run = async () => {
    const parsed = parsePrompt(prompt);
    const ticker = parsed.ticker ?? picked;
    const nextStrategy = parsed.strategy ?? strategy;
    const instrument = findInstrument(ticker);
    setPicked(ticker);
    setStrategy(nextStrategy);
    setRunning(true);
    setError(null);
    try {
      const payload = await loadChart(ticker, '2y');
      const remembered = readMemory();
      const seed =
        remembered && remembered.ticker === ticker && remembered.strategy === nextStrategy
          ? remembered.params
          : defaultParams(nextStrategy);
      const report = improve(payload.rows, nextStrategy, seed, 8);
      if (report.accepted) {
        const entry: MemoryEntry = {
          ticker,
          strategy: nextStrategy,
          params: report.adopted,
          at: Date.now(),
          holdoutSharpe: report.testCandidate.metrics.sharpe,
        };
        writeMemory(entry);
        setMemory(entry);
      }
      setResult(report);
      setRunMeta({
        ticker,
        name: payload.name,
        currency: payload.currency,
        bars: payload.rows.length,
        range: payload.range,
      });
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'Research run failed');
    } finally {
      setRunning(false);
    }
  };

  const book = result ? (result.accepted ? result.testCandidate : result.status === 'too_short' ? result.testCandidate : result.testSeed) : null;
  const bench = result?.testBenchmark ?? null;
  const instrument = runMeta ? findInstrument(runMeta.ticker) : findInstrument(picked);

  return (
    <div className="vibe">
      <header className="vibe-hero reveal">
        <div>
          <div className="vibe-kicker">Vibe-Trading · research desk</div>
          <h1>A strategy has to survive the holdout.</h1>
          <p>
            Natural-language runs load daily bars across India, the US, Hong Kong, Canada, the UK, Korea, crypto, forex, and gold futures.
            The agent mutates one strategy on the first 70% of the sample and adopts the change only when the last 30% still clears a fixed risk gate.
          </p>
        </div>
        <div className="vibe-density">
          <span>Cross-market edge density</span>
          <strong>{density?.density == null ? 'Unknown' : pct(density.density)}</strong>
          <em>
            {density == null
              ? `${loadedCount}/${DESK.length} markets in`
              : density.density == null
                ? 'No pair had a defined correlation'
                : `${density.defined} pairs ≥ 0.50 · ${density.unknown} undefined`}
          </em>
        </div>
      </header>

      <form
        className="vibe-prompt reveal reveal-1"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <label htmlFor="vibe-q">Research prompt</label>
        <textarea
          id="vibe-q"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          spellCheck={false}
        />
        <div className="vibe-prompt-row">
          <label className="vibe-select">
            Strategy if the prompt does not name one
            <select value={strategy} onChange={(event) => setStrategy(event.target.value as StrategyId)}>
              {TRADABLE.map((id) => (
                <option key={id} value={id}>
                  {STRATEGY_LABEL[id]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="vibe-run" disabled={running}>
            {running ? 'Running the desk…' : 'Run research'}
          </button>
        </div>
      </form>

      <div className="vibe-board reveal reveal-2">
        {DESK.map((item) => {
          const row = tape[item.ticker];
          const active = picked === item.ticker;
          return (
            <button
              key={item.ticker}
              type="button"
              className={active ? 'vibe-chip on' : 'vibe-chip'}
              onClick={() => {
                setPicked(item.ticker);
                setPrompt(`Improve ${STRATEGY_LABEL[strategy].toLowerCase()} on ${item.label} and validate it out of sample.`);
              }}
            >
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
            </button>
          );
        })}
      </div>

      {memory && (
        <p className="vibe-memory">
          Remembered adoption: {STRATEGY_LABEL[memory.strategy]} {paramsLabel(memory.strategy, memory.params)} on {memory.ticker}, holdout Sharpe {n2(memory.holdoutSharpe)}. The next run on that pair starts from these parameters.
        </p>
      )}

      {error && <div className="vibe-error">{error}</div>}

      {!result && !error && (
        <p className="vibe-wait">
          The desk is idle. A run fetches two years of daily bars, searches eight neighbours, and writes a train / holdout / buy-and-hold card. Fee is {(FEE * 10_000).toFixed(0)} bps per side, filled on the next open, starting cash {INITIAL_CASH.toLocaleString('en-IN')}.
        </p>
      )}

      {result && book && bench && runMeta && (
        <>
          <section className="vibe-card reveal">
            <div className="vibe-card-head">
              <div>
                <div className="vibe-kicker">{runMeta.name} · {runMeta.currency} · {runMeta.range} · {runMeta.bars} bars</div>
                <h2>
                  {STRATEGY_LABEL[result.strategy]} {paramsLabel(result.strategy, result.adopted)}
                </h2>
              </div>
              <span className={result.accepted ? 'vibe-badge ok' : 'vibe-badge'}>
                {result.status === 'too_short' ? 'Sample too short' : result.accepted ? 'Adopted' : 'Seed kept'}
              </span>
            </div>
            <p className="vibe-reason">{result.reason}</p>
            <div className="vibe-metrics">
              <Metric label="Holdout return" value={pct(book.metrics.totalReturn)} tone={book.metrics.totalReturn >= 0 ? 'up' : 'down'} />
              <Metric label="Buy & hold" value={pct(bench.metrics.totalReturn)} tone={bench.metrics.totalReturn >= 0 ? 'up' : 'down'} />
              <Metric label="Sharpe" value={n2(book.metrics.sharpe)} />
              <Metric label="Sortino" value={n2(book.metrics.sortino)} />
              <Metric label="Max drawdown" value={pct(book.metrics.maxDrawdown)} tone="down" />
              <Metric label="Calmar" value={n2(book.metrics.calmar)} />
              <Metric label="Win rate" value={book.metrics.trades ? pct(book.metrics.winRate) : '—'} />
              <Metric label="Profit factor" value={pfText(book.metrics.profitFactor)} />
              <Metric label="Trades" value={String(book.metrics.trades)} />
              <Metric label="Bars / year" value={String(book.metrics.barsPerYear)} />
            </div>
            <EquityChart strategy={book.equity} benchmark={bench.equity} />
            <p className="vibe-note">
              Curves are the holdout window, rebased to 100. Annualisation uses {book.metrics.barsPerYear} bars per observed calendar year.
              {result.overfit ? ' Train Sharpe leads the holdout by more than 1.0 — treat the in-sample gain as fragile.' : ' Train and holdout Sharpes are inside the overfit band.'}
            </p>
          </section>

          <section className="vibe-split">
            <article className="vibe-agent">
              <header>Quant</header>
              <p>
                {STRATEGY_LABEL[result.strategy]} searched from {paramsLabel(result.strategy, result.seed)} to {paramsLabel(result.strategy, result.candidate)} using training Sharpe minus half the absolute drawdown.
                Training Sharpe moved from {n2(result.trainSeed.metrics.sharpe)} to {n2(result.trainCandidate.metrics.sharpe)} ({pct(result.trainCandidate.metrics.totalReturn)} train return, {result.trainCandidate.metrics.trades} round trips).
                The holdout was not the objective.
              </p>
            </article>
            <article className="vibe-agent">
              <header>Risk</header>
              <p>
                Holdout drawdown is {pct(book.metrics.maxDrawdown)} with {book.metrics.trades} completed trades.
                The gate asks for at least 3 trades, drawdown shallower than 45%, and either a positive Sharpe or a positive holdout return.
                {result.accepted ? ' The candidate passed, so it replaces the seed in local memory.' : ' The candidate did not pass, so memory is unchanged.'}
                {' '}Fills are the next session open. Each side pays {(FEE * 10_000).toFixed(0)} bps. This desk does not place orders.
              </p>
            </article>
            <article className="vibe-agent">
              <header>Shadow</header>
              <Shadow
                paper={paper}
                strategy={result.strategy}
                holdout={book.metrics.totalReturn}
                ticker={runMeta.ticker}
                instrument={instrument}
              />
            </article>
          </section>

          {result.generations.length > 0 && (
            <section className="vibe-gens">
              <h3>Training search</h3>
              <div className="vibe-gen-list">
                {result.generations.map((gen) => (
                  <div key={gen.gen} className={gen.accepted ? 'vibe-gen on' : 'vibe-gen'}>
                    <span>G{gen.gen}</span>
                    <b>{paramsLabel(result.strategy, gen.params)}</b>
                    <em className={gen.trainReturn >= 0 ? 'up' : 'down'}>{pct(gen.trainReturn)}</em>
                    <em>Sharpe {n2(gen.trainSharpe)}</em>
                    <em>{gen.trades} trades</em>
                    <em>{gen.accepted ? 'kept' : 'dropped'}</em>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <p className="vibe-attrib">
        Research loop and metric conventions follow HKUDS/Vibe-Trading (MIT). This tab is a browser desk on Yahoo daily bars via /api/vibe — not the upstream broker, MCP, or live-order runtime. Simulation only.
      </p>
    </div>
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

function EquityChart({ strategy, benchmark }: { strategy: number[]; benchmark: number[] }) {
  const width = 720;
  const height = 220;
  const pad = 16;
  const s = rebase(strategy);
  const b = rebase(benchmark);
  const all = [...s, ...b];
  if (all.length < 2) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const line = (values: number[]) =>
    values
      .map((value, i) => {
        const x = pad + (i / Math.max(values.length - 1, 1)) * (width - pad * 2);
        const y = height - pad - ((value - min) / span) * (height - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  return (
    <svg className="vibe-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Holdout equity versus buy and hold">
      <polyline points={line(b)} className="bench" />
      <polyline points={line(s)} className="book" />
    </svg>
  );
}

function rebase(values: number[]): number[] {
  if (!values.length || !(values[0] > 0)) return values;
  const base = values[0];
  return values.map((value) => (value / base) * 100);
}

function Shadow({
  paper,
  strategy,
  holdout,
  ticker,
  instrument,
}: {
  paper: PaperStrategy[] | null;
  strategy: StrategyId;
  holdout: number;
  ticker: string;
  instrument: DeskInstrument | undefined;
}) {
  const match = paper?.find((row) => row.id === strategy);
  if (!paper) {
    return <p>The paper journal has not loaded, so there is no live book to set beside this shadow backtest.</p>;
  }
  return (
    <p>
      Shadow holdout on {ticker}
      {instrument ? ` (${instrument.market})` : ''} returned {pct(holdout)}.
      {match ? (
        <>
          {' '}The paper book running the same rule family, {match.label}, is a different experiment: multi-name NSE, equity ₹{Math.round(match.equity).toLocaleString('en-IN')}, realized PnL ₹{Math.round(match.pnl).toLocaleString('en-IN')}, {match.trades} trades
          {match.winRate != null ? `, win rate ${match.winRate.toFixed(0)}%` : ''}. The shadow does not copy those fills.
        </>
      ) : (
        <> No paper strategy uses this rule id. The other paper books stay listed in Paper Lab.</>
      )}
    </p>
  );
}
