import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={{ marginBottom: 4 }}>Page not found</h1>
      <p className="muted" style={{ marginBottom: 16, fontSize: 13, lineHeight: 1.6 }}>
        That address is not part of TradeAlgo. The dashboard, paper lab, and stock pages are still here.
      </p>
      <p className="text-links">
        <Link to="/">Dashboard</Link>
        <Link to="/learn">Learn</Link>
        <Link to="/paper">Paper Lab</Link>
        <Link to="/about">About</Link>
      </p>
    </div>
  );
}
