import { Link } from 'react-router-dom';

export const DISCLAIMER =
  'Simulated paper trading platform for educational purposes. Not investment advice. No real money or real order execution involved.';

export default function Footer() {
  return (
    <footer className="footer">
      <span className="dim">{DISCLAIMER}</span>
      <Link to="/about">About & how it works</Link>
    </footer>
  );
}
