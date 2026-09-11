import { Link } from 'react-router-dom';
import { DISCLAIMER } from '../components/Footer';

export default function About() {
  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ marginBottom: 4 }}>About TradeAlgo</h1>
      <p className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
        A simulated paper-trading terminal for the Indian market.
      </p>

      <div className="panel reveal" style={{ marginBottom: 16 }}>
        <div className="panel-title"><h3>What this is</h3></div>
        <p style={{ fontSize: 14, lineHeight: 1.65 }}>
          TradeAlgo streams live-ish market data, computes classic technical indicators
          (RSI, MACD, Bollinger Bands, Supertrend and more), runs eight algorithmic
          strategies over them, and lets you practise trading with{' '}
          <b>₹1,00,000 in virtual cash</b>. Every order is simulated by the paper
          broker with a small slippage cost — nothing here touches a real exchange.
        </p>
      </div>

      <div className="panel reveal reveal-1" style={{ marginBottom: 16 }}>
        <div className="panel-title"><h3>Your account</h3></div>
        <p style={{ fontSize: 14, lineHeight: 1.65 }}>
          Signing up gives you your own persistent paper portfolio, watchlist and
          preferences. Browsing stocks, charts, fundamentals and news never requires
          an account — only placing trades and saving a watchlist do, and only when
          the live backend is reachable. When it isn't, the app keeps working
          anonymously on the last automation snapshot.
        </p>
      </div>

      <div className="panel reveal reveal-2" style={{ marginBottom: 16 }}>
        <div className="panel-title"><h3>Data & simulation notes</h3></div>
        <ul style={{ fontSize: 14, lineHeight: 1.7, paddingLeft: 20, margin: 0 }}>
          <li>Prices come from the live feed when connected, otherwise the latest CI snapshot.</li>
          <li>Market fills apply 0.05% adverse slippage; limit orders fill when price crosses.</li>
          <li>Auto-trading caps at 15 concurrent positions, ~3% of equity per signal.</li>
          <li>Fundamentals, peers and supply-chain data refresh on a nightly schedule.</li>
        </ul>
      </div>

      <div className="panel reveal reveal-3">
        <div className="panel-title"><h3>Disclaimer</h3></div>
        <p style={{ fontSize: 14, lineHeight: 1.65 }}>{DISCLAIMER}</p>
        <p className="muted" style={{ fontSize: 13 }}>
          Back to <Link to="/">Dashboard</Link>
        </p>
      </div>
    </div>
  );
}
