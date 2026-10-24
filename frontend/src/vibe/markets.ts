// Instruments the Vibe-Trading desk can ground a run on.
// Tickers are Yahoo symbols. Local dates follow each listing's exchange clock
// so a cross-market correlation lines up sessions, not UTC midnights.

export interface DeskInstrument {
  ticker: string;
  label: string;
  market: string;
  timeZone: string;
  aliases: string[];
}

export const DESK: DeskInstrument[] = [
  { ticker: 'RELIANCE.NS', label: 'RELIANCE', market: 'India', timeZone: 'Asia/Kolkata', aliases: ['reliance', 'reliance.ns'] },
  { ticker: 'AAPL', label: 'AAPL', market: 'US', timeZone: 'America/New_York', aliases: ['aapl', 'apple'] },
  { ticker: '0700.HK', label: '0700', market: 'Hong Kong', timeZone: 'Asia/Hong_Kong', aliases: ['0700.hk', 'tencent'] },
  { ticker: 'SHOP.TO', label: 'SHOP', market: 'Canada', timeZone: 'America/Toronto', aliases: ['shop.to', 'shopify'] },
  { ticker: 'HSBA.L', label: 'HSBA', market: 'UK', timeZone: 'Europe/London', aliases: ['hsba.l', 'hsbc'] },
  { ticker: '005930.KS', label: '005930', market: 'Korea', timeZone: 'Asia/Seoul', aliases: ['005930.ks', 'samsung'] },
  { ticker: 'BTC-USD', label: 'BTC', market: 'Crypto', timeZone: 'UTC', aliases: ['btc', 'btc-usd', 'bitcoin'] },
  { ticker: 'EURUSD=X', label: 'EURUSD', market: 'Forex', timeZone: 'UTC', aliases: ['eurusd', 'eurusd=x'] },
  { ticker: 'GC=F', label: 'GOLD', market: 'Futures', timeZone: 'America/New_York', aliases: ['gc=f', 'gold'] },
];

export function findInstrument(ticker: string): DeskInstrument | undefined {
  const key = ticker.trim().toUpperCase();
  return DESK.find((d) => d.ticker === key);
}

export function localDate(epochSec: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochSec * 1000));
}
