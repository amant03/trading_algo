import { useEffect, useMemo, useState } from 'react';

interface StratDay { n: number; win: number; net: number; sumRet: number; sumSq: number }
interface StratLearn { weight: number; status: 'active' | 'paused'; reason: string; streak: number }
interface LearnFile {
  updatedAt: string;
  windowDays: number;
  strategies: Record<string, StratLearn>;
  allocation: Record<string, number>;
  lessons: { date: string; text: string }[];
  history: { date: string; per: Record<string, StratDay>; news: { actions: number; net: number; blocked: number } }[];
  newsTotals: { actions: number; net: number; blocked: number };
}

const LEARN_URLS = [
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@automation-data/frontend/public/paper/learning.json',
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/paper/learning.json',
  '/paper/learning.json',
];

const STRAT_LABELS = new Map([
  ['ma_cross', 'MA Cross'],
  ['rsi_reversal', 'RSI Reversal'],
  ['macd_cross', 'MACD Cross'],
  ['bb_breakout', 'Bollinger'],
  ['supertrend', 'Supertrend'],
  ['donchian_breakout', 'Donchian'],
  ['stoch_cross', 'Stochastic'],
]);

const inr = (n: number | null | undefined, digits = 0): string =>
  n == null || !isFinite(n) ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: digits })}`;

const cls = (n: number | null | undefined): string => (n == null ? '' : n > 0.004 ? 'up' : n < -0.004 ? 'down' : '');

export default function BotBrain() {
  const [learn, setLearn] = useState<LearnFile | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      for (const url of LEARN_URLS) {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) continue;
          const ct = res.headers.get('content-type') ?? '';
          if (ct.includes('text/html')) continue;
          const data = (await res.json()) as LearnFile;
          if (!data || !Array.isArray(data.history) || !data.strategies) continue;
          if (live) {
            setLearn(data);
            setErr(null);
          }
          return;
        } catch {
          // try next mirror
        }
      }
      if (live) setErr('Bot brain has no memory yet — it forms after the first learning run.');
    };
    void load();
    const t = setInterval(load, 300_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const agg = useMemo(() => {
    if (!learn) return null;
    const days = learn.history.slice(-learn.windowDays);
    const per: Record<string, { n: number; win: number; net: number; sumRet: number }> = {};
    let totN = 0;
    let totW = 0;
    let totNet = 0;
    for (const d of days) {
      for (const [sid, p] of Object.entries(d.per ?? {})) {
        const a = per[sid] ?? { n: 0, win: 0, net: 0, sumRet: 0 };
        a.n += p.n;
        a.win += p.win;
        a.net = Math.round((a.net + p.net) * 100) / 100;
        a.sumRet += p.sumRet;
        per[sid] = a;
        totN += p.n;
        totW += p.win;
        totNet = Math.round((totNet + p.net) * 100) / 100;
      }
    }
    // Since tracking began (full memory, not just the window).
    let allN = 0;
    let allW = 0;
    let allNet = 0;
    for (const d of learn.history) {
      for (const p of Object.values(d.per ?? {})) {
        allN += p.n;
        allW += p.win;
        allNet = Math.round((allNet + p.net) * 100) / 100;
      }
    }
    return { per, totN, totW, totNet, days, allN, allW, allNet };
  }, [learn]);

  if (err) return <div className="empty">{err}</div>;
  if (!learn || !agg) return <div className="empty">Loading bot brain…</div>;

  const winRate = agg.totN > 0 ? (agg.totW / agg.totN) * 100 : 0;
  const active = Object.entries(learn.strategies).filter(([, s]) => s.status === 'active').length;
  const maxAbs = Math.max(1, ...agg.days.map((d) => Math.abs(Object.values(d.per ?? {}).reduce((a, p) => a + p.net, 0))));
  const allWr = agg.allN > 0 ? (agg.allW / agg.allN) * 100 : 0;

  return (
    <div>
      <div className="panel reveal" style={{ marginBottom: 12, padding: '12px 16px' }}>
        <div className="panel-title" style={{ marginBottom: 8 }}>
          <h3>Bot brain — loss-first, self-improving</h3>
          <span className="hint">
            {learn.history.length} sessions of memory · updated {new Date(learn.updatedAt).toLocaleString('en-IN')}
          </span>
        </div>
        <div className="stat-grid" style={{ marginBottom: 10 }}>
          <div className="stat-card">
            <div className="stat-label">Window accuracy</div>
            <div className={winRate >= 50 ? 'up' : 'down'} style={{ fontSize: 22, fontWeight: 800 }}>{winRate.toFixed(0)}%</div>
            <div className="stat-sub">{agg.totW}W / {agg.totN - agg.totW}L · {agg.totN} round trips</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Window net</div>
            <div className={cls(agg.totNet)} style={{ fontSize: 22, fontWeight: 800 }}>{inr(agg.totNet)}</div>
            <div className="stat-sub">small certain gains, tiny capped losses</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Methods active</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 800 }}>{active}/{Object.keys(learn.strategies).length}</div>
            <div className="stat-sub">losers benched automatically</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">News fuse</div>
            <div className={cls(learn.newsTotals.net)} style={{ fontSize: 22, fontWeight: 800 }}>{inr(learn.newsTotals.net)}</div>
            <div className="stat-sub">{learn.newsTotals.actions} news actions · {learn.newsTotals.blocked} entries blocked</div>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
          Every method earns its bucket from its recent expectancy — bleeders get starved then benched, steady winners
          get more capital. A stop-loss cools the method for 6 bars; two stop-outs on one symbol blacklists it for the
          day. Bearish headlines block entries and force exits. Nothing here is a black box — every decision is logged below.
        </div>
        <div className="mono muted" style={{ fontSize: 12, marginTop: 8 }}>
          Since tracking began: <b className={cls(agg.allNet)}>{inr(Math.round(agg.allNet))}</b> net · {agg.allN} round trips · {allWr.toFixed(0)}% win rate
        </div>
      </div>

      <div className="panel reveal" style={{ marginBottom: 12 }}>
        <div className="panel-title">
          <h3>Method scorecards — weight = trust</h3>
          <span className="hint">1.00× is default · 0 = benched</span>
        </div>
        <div className="strat-grid">
          {Object.entries(learn.strategies).map(([id, s]) => {
            const a = agg.per[id] ?? { n: 0, win: 0, net: 0, sumRet: 0 };
            const exp = a.n > 0 ? a.sumRet / a.n : 0;
            const wr = a.n > 0 ? (a.win / a.n) * 100 : 0;
            const alloc = learn.allocation[id] ?? 0;
            const paused = s.status === 'paused';
            return (
              <div key={id} className="strat-card" style={{ opacity: paused ? 0.75 : 1 }}>
                <div className="strat-head">
                  <span className="strat-name">{STRAT_LABELS.get(id) ?? id}</span>
                  <span
                    style={{
                      fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em',
                      color: paused ? '#ff5c5c' : '#00d68f',
                      background: paused ? 'rgba(255,92,92,0.12)' : 'rgba(0,214,143,0.1)',
                      borderRadius: 4, padding: '2px 8px',
                    }}
                  >
                    {paused ? 'BENCHED' : `${s.weight.toFixed(2)}×`}
                  </span>
                </div>
                <div style={{ height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden', margin: '6px 0 8px' }}>
                  <span style={{ display: 'block', height: '100%', width: `${Math.min(100, (s.weight / 2) * 100)}%`, background: paused ? '#ff5c5c' : '#00d68f' }} />
                </div>
                <div className="strat-row"><span>Window</span><b className="mono">{a.n} trips · {wr.toFixed(0)}% win</b></div>
                <div className="strat-row"><span>Expectancy</span><b className={cls(exp)}>{exp >= 0 ? '+' : ''}{exp.toFixed(2)}%/trade</b></div>
                <div className="strat-row"><span>Net</span><b className={cls(a.net)}>{inr(a.net)}</b></div>
                <div className="strat-row"><span>Capital share</span><b className="mono">{(alloc * 100).toFixed(0)}%</b></div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 6, lineHeight: 1.5 }}>{s.reason}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="panel reveal">
          <div className="panel-title">
            <h3>Accuracy by day</h3>
            <span className="hint">win rate climbs as losers get benched</span>
          </div>
          <div className="table">
            <div className="tr head"><span>Date</span><span>Trips</span><span>Win %</span><span>Net</span></div>
            {[...agg.days].reverse().slice(0, 10).map((d) => {
              const n = Object.values(d.per ?? {}).reduce((a, p) => a + p.n, 0);
              const w = Object.values(d.per ?? {}).reduce((a, p) => a + p.win, 0);
              const net = Object.values(d.per ?? {}).reduce((a, p) => a + p.net, 0);
              const wr = n > 0 ? (w / n) * 100 : 0;
              return (
                <div key={d.date} className="tr">
                  <span className="mono muted">{d.date.slice(5)}</span>
                  <span className="mono">{n}</span>
                  <span className={wr >= 50 ? 'up' : 'down'} style={{ fontWeight: 700 }}>{n > 0 ? `${wr.toFixed(0)}%` : '—'}</span>
                  <span className={cls(net)}>{inr(Math.round(net))}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 64, marginTop: 10 }}>
            {agg.days.slice(-14).map((d) => {
              const net = Object.values(d.per ?? {}).reduce((a, p) => a + p.net, 0);
              const hgt = Math.max(4, Math.min(64, (Math.abs(net) / maxAbs) * 64));
              return (
                <div key={d.date} title={`${d.date}: ${inr(Math.round(net))}`} style={{ flex: 1, display: 'flex', alignItems: 'flex-end', height: 64 }}>
                  <span style={{ display: 'block', width: '100%', height: hgt, borderRadius: 2, background: net >= 0 ? 'var(--up)' : 'var(--down)', opacity: 0.85 }} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel reveal reveal-1">
          <div className="panel-title">
            <h3>Lessons learned</h3>
            <span className="hint">what the bot refuses to repeat</span>
          </div>
          {learn.lessons.length === 0 && <div className="empty">No lessons yet — the brain is still warming up.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
            {[...learn.lessons].reverse().slice(0, 14).map((l, i) => (
              <div key={i} style={{ fontSize: 12.5, lineHeight: 1.55, borderLeft: '2px solid rgba(63,208,234,0.35)', paddingLeft: 10 }}>
                <span className="mono muted" style={{ fontSize: 11 }}>{l.date}</span>
                <div>{l.text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
