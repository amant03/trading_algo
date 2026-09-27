import { useEffect, useState } from 'react';

interface FlowDay {
  date: string;
  fDate: string;
  fiiCash: number | null;
  diiCash: number | null;
  fiiIdxFut: number | null;
  fiiIdxOpt: number | null;
  fiiStkFut: number | null;
  fiiStkOpt: number | null;
  fpiEquityBuy: number | null;
  fpiEquitySell: number | null;
  fpiEquityNet: number | null;
  fpiEquityNetUsd: number | null;
}

interface FiiDiiFile {
  generatedAt: string;
  sources: { nsdl: string; moneycontrol: string };
  currency: string;
  days: FlowDay[];
}

const URLS = [
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@automation-data/frontend/public/fii-dii.json',
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/fii-dii.json',
  '/fii-dii.json',
];

const cr = (n: number | null | undefined): string =>
  n == null || !isFinite(n) ? '—' : `${n >= 0 ? '+' : '−'}₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })} cr`;

const cls = (n: number | null | undefined): string => (n == null ? '' : n > 0 ? 'up' : n < 0 ? 'down' : '');

export default function FiiDiiPanel() {
  const [file, setFile] = useState<FiiDiiFile | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      for (const url of URLS) {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) continue;
          const ct = res.headers.get('content-type') ?? '';
          if (ct.includes('text/html')) continue;
          const data = (await res.json()) as FiiDiiFile;
          if (data && Array.isArray(data.days) && data.days.length) {
            if (live) setFile(data);
            return;
          }
        } catch {
          // try next mirror
        }
      }
    })();
    return () => { live = false; };
  }, []);

  if (!file) return null;
  const days = file.days.slice(-14);
  const latest = file.days[file.days.length - 1];
  const maxAbs = Math.max(1, ...days.flatMap((d) => [Math.abs(d.fiiCash ?? 0), Math.abs(d.diiCash ?? 0)]));

  return (
    <div className="panel reveal" style={{ marginBottom: 16 }}>
      <div className="panel-title">
        <h3>FII / DII activity — cash market, ₹ cr net</h3>
        <span className="hint">
          {latest.fDate} · FPI eq (NSDL) {cr(latest.fpiEquityNet)}
        </span>
      </div>
      <div className="stat-grid" style={{ marginBottom: 10 }}>
        <div className="stat-card">
          <div className="stat-label">FII cash (latest)</div>
          <div className={cls(latest.fiiCash)} style={{ fontSize: 20, fontWeight: 800 }}>{cr(latest.fiiCash)}</div>
          <div className="stat-sub">foreign institutions net</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">DII cash (latest)</div>
          <div className={cls(latest.diiCash)} style={{ fontSize: 20, fontWeight: 800 }}>{cr(latest.diiCash)}</div>
          <div className="stat-sub">domestic institutions net</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">FII F&O (latest)</div>
          <div className="mono" style={{ fontSize: 13, lineHeight: 1.7 }}>
            idx fut <span className={cls(latest.fiiIdxFut)}>{cr(latest.fiiIdxFut)}</span><br />
            idx opt <span className={cls(latest.fiiIdxOpt)}>{cr(latest.fiiIdxOpt)}</span>
          </div>
          <div className="stat-sub">stock fut {cr(latest.fiiStkFut)} · stock opt {cr(latest.fiiStkOpt)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {days.map((d) => (
          <div key={d.date} style={{ display: 'grid', gridTemplateColumns: '86px 1fr 1fr', gap: 8, alignItems: 'center', fontSize: 11.5 }}>
            <span className="mono muted">{d.date.slice(5)}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="mono" style={{ width: 92, textAlign: 'right', color: (d.fiiCash ?? 0) >= 0 ? 'var(--up)' : 'var(--down)' }}>
                {d.fiiCash != null ? `${d.fiiCash >= 0 ? '+' : ''}${Math.round(d.fiiCash).toLocaleString('en-IN')}` : '—'}
              </span>
              <span style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden', display: 'flex', justifyContent: 'flex-end' }}>
                <span style={{ display: 'block', height: '100%', width: `${(Math.abs(d.fiiCash ?? 0) / maxAbs) * 100}%`, background: (d.fiiCash ?? 0) >= 0 ? 'var(--up)' : 'var(--down)' }} />
              </span>
              <span className="muted">FII</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="muted">DII</span>
              <span style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${(Math.abs(d.diiCash ?? 0) / maxAbs) * 100}%`, background: (d.diiCash ?? 0) >= 0 ? 'var(--up)' : 'var(--down)' }} />
              </span>
              <span className="mono" style={{ width: 92, color: (d.diiCash ?? 0) >= 0 ? 'var(--up)' : 'var(--down)' }}>
                {d.diiCash != null ? `${d.diiCash >= 0 ? '+' : ''}${Math.round(d.diiCash).toLocaleString('en-IN')}` : '—'}
              </span>
            </span>
          </div>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Sources: {file.sources.nsdl} · {file.sources.moneycontrol} · updated {new Date(file.generatedAt).toLocaleString('en-IN')}
      </div>
    </div>
  );
}
