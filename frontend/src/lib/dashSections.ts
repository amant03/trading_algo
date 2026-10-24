/** Dashboard anchors. The left rail and the mobile jump bar both use this list. */
export const DASH_SECTIONS = [
  { id: 'movers', label: 'Top movers' },
  { id: 'news', label: 'News' },
  { id: 'watch', label: 'Stocks to watch out' },
  { id: 'flows', label: 'FII, DII activity' },
  { id: 'signals', label: 'Algorithmic signals' },
  { id: 'commodities', label: 'Crude, metals, bullion' },
  { id: 'correlation', label: 'Correlation' },
] as const;

export type DashSectionId = (typeof DASH_SECTIONS)[number]['id'];
