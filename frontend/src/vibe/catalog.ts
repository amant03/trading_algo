export const ENGINES: { market: string; rules: string }[] = [
  { market: 'India (NSE / BSE)', rules: 'Delivery on daily bars. This desk fills the next open and charges 10 bps a side. Circuit bands and the statutory cost stack are not applied.' },
  { market: 'Global equities', rules: 'US, Hong Kong, Canada, UK, and index suffixes. Same daily fill. Per-market lot and tax rules are not applied.' },
  { market: 'Korea', rules: 'KOSPI and KOSDAQ tick grid and the ±30% band are not applied. Daily bars still run.' },
  { market: 'Vietnam', rules: 'HOSE tick grid is not applied.' },
  { market: 'Crypto', rules: 'Funding, maker and taker fees, and liquidation are not applied. Daily spot bars still run.' },
  { market: 'Forex and metals', rules: 'Spread, leverage, and lot size are not applied. Daily bars still run.' },
  { market: 'China A-shares', rules: 'T+1, the retail short ban, price limits, and 100-share lots are not modelled. A backtest is refused rather than run under India rules.' },
  { market: 'China futures', rules: 'Margin and exchange price limits are not connected.' },
  { market: 'Global futures', rules: 'Contract multipliers are not connected. A continuous future such as gold can still be priced.' },
  { market: 'Composite', rules: 'The portfolio section puts the names you typed in one book. It does not mix market rules.' },
  { market: 'Options', rules: 'No option chain is connected, so multi-leg books are not priced.' },
];

export const INTERVALS = ['1m', '5m', '15m', '30m', '1H', '4H', '1D', '1W', '1M'];

export const SOURCES: { market: string; chain: string; here: string }[] = [
  { market: 'India', chain: 'Yahoo, then a local file', here: 'Yahoo daily' },
  { market: 'US, Hong Kong, Canada, UK, Korea', chain: 'Yahoo', here: 'Yahoo daily when you type the suffix' },
  { market: 'Crypto, forex, metals', chain: 'Yahoo', here: 'Yahoo daily when you type the Yahoo symbol' },
  { market: 'China A-shares, funds, macro', chain: 'Not connected', here: 'Left blank' },
  { market: 'Paper journal', chain: 'This site', here: 'Closed sells for the symbols you type' },
  { market: 'Fundamentals', chain: 'analysis.json', here: 'PE, ROE, rating, fair value' },
];

export const SKILLS: { category: string; count: number; here: string }[] = [
  { category: 'Analysis', count: 23, here: 'Comps, valuation gap, and the memo use the names you type.' },
  { category: 'Strategy', count: 19, here: 'Moving average, RSI, MACD, and Donchian are walked forward.' },
  { category: 'Data sources', count: 10, here: 'Yahoo is the source that answers. The others are named and not called.' },
  { category: 'Tools', count: 10, here: 'The run writes metrics, a holdout, and a bootstrap band.' },
  { category: 'Asset classes', count: 9, here: 'Equities you type. Options, credit, and funds stay quiet.' },
  { category: 'Flow', count: 8, here: 'The paper journal is the flow we can read.' },
  { category: 'Crypto', count: 7, here: 'A crypto symbol is priced. Funding is not modelled.' },
  { category: 'Research', count: 3, here: 'The lab note is the research write-up.' },
  { category: 'Risk analysis', count: 1, here: 'The holdout gate, drawdown, and Monte Carlo band.' },
];

export const COMMANDS = [
  { id: 'comps', label: '/comps', blurb: 'Set the names you typed beside each other.' },
  { id: 'dcf', label: '/dcf', blurb: 'Last price against the stored fair value, plus earnings yield.' },
  { id: 'attrib', label: '/attrib', blurb: 'How much of the journal loss each typed name contributed.' },
  { id: 'memo', label: '/memo', blurb: 'A short note from the same figures.' },
  { id: 'earnings', label: '/earnings', blurb: 'PE and ROE. There is no earnings calendar.' },
  { id: 'screen', label: '/screen', blurb: 'The value gate, applied only to the names you typed.' },
];

export const ZOOS: { id: string; label: string; count: number; here: string }[] = [
  { id: 'academic', label: 'Academic', count: 12, here: '20-bar momentum, 5-bar reversal, and low volatility are scored on the names you type. A two-name panel is not a cross-section.' },
  { id: 'fundamental', label: 'Fundamental', count: 4, here: 'Margin of safety is the screen, not a timed coefficient.' },
  { id: 'gtja191', label: 'Guotai Junan 191', count: 191, here: 'Needs the China bar store. Not scored.' },
  { id: 'qlib158', label: 'Qlib Alpha158', count: 154, here: 'Needs the full feature panel. Not scored.' },
  { id: 'alpha101', label: 'Kakushadze 101', count: 101, here: 'Needs the full bar store. Not scored.' },
];

export const BROKERS: { access: string; names: string }[] = [
  { access: 'Live orders inside a mandate, plus paper', names: 'Alpaca, Binance, eToro, Futu, MetaTrader 5, OKX, Tiger' },
  { access: 'Live orders inside a mandate', names: 'Robinhood' },
  { access: 'Paper orders only', names: 'Dhan, KIS, Longbridge, Shoonya, Upbit, Zerodha' },
  { access: 'Read-only', names: 'IBKR, Scalable Capital, Toss, Trading 212' },
];

export function engineFor(ticker: string): string {
  const symbol = ticker.toUpperCase();
  if (symbol.endsWith('.NS') || symbol.endsWith('.BO')) return 'India (NSE / BSE)';
  if (symbol.endsWith('.KS') || symbol.endsWith('.KQ')) return 'Korea';
  if (symbol.endsWith('.VN')) return 'Vietnam';
  if (symbol.endsWith('.SS') || symbol.endsWith('.SZ')) return 'China A-shares';
  if (symbol.includes('-USD') || symbol.endsWith('-USDT')) return 'Crypto';
  if (symbol.endsWith('=X')) return 'Forex and metals';
  if (symbol.endsWith('=F')) return 'Global futures';
  return 'Global equities';
}
