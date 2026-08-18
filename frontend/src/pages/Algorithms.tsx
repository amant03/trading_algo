import { useEffect, useState } from 'react';
import { get, patch } from '../api';
import { useLive } from '../ws';
import { cls } from '../format';
import { useToast } from '../components/Toasts';
import type { AlgorithmConfig } from '../types';

const META: Record<string, { desc: string; accent: string }> = {
  ma_cross: { desc: 'Trend-following cross of fast vs slow moving averages. Longs on golden cross, shorts on death cross.', accent: '#ffb020' },
  rsi_reversal: { desc: 'Mean-reversion signals when RSI leaves overbought / oversold extremes with momentum confirmation.', accent: '#3fd0ea' },
  macd_cross: { desc: 'Momentum MACD crossovers on the histogram with volume confirmation for higher confidence entries.', accent: '#9d7bff' },
  bb_breakout: { desc: 'Volatility breakouts — entries on strong closes beyond the upper or lower Bollinger bands.', accent: '#00d68f' },
  supertrend: { desc: 'SuperTrend trend-flip system — rides trends while the ATF-based band holds its direction.', accent: '#ff5c5c' },
};

export default function Algorithms() {
  const toast = useToast();
  const signals = useLive((s) => s.signals);
  const [configs, setConfigs] = useState<AlgorithmConfig[]>([]);

  useEffect(() => {
    refresh();
  }, []);

  const refresh = () => {
    get<AlgorithmConfig[]>('/api/algorithms').then(setConfigs).catch(() => {});
  };

  const toggle = async (c: AlgorithmConfig, enabled: boolean) => {
    try {
      const res = await patch<AlgorithmConfig>(`/api/algorithms/${c.strategy}`, { enabled });
      setConfigs((prev) => prev.map((x) => (x.strategy === res.strategy ? { ...x, enabled: res.enabled } : x)));
      toast(`${c.strategy.toUpperCase()} ${res.enabled ? 'enabled' : 'disabled'}`, 'ok');
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };

  const byStrategy = (strategy: string) => signals.filter((s) => s.strategy === strategy).slice(0, 5);

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Algorithm Engine</h1>
      <p className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
        Five strategies run on the 1-minute bar stream. Signals are published to Kafka and executed by the paper-trading executor.
      </p>

      <div className="grid-2">
        {configs.map((c, i) => {
          const meta = META[c.strategy] ?? { desc: '', accent: '#3fd0ea' };
          const recent = byStrategy(c.strategy);
          return (
            <div key={c.strategy} className={cls('algo-card reveal', !c.enabled && 'off')} style={{ borderTop: `2px solid ${c.enabled ? meta.accent : 'transparent'}` }}>
              <div className="algo-head">
                <span className="algo-name">{c.strategy.toUpperCase()}</span>
                <div className={cls('switch', c.enabled && 'on')} onClick={() => toggle(c, !c.enabled)} title={c.enabled ? 'Disable' : 'Enable'} />
              </div>
              <div className="algo-desc">{meta.desc}</div>
              <div className="algo-params">
                {Object.entries(c.params ?? {}).map(([k, v]) => (
                  <span key={k} className="algo-param">{k} <b>{String(v)}</b></span>
                ))}
                {!Object.keys(c.params ?? {}).length && <span className="algo-param">default</span>}
              </div>
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="mono dim" style={{ fontSize: 11 }}>{c.enabled ? 'LIVE' : 'PAUSED'}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>{recent.length} recent signals</span>
              </div>
              {recent.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {recent.map((s) => (
                    <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '3px 0', borderTop: '1px solid rgba(26,36,51,0.5)' }}>
                      <span className={cls('mono', s.direction === 'BUY' ? 'up' : 'down')}>{s.direction}</span>
                      <span className="muted">{s.reason.slice(0, 60)}…</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="dim" style={{ marginTop: 10, fontSize: 10.5 }}>signal #{i + 1} · engine refresh 30s</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}