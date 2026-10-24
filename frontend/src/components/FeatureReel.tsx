import { useState } from 'react';
import { Link } from 'react-router-dom';

const TOUR_ALT =
  'Silent looping tour of TradeAlgo. Scenes show the market dashboard, stock search, a candlestick chart, peer comparison, a paper-trading book, algorithm signals, and news with a screener. Figures are illustrative, not live quotes.';

/**
 * Short product tour. The GIF is the visual; the list is the same story in text
 * so the page still says what the product does if images are slow or paused.
 */
export default function FeatureReel() {
  const [playing, setPlaying] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  return (
    <section className="reel" aria-labelledby="reel-title">
      <div className="reel-screen">
        <div className="reel-bezel">
          <img
            src={playing ? '/tradealgo-tour.gif' : '/tradealgo-tour-poster.png'}
            alt={TOUR_ALT}
            width={760}
            height={428}
            decoding="async"
            fetchPriority="low"
          />
          <button
            type="button"
            className="reel-pause"
            onClick={() => setPlaying((v) => !v)}
            aria-pressed={playing}
          >
            {playing ? 'Pause tour' : 'Play tour'}
          </button>
        </div>
        <p className="reel-note">Silent loop · sample figures, not a live quote</p>
      </div>
      <div className="reel-copy">
        <p className="reel-kicker">Product tour</p>
        <h2 id="reel-title">What you can do here</h2>
        <p>
          Search a listing, set it next to its peers, read the chart and the signals, then practise the order
          with virtual cash. The reel walks through that path.
        </p>
        <ol className="reel-list">
          <li>
            <Link to="/">Market dashboard</Link>
            <span> — movers, sectors, FII/DII, and the day’s news sentiment.</span>
          </li>
          <li>
            <Link to="/learn">Learn</Link>
            <span> — eight modules, from the order book to a trading system. Progress stays in this browser.</span>
          </li>
          <li>
            <Link to="/stock/RELIANCE">Open a stock</Link>
            <span> — chart, peer comparison, ratios, dependencies, AI notes, and headlines.</span>
          </li>
          <li>
            <Link to="/paper">Paper Lab</Link>
            <span> — simulated multi-day and intraday books. Nothing is sent to an exchange.</span>
          </li>
          <li>
            <Link to="/trading">Trading console</Link>
            <span> — virtual buys and sells against your paper portfolio.</span>
          </li>
          <li>
            <Link to="/algorithms">Algorithm engine</Link>
            <span> — eight strategies and the signals they print.</span>
          </li>
          <li>
            <Link to="/watchlist">Watchlist</Link>
            <span>, </span>
            <Link to="/us">US screen</Link>
            <span>, and </span>
            <Link to="/vibe">vibe-trading desk</Link>
            <span> — plus a </span>
            <Link to="/test">TradingView paper lab</Link>
            <span>.</span>
          </li>
        </ol>
      </div>
    </section>
  );
}
