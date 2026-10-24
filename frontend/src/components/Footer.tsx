import { Link } from 'react-router-dom';

export const DISCLAIMER =
  'Simulated paper trading platform for educational purposes. Not investment advice. No real money or real order execution involved.';

// Build tag rendered in the footer: lets anyone verify which commit is live
// (and makes stuck-deployment diagnosis trivial — compare with GitHub main).
const BUILD_TAG = 'paper-intraday-10L-20261003';

export default function Footer() {
  return (
    <footer className="footer">
      <span className="dim">{DISCLAIMER}</span>
      <nav className="footer-nav" aria-label="Footer">
        <Link to="/">Dashboard</Link>
        <Link to="/learn">Learn</Link>
        <Link to="/paper">Paper trading</Link>
        <Link to="/algorithms">Algorithms</Link>
        <Link to="/us">US market</Link>
        <Link to="/about">About</Link>
        <Link to="/signup">Sign up</Link>
        <span className="mono dim" style={{ fontSize: 10.5 }} title="Deployed build tag">{BUILD_TAG}</span>
      </nav>
    </footer>
  );
}
