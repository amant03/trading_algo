import { useEffect, useRef } from 'react';
import { createChart, ColorType, type IChartApi, type ISeriesApi, type LineData, type UTCTimestamp } from 'lightweight-charts';

const U = (ts: number) => Math.floor(ts / 1000) as UTCTimestamp;

export interface PanelSeries {
  label: string;
  values: (number | null)[];
  color?: string;
  fill?: boolean;
}

interface PanelProps {
  label: string;
  series: PanelSeries[];
  ts: number[];
  height?: number;
  min?: number;
  max?: number;
  bands?: { top?: number; bottom?: number; topColor?: string; bottomColor?: string };
}

export default function Panel({ label, series, ts, height = 92, min, max, bands }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const lastKey = useRef('');

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#5c6a7d', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 },
      grid: { vertLines: { color: 'rgba(38,51,73,0.25)' }, horzLines: { color: 'rgba(38,51,73,0.25)' } },
      rightPriceScale: { borderColor: '#1a2433', minimumWidth: 36 },
      timeScale: { borderColor: '#1a2433', visible: false },
      autoSize: true,
    });

    if (min != null || max != null) {
      const lock = chart.addLineSeries({
        color: 'transparent',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: min ?? 0, maxValue: max ?? 100 } }),
      });
      lock.setData([{ time: U(ts.length ? ts[0] : Date.now()), value: min ?? 0 }]);
    }

    if (bands) {
      const opts = { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false } as const;
      if (bands.top != null) {
        const b = chart.addLineSeries({ ...opts, color: bands.topColor ?? 'rgba(255,176,32,0.5)' });
        b.setData(ts.map((t) => ({ time: U(t), value: bands.top! })));
      }
      if (bands.bottom != null) {
        const b = chart.addLineSeries({ ...opts, color: bands.bottomColor ?? 'rgba(0,214,143,0.5)' });
        b.setData(ts.map((t) => ({ time: U(t), value: bands.bottom! })));
      }
    }

    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.applyOptions({ width: ref.current!.clientWidth }));
    ro.observe(ref.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, min, max]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const s of seriesRef.current) chart.removeSeries(s);
    seriesRef.current = [];

    const built: { series: ISeriesApi<'Line'>; color: string; values: (number | null)[] }[] = [];
    for (const s of series) {
      const color = s.color ?? '#3fd0ea';
      const line = chart.addLineSeries({
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        lineType: s.fill ? 2 : 0,
      });
      seriesRef.current.push(line);
      built.push({ series: line, color, values: s.values });
    }

    const data: LineData<UTCTimestamp>[][] = built.map((b) => {
      const arr: LineData<UTCTimestamp>[] = [];
      for (let i = 0; i < ts.length; i++) {
        if (b.values[i] != null) arr.push({ time: U(ts[i]), value: b.values[i]! });
      }
      return arr;
    });

    const key = series.map((s) => s.label).join('|') + (data.length ? U(ts[ts.length - 1]) : '');
    if (lastKey.current === key && data.length && data.every((d) => d.length)) {
      data.forEach((d, i) => built[i].series.update(d[d.length - 1]));
    } else {
      data.forEach((d, i) => built[i].series.setData(d));
      lastKey.current = key;
    }
  }, [series, ts]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="legend" style={{ marginTop: 0 }}>
        <span className="mono" style={{ color: 'var(--dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 10 }}>{label}</span>
        {series.map((s) => {
          const last = s.values.length ? s.values[s.values.length - 1] : null;
          if (last == null) return null;
          return (
            <span key={s.label} style={{ color: s.color ?? 'var(--cyan)', fontWeight: 600 }}>
              {s.label} {last.toFixed(2)}
            </span>
          );
        })}
      </div>
      <div ref={ref} style={{ width: '100%' }} />
    </div>
  );
}