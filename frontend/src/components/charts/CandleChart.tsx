import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '../../types';

const U = (ts: number) => Math.floor(ts / 1000) as UTCTimestamp;

export interface Overlay {
  label: string;
  color: string;
  data: LineData<UTCTimestamp>[];
  width?: number;
}

interface Props {
  candles: Candle[];
  overlays?: Overlay[];
  showVolume?: boolean;
  height?: number;
}

const UP = '#00d68f';
const DOWN = '#ff5c5c';

export default function CandleChart({ candles, overlays = [], showVolume = true, height = 470 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeries = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volSeries = useRef<ISeriesApi<'Histogram'> | null>(null);
  const overlaySeries = useRef<{ label: string; series: ISeriesApi<'Line'> }[]>([]);
  const lastTs = useRef(0);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b98ab',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: 'rgba(38,51,73,0.32)' }, horzLines: { color: 'rgba(38,51,73,0.32)' } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(139,152,171,0.35)', labelBackgroundColor: '#1a2433' },
        horzLine: { color: 'rgba(139,152,171,0.35)', labelBackgroundColor: '#1a2433' },
      },
      rightPriceScale: { borderColor: '#1a2433' },
      timeScale: { borderColor: '#1a2433', timeVisible: true, secondsVisible: false },
      autoSize: true,
    });

    candleSeries.current = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });

    if (showVolume) {
      volSeries.current = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: '',
        lastValueVisible: false,
      });
      chart.priceScale('').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    }

    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.applyOptions({ width: ref.current!.clientWidth }));
    ro.observe(ref.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeries.current = null;
      volSeries.current = null;
      overlaySeries.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, showVolume]);

  useEffect(() => {
    if (!candleSeries.current || candles.length === 0) return;
    const data: CandlestickData<UTCTimestamp>[] = candles.map((c) => ({
      time: U(c.ts),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    const last = candles[candles.length - 1];
    if (lastTs.current === U(last.ts) && candleSeries.current) {
      candleSeries.current.update(data[data.length - 1]);
    } else {
      candleSeries.current.setData(data);
      lastTs.current = U(last.ts);
    }
  }, [candles]);

  useEffect(() => {
    if (!candleSeries.current) return;
    if (volSeries.current) {
      const vdata: HistogramData[] = candles.map((c) => ({
        time: U(c.ts),
        value: c.volume,
        color: c.close >= c.open ? 'rgba(0,214,143,0.28)' : 'rgba(255,92,92,0.28)',
      }));
      if (vdata.length) volSeries.current.setData(vdata);
    }
  }, [candles]);

  useEffect(() => {
    if (!chartRef.current) return;
    for (const o of overlaySeries.current) chartRef.current.removeSeries(o.series);
    overlaySeries.current = [];
    if (!candleSeries.current) return;
    for (const o of overlays) {
      const s = chartRef.current.addLineSeries({
        color: o.color,
        lineWidth: (o.width ?? 1) as 1 | 2 | 3 | 4,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData(o.data);
      overlaySeries.current.push({ label: o.label, series: s });
    }
  }, [overlays]);

  return <div ref={ref} style={{ width: '100%' }} />;
}
