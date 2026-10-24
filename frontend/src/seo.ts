import { useEffect } from 'react';
import { findChapter, findModule } from './learn/curriculum';

export interface FaqEntry {
  q: string;
  a: string;
}

/** Visible on /about. Keep the JSON-LD copy in lockstep with that section. */
export const ABOUT_FAQ: FaqEntry[] = [
  {
    q: 'Does TradeAlgo place real stock orders?',
    a: 'No. Buys and sells are simulated paper fills with a small slippage cost. Nothing is routed to NSE, BSE, or any other exchange.',
  },
  {
    q: 'Which markets can I look up?',
    a: 'Search covers NSE and BSE listings. Charts, peer comparison, fundamentals, news, and screeners open without an account. A separate US screen streams American quotes.',
  },
  {
    q: 'What can I do after I open a stock?',
    a: 'Each ticker has a candlestick chart, peer comparison, key ratios, supply-chain dependencies, technical signals, an AI analyst, and news with sentiment. You can save it to a watchlist.',
  },
  {
    q: 'How does paper trading work?',
    a: 'The trading console and Paper Lab track virtual cash and simulated positions, including a multi-day book and a fresh intraday book. Algorithms can be switched on or off. No real money is involved.',
  },
];

export interface PageMeta {
  title: string;
  description: string;
  /** Pathname only, beginning with /. The live origin is added in the browser. */
  path: string;
  noindex?: boolean;
  jsonLd?: unknown;
}

const HOME_TITLE = 'TradeAlgo — NSE & BSE Paper Trading Terminal';
const HOME_DESC =
  'Paper-trade NSE and BSE stocks with charts, peer comparison, eight algo strategies, news sentiment, and virtual cash. No real orders.';

const BRAND = 'TradeAlgo';

interface StaticPage {
  title: string;
  description: string;
}

const STATIC: Record<string, StaticPage> = {
  '/': { title: HOME_TITLE, description: HOME_DESC },
  '/about': {
    title: 'How TradeAlgo Works — Indian Paper Trading',
    description:
      'What TradeAlgo simulates: NSE and BSE research, peer comparison, algorithm signals, and a virtual portfolio. Educational, not advice.',
  },
  '/paper': {
    title: 'Paper Lab — Simulated Strategy Books | TradeAlgo',
    description:
      'Watch simulated Indian strategy books: multi-day holds, a fresh intraday book, open positions, and week-by-week results. No real orders.',
  },
  '/trading': {
    title: 'Trading Console — Virtual Portfolio | TradeAlgo',
    description:
      'Place simulated buys and sells, follow open positions, and watch a virtual equity curve. TradeAlgo never sends orders to an exchange.',
  },
  '/algorithms': {
    title: 'Algorithm Engine — 8 Trading Strategies | TradeAlgo',
    description:
      'Eight classic strategies — moving-average cross, RSI, MACD, Bollinger, Supertrend, stochastic, VWAP, and Donchian — with recent signals.',
  },
  '/watchlist': {
    title: 'Stock Watchlist | TradeAlgo',
    description:
      'Save NSE and BSE tickers and jump back to price, chart, peers, and news. The watchlist stays with your TradeAlgo account.',
  },
  '/vibe': {
    title: 'Vibe-Trading Desk Review | TradeAlgo',
    description:
      'Read a desk-style review of simulated trades: shadow books, swarm notes, and an alpha bench. Research tooling, not a broker.',
  },
  '/test': {
    title: 'TradingView Paper Lab | TradeAlgo',
    description:
      'Try simulated fills against TradingView quotes and technical ratings. A local virtual wallet only — no exchange execution.',
  },
  '/us': {
    title: 'US Market Screener | TradeAlgo',
    description:
      'Scan US listings with live-style quotes beside the Indian terminal. Research and paper context only — no real US orders.',
  },
  '/login': {
    title: 'Log in | TradeAlgo',
    description: 'Log in to your TradeAlgo paper portfolio, watchlist, and preferences. Browsing stocks does not require an account.',
  },
  '/signup': {
    title: 'Create a TradeAlgo Account',
    description:
      'Sign up for a free TradeAlgo account: virtual paper portfolio, watchlist, and saved preferences. No real money, no real orders.',
  },
};

function origin(): string {
  if (typeof window === 'undefined') return '';
  const o = window.location.origin;
  if (!o || o === 'null') return '';
  return o;
}

function abs(path: string): string {
  const o = origin();
  return o ? `${o}${path}` : path;
}

function clipDesc(s: string): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  if (clean.length <= 160) return clean;
  const cut = clean.slice(0, 157);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 90 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

function setMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(href: string): void {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function homeGraph(url: string): unknown {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: BRAND,
        url,
        description: HOME_DESC,
        inLanguage: 'en-IN',
      },
      {
        '@type': 'SoftwareApplication',
        name: BRAND,
        applicationCategory: 'FinanceApplication',
        operatingSystem: 'Web',
        url,
        description: HOME_DESC,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
        isAccessibleForFree: true,
      },
    ],
  };
}

function faqGraph(): unknown {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: ABOUT_FAQ.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
}

function webPage(meta: PageMeta, url: string): unknown {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: meta.title,
    description: meta.description,
    url,
    isPartOf: { '@type': 'WebSite', name: BRAND, url: abs('/') },
    inLanguage: 'en-IN',
  };
}

function learnMeta(path: string): PageMeta | undefined {
  if (path === '/learn') {
    return {
      title: 'Learn the Market — Modules | TradeAlgo',
      description:
        'Eight original modules on Indian stocks, charts, fundamentals, futures, options, risk, and trading systems. Free to read. Paper trading only.',
      path,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Course',
        name: 'TradeAlgo Learn',
        description:
          'A free market curriculum for the TradeAlgo paper terminal, from how a price is printed to sizing a trading rule.',
        provider: { '@type': 'Organization', name: BRAND, url: abs('/') },
        inLanguage: 'en-IN',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
      },
    };
  }
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'learn') return undefined;
  if (parts.length === 2) {
    const mod = findModule(parts[1]);
    if (!mod) return undefined;
    return {
      title: `${mod.title} — Learn | TradeAlgo`,
      description: mod.blurb,
      path,
    };
  }
  if (parts.length === 3) {
    const hit = findChapter(parts[1], parts[2]);
    if (!hit) return undefined;
    const lead = hit.chapter.blocks.find((block) => block.kind === 'p');
    return {
      title: `${hit.chapter.title} — ${hit.module.title} | TradeAlgo`,
      description: lead && lead.kind === 'p' ? lead.text : hit.module.blurb,
      path,
    };
  }
  return undefined;
}

export function pageMeta(pathname: string): PageMeta {
  const path = pathname.split('?')[0] || '/';
  const learn = learnMeta(path);
  if (learn) return learn;
  const stock = path.match(/^\/stock\/([^/]+)\/?$/);
  if (stock) {
    const symbol = decodeURIComponent(stock[1]).toUpperCase();
    return {
      title: `${symbol} Share Price, Chart & Peers | TradeAlgo`,
      description: `${symbol} share price, candlestick chart, peer comparison, fundamentals, news sentiment, and paper trading on TradeAlgo.`,
      path,
    };
  }
  const known = STATIC[path];
  if (!known) {
    return {
      title: 'Page not found | TradeAlgo',
      description: 'That page is not on TradeAlgo. Return to the market dashboard, paper lab, or stock search.',
      path,
      noindex: true,
    };
  }
  const meta: PageMeta = { title: known.title, description: known.description, path };
  if (path === '/') meta.jsonLd = homeGraph(abs('/'));
  else if (path === '/about') meta.jsonLd = faqGraph();
  return meta;
}

export function applyPageMeta(meta: PageMeta): void {
  const description = clipDesc(meta.description);
  const path = meta.path.startsWith('/') ? meta.path : `/${meta.path}`;
  const url = abs(path);
  document.title = meta.title;
  setMeta('name', 'description', description);
  setMeta('name', 'robots', meta.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1');
  setCanonical(url);
  setMeta('property', 'og:title', meta.title);
  setMeta('property', 'og:description', description);
  setMeta('property', 'og:url', url);
  setMeta('property', 'og:type', 'website');
  setMeta('property', 'og:site_name', BRAND);
  setMeta('property', 'og:locale', 'en_IN');
  const image = abs('/og.png');
  setMeta('property', 'og:image', image);
  setMeta('property', 'og:image:alt', 'TradeAlgo — NSE and BSE paper trading terminal');
  setMeta('name', 'twitter:card', 'summary_large_image');
  setMeta('name', 'twitter:title', meta.title);
  setMeta('name', 'twitter:description', description);
  setMeta('name', 'twitter:image', image);
  const graph = meta.jsonLd ?? webPage({ ...meta, description }, url);
  let ld = document.getElementById('ld-json');
  if (!ld) {
    ld = document.createElement('script');
    ld.id = 'ld-json';
    ld.setAttribute('type', 'application/ld+json');
    document.head.appendChild(ld);
  }
  ld.textContent = JSON.stringify(graph);
}

/** Route-level titles for pages that know more than the path (a company name). */
export function usePageMeta(meta: PageMeta): void {
  const { title, description, path, noindex } = meta;
  useEffect(() => {
    applyPageMeta({ title, description, path, noindex, jsonLd: meta.jsonLd });
  }, [title, description, path, noindex, meta.jsonLd]);
}
