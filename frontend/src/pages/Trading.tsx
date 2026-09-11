import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '../api';
import { useLive } from '../ws';
import { useAuth } from '../auth';
import { fmt, fmtPct, fmtMoney, fmtTime, cls } from '../format';
import { useToast } from '../components/Toasts';
import { DirectionBadge, StatusBadge } from '../components/Badge';
import { createChart, ColorType, type IChartApi, type ISeriesApi, type LineData, type UTCTimestamp } from 'lightweight-charts';
import type { Portfolio, Position, Order, Trade, Instrument } from '../types';

const U = (ts: number) => Math.floor(ts / 1000) as UTCTimestamp;

function EquityChart({ points }: { points: { ts: number; equity: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height: 260,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8b98ab', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 },
      grid: { vertLines: { color: 'rgba(38,51,73,0.3)' }, horzLines: { color: 'rgba(38,51,73,0.3)' } },
      rightPriceScale: { borderColor: '#1a2433' },
      timeScale: { borderColor: '#1a2433', timeVisible: true, secondsVisible: false },
      autoSize: true,
    });
    const s = chart.addAreaSeries({
      lineColor: '#3fd0ea',
      topColor: 'rgba(63,208,234,0.25)',
      bottomColor: 'rgba(63,208,234,0.02)',
      lineWidth: 2,
    });
    seriesRef.current = s;
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.applyOptions({ width: ref.current!.clientWidth }));
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !points.length) return;
    s.setData(points.map((p) => ({ time: U(p.ts), value: p.equity })));
  }, [points]);

  return <div ref={ref} style={{ width: '100%' }} />;
}

export default function Trading() {
  const navigate = useNavigate();
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const liveOrders = useLive((s) => s.orders);
  const liveTrades = useLive((s) => s.trades);

  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);

  // order form
  const [symbol, setSymbol] = useState('TCS');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [qty, setQty] = useState(1);
  const [limitPrice, setLimitPrice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<Instrument[]>('/api/instruments').then(setInstruments).catch(() => {});
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = () => {
    get<Portfolio>('/api/portfolio').then(setPortfolio).catch(() => {});
    get<Order[]>('/api/orders?limit=40').then(setOrders).catch(() => {});
    get<Trade[]>('/api/trades?limit=40').then(setTrades).catch(() => {});
  };

  const summary = portfolio?.summary;
  const snap = useLive((s) => s.snapshots);

  const estPrice = useMemo(() => {
    const s = snap[symbol.toUpperCase()];
    return s?.price ?? instruments.find((i) => i.symbol === symbol.toUpperCase())?.basePrice ?? 0;
  }, [symbol, snap, instruments]);

  const estTotal = qty * (orderType === 'LIMIT' && Number(limitPrice) > 0 ? Number(limitPrice) : estPrice);

  const placeOrder = async () => {
    setBusy(true);
    try {
      const o = await post<Order>('/api/orders', {
        symbol,
        side,
        orderType,
        quantity: qty,
        limitPrice: orderType === 'LIMIT' ? Number(limitPrice) : undefined,
      });
      toast(`Order #${o.id} ${o.side} ${o.quantity} ${o.symbol} → ${o.status}`, 'ok');
      setQty(1);
      setLimitPrice('');
      setTimeout(refresh, 1500);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const allOrders = useMemo(() => {
    const map = new Map<number, Order>();
    for (const o of orders) map.set(o.id, o);
    for (const o of liveOrders) map.set(o.id, o);
    return [...map.values()].sort((a, b) => b.id - a.id);
  }, [orders, liveOrders]);

  const allTrades = useMemo(() => {
    const map = new Map<number, Trade>();
    for (const t of trades) map.set(t.id, t);
    for (const t of liveTrades) map.set(t.id, t);
    return [...map.values()].sort((a, b) => b.id - a.id);
  }, [trades, liveTrades]);

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Trading Console</h1>
      <p className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
        Paper trading — every signal from the algorithm engine is auto-executed with a 30 bps cost model.
        {user && (
          <> Signed in as <b style={{ color: 'var(--text)' }}>{user.displayName}</b> · your paper portfolio persists across sessions.</>
        )}
      </p>

      <div className="stat-grid">
        <div className="stat-card reveal">
          <div className="stat-label">Account Equity</div>
          <div className="stat-value mono">{summary ? fmtMoney(portfolio!.account.equity) : '—'}</div>
          <div className="stat-sub">
            <span className={cls((summary?.totalPnl ?? 0) >= 0 ? 'up' : 'down')}>{summary ? fmtMoney(summary.totalPnl) : '—'}</span>
            <span className="dim">({summary ? fmtPct(summary.totalPnlPct) : '—'})</span>
          </div>
        </div>
        <div className="stat-card reveal reveal-1">
          <div className="stat-label">Cash / Buying Power</div>
          <div className="stat-value mono">{summary ? fmtMoney(summary.availableCash) : '—'}</div>
          <div className="stat-sub"><span className="dim">invested</span><span className="muted">{summary ? fmtMoney(summary.invested) : '—'}</span></div>
        </div>
        <div className="stat-card reveal reveal-2">
          <div className="stat-label">Unrealized P&L</div>
          <div className={cls('stat-value mono', (summary?.unrealizedPnl ?? 0) >= 0 ? 'up' : 'down')}>{summary ? fmtMoney(summary.unrealizedPnl) : '—'}</div>
          <div className="stat-sub"><span className="dim">open positions</span></div>
        </div>
        <div className="stat-card reveal reveal-3">
          <div className="stat-label">Day P&L</div>
          <div className={cls('stat-value mono', (summary?.dayPnl ?? 0) >= 0 ? 'up' : 'down')}>{summary ? fmtMoney(summary.dayPnl) : '—'}</div>
          <div className="stat-sub"><span className="dim">positions</span><span className="muted">{portfolio?.positions.length ?? 0}</span></div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="panel reveal reveal-1">
          <div className="panel-title"><h3>Equity Curve</h3><span className="hint">1,000,000.00 start</span></div>
          {portfolio?.equityCurve?.length ? <EquityChart points={portfolio.equityCurve} /> : <div className="empty">No equity history yet.</div>}
        </div>

        <div className="order-card reveal reveal-2">
          <div className="panel-title" style={{ marginBottom: 16 }}>
            <h3>Place Order</h3>
            <span className="hint">paper · fills via executor</span>
          </div>
          <div className="side-toggle" style={{ marginBottom: 14 }}>
            <button className={side === 'BUY' ? 'buy-active' : ''} onClick={() => setSide('BUY')}>BUY</button>
            <button className={side === 'SELL' ? 'sell-active' : ''} onClick={() => setSide('SELL')}>SELL</button>
          </div>
          <div className="order-row">
            <div>
              <label>Symbol</label>
              <input className="input" list="instruments" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
              <datalist id="instruments">
                {instruments.map((i) => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}
              </datalist>
            </div>
            <div>
              <label>Order Type</label>
              <select className="select" value={orderType} onChange={(e) => setOrderType(e.target.value as 'MARKET' | 'LIMIT')}>
                <option value="MARKET">Market</option>
                <option value="LIMIT">Limit</option>
              </select>
            </div>
          </div>
          <div className="order-row">
            <div>
              <label>Quantity</label>
              <input className="input" type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
            </div>
            <div>
              <label>{orderType === 'LIMIT' ? 'Limit Price' : 'Est. Price'}</label>
              <input className="input" type="number" value={orderType === 'LIMIT' ? limitPrice : estPrice || ''} placeholder={orderType === 'LIMIT' ? '0.00' : undefined} onChange={(e) => orderType === 'LIMIT' && setLimitPrice(e.target.value)} disabled={orderType === 'MARKET'} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '14px 0' }}>
            <span className="dim" style={{ fontSize: 12 }}>Estimated notional</span>
            <span className={cls('mono', 'up')} style={{ fontWeight: 700 }}>{fmtMoney(estTotal)}</span>
          </div>
          <button className={cls('btn', side === 'BUY' ? 'primary' : 'danger')} style={{ width: '100%' }} onClick={placeOrder} disabled={busy}>
            {busy ? 'Placing…' : `${side === 'BUY' ? 'Buy' : 'Sell'} ${qty} ${symbol.toUpperCase()} @ ${orderType}`}
          </button>
        </div>
      </div>

      <div className="panel reveal reveal-1" style={{ marginBottom: 16 }}>
        <div className="panel-title"><h3>Open Positions</h3><span className="hint">{portfolio?.positions.length ?? 0} open</span></div>
        {portfolio?.positions?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th><th>Qty</th><th>Avg Price</th><th>Last</th><th>Mkt Value</th>
                  <th>Unrealized P&L</th><th>P&L %</th><th>Realized</th><th>Day P&L</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.positions.map((p) => (
                  <tr key={p.instrumentId} onClick={() => navigate(`/stock/${p.symbol}`)}>
                    <td>
                      <div className="sym-cell">{p.symbol}</div>
                      <div className="name-cell">{p.name}</div>
                    </td>
                    <td className="mono">{p.quantity}</td>
                    <td className="mono">{fmt(p.avgPrice)}</td>
                    <td className="mono">{fmt(p.lastPrice)}</td>
                    <td className="mono">{fmtMoney(p.marketValue)}</td>
                    <td className={cls('mono', p.unrealizedPnl >= 0 ? 'up' : 'down')}>{fmtMoney(p.unrealizedPnl)}</td>
                    <td className={cls('mono', p.unrealizedPnlPct >= 0 ? 'up' : 'down')}>{fmtPct(p.unrealizedPnlPct)}</td>
                    <td className={cls('mono', p.realizedPnl >= 0 ? 'up' : 'down')}>{fmtMoney(p.realizedPnl)}</td>
                    <td className={cls('mono', p.dayPnl >= 0 ? 'up' : 'down')}>{fmtMoney(p.dayPnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">No open positions.</div>
        )}
      </div>

      <div className="grid-2">
        <div className="panel reveal reveal-1">
          <div className="panel-title"><h3>Order Book</h3><span className="hint">latest 40</span></div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>#</th><th>Symbol</th><th>Side</th><th>Type</th><th>Qty</th><th>Status</th><th>Time</th></tr>
                </thead>
                <tbody>
                  {allOrders.map((o) => (
                    <tr key={o.id}>
                      <td className="mono dim">{o.id}</td>
                      <td className="sym-cell">{o.symbol}</td>
                      <td><DirectionBadge dir={o.side} /></td>
                      <td className="mono">{o.orderType}</td>
                      <td className="mono">{o.quantity}</td>
                      <td><StatusBadge status={o.status} /></td>
                      <td className="mono dim">{fmtTime(o.createdAt)}</td>
                    </tr>
                  ))}
                  {!allOrders.length && <tr><td colSpan={7}><div className="empty">No orders.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="panel reveal reveal-2">
          <div className="panel-title"><h3>Executions</h3><span className="hint">latest 40</span></div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>#</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Realized</th><th>Time</th></tr>
                </thead>
                <tbody>
                  {allTrades.map((t) => (
                    <tr key={t.id}>
                      <td className="mono dim">{t.id}</td>
                      <td className="sym-cell">{t.symbol}</td>
                      <td><DirectionBadge dir={t.side} /></td>
                      <td className="mono">{t.quantity}</td>
                      <td className="mono">{fmt(t.price)}</td>
                      <td className={cls('mono', t.realizedPnl != null && t.realizedPnl >= 0 ? 'up' : t.realizedPnl != null ? 'down' : 'muted')}>
                        {t.realizedPnl != null ? fmtMoney(t.realizedPnl) : '—'}
                      </td>
                      <td className="mono dim">{fmtTime(t.ts)}</td>
                    </tr>
                  ))}
                  {!allTrades.length && <tr><td colSpan={7}><div className="empty">No executions yet.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}