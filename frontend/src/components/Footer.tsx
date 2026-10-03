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
      <span style={{ display: 'inline-flex', gap: 12, alignItems: 'center' }}>
        <span className="mono dim" style={{ fontSize: 10.5 }} title="Deployed build tag">{BUILD_TAG}</span>
        <Link to="/about">About & how it works</Link>
      </span>
    </footer>
  );
}
