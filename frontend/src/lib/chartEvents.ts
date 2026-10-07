// Chart marks published by scripts/ci/chart-events.ts.
// Earnings and dividends come from the India scanner. News is joined from
// the news store when the chart draws.

export interface ChartEarn {
  t: number;
  period: string;
  eps: number | null;
  epsEst: number | null;
  revenue: number | null;
  revenueEst: number | null;
  upcoming?: boolean;
}

export interface ChartDiv {
  t: number;
  amount: number | null;
  upcoming?: boolean;
}

export interface SymbolChartEvents {
  earnings: ChartEarn[];
  dividends: ChartDiv[];
}

interface ChartEventsFile {
  asOf?: string;
  source?: string;
  count?: number;
  symbols?: Record<string, SymbolChartEvents>;
}

const URLS = [
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@automation-data/frontend/public/chart-events.json',
  'https://raw.githubusercontent.com/amant03/trading_algo/automation-data/frontend/public/chart-events.json',
  'https://cdn.jsdelivr.net/gh/amant03/trading_algo@main/frontend/public/chart-events.json',
  'https://raw.githubusercontent.com/amant03/trading_algo/main/frontend/public/chart-events.json',
  '/chart-events.json',
];

let cache: ChartEventsFile | null = null;
let inflight: Promise<ChartEventsFile | null> | null = null;

async function loadFile(): Promise<ChartEventsFile | null> {
  if (cache?.symbols) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    for (const url of URLS) {
      try {
        const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const data = (await res.json()) as ChartEventsFile;
        if (data?.symbols && Object.keys(data.symbols).length > 0) {
          cache = data;
          return data;
        }
      } catch {
        /* try the next mirror */
      }
    }
    return null;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export async function loadSymbolEvents(symbol: string): Promise<SymbolChartEvents | null> {
  const file = await loadFile();
  return file?.symbols?.[symbol.toUpperCase()] ?? null;
}
