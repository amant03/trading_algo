import { cls } from '../format';

export default function Badge({ kind, children }: { kind: 'buy' | 'sell' | 'info' | 'warn' | 'neutral' | 'grade-a' | 'grade-b' | 'grade-c'; children: React.ReactNode }) {
  return <span className={cls('badge', kind)}>{children}</span>;
}

export const DirectionBadge = ({ dir }: { dir: string }) =>
  dir.toUpperCase() === 'BUY' ? <Badge kind="buy">BUY</Badge> : <Badge kind="sell">SELL</Badge>;

export const StatusBadge = ({ status }: { status: string }) => {
  const kind = status === 'FILLED' ? 'buy' : status === 'PENDING' ? 'warn' : status === 'REJECTED' || status === 'CANCELLED' ? 'sell' : 'info';
  return <Badge kind={kind as 'buy' | 'warn' | 'sell' | 'info'}>{status}</Badge>;
};

export const ImpactBadge = ({ impact }: { impact: string }) => {
  const kind = impact === 'HIGH' ? 'warn' : impact === 'MEDIUM' ? 'info' : 'neutral';
  return <Badge kind={kind as 'warn' | 'info' | 'neutral'}>{impact}</Badge>;
};

export const SentimentBadge = ({ sentiment }: { sentiment: string }) =>
  sentiment.toUpperCase() === 'BULLISH' ? <Badge kind="buy">Positive</Badge> : sentiment.toUpperCase() === 'BEARISH' ? <Badge kind="sell">Negative</Badge> : <Badge kind="neutral">Neutral</Badge>;

export const GradeBadge = ({ grade }: { grade: string }) => {
  const g = grade.toUpperCase();
  const kind = g.startsWith('A') ? 'grade-a' : g.startsWith('B') ? 'grade-b' : 'grade-c';
  return <span className={cls('badge neutral', kind)}>{grade}</span>;
};
