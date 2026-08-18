export const fmt = (n: number | null | undefined, digits = 2): string =>
  n == null || Number.isNaN(n) ? '—' : n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtPct = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

export const fmtCompact = (n: number | null | undefined): string => {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
};

export const fmtTime = (ts: number | string): string => {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export const fmtDate = (ts: number | string): string => {
  const d = new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

export const fmtMoney = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? '—' : `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export const timeAgo = (ts: number): string => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export const cls = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ');
