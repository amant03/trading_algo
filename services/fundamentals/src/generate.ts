import {
  CompanyRelation,
  Fundamentals,
  Instrument,
  SeededRng,
  clamp,
  round2,
} from '@trading/shared';
import { SECTOR_TEMPLATES, SECTOR_POOLS, SectorTemplate } from './sectors.js';

const FALLBACK: SectorTemplate = {
  pe: [15, 30], pb: [2, 6], roe: [12, 22], netMargin: [8, 16], grossMargin: [28, 45],
  revenueGrowth: [5, 14], debtToEquity: [0.2, 1], currentRatio: [1.2, 2.4],
  dividendYield: [0.8, 2.2], beta: [0.9, 1.2], employeeRevenueCr: [0.5, 1.5],
  promoter: [40, 70], fii: [6, 22],
};

function ratio(rng: SeededRng, [lo, hi]: [number, number], skew = 0.5): number {
  const base = lo + (hi - lo) * Math.pow(rng.next(), skew);
  return round2(base);
}

const DESCRIPTION_TEMPLATES = [
  'One of the leading {industry} companies in India, with a strong franchise across {sector} value chains, consistent operating track record and a defensible market position.',
  'A diversified player in the {industry} space, focused on profitable growth, capital efficiency and long-term shareholder value creation across {sector} markets.',
  'An established {industry} business with deep moats, disciplined capital allocation and a large, loyal customer base within the {sector} sector.',
];

export interface GeneratedCompany {
  fundamentals: Fundamentals;
  relations: CompanyRelation[];
}

export function generateCompany(inst: Instrument, peers: Instrument[]): GeneratedCompany {
  const rng = new SeededRng(100_000 + inst.id * 104_729);
  const tpl = SECTOR_TEMPLATES[inst.sector ?? ''] ?? FALLBACK;
  const pool = SECTOR_POOLS[inst.sector ?? ''] ?? SECTOR_POOLS.Conglomerate;

  const price = inst.basePrice;
  const pe = ratio(rng, tpl.pe);
  const netIncome = (inst.marketCap ?? 1e5) / pe; // crores
  const netMargin = ratio(rng, tpl.netMargin, 0.6);
  const revenue = netIncome / Math.max(netMargin, 0.01);
  const roe = ratio(rng, tpl.roe, 0.6);
  const equity = (netIncome / roe) * 100;
  const pb = ratio(rng, tpl.pb);
  const bookValue = price / pb;
  const shares = (inst.marketCap ?? 1e5) / price;
  const eps = netIncome / shares;
  const revenueGrowth = ratio(rng, tpl.revenueGrowth, 0.5);
  const netIncomeGrowth = round2(revenueGrowth + rng.range(-4, 8));
  const debtToEquity = ratio(rng, tpl.debtToEquity, 0.7);
  const currentRatio = ratio(rng, tpl.currentRatio, 0.7);
  const quickRatio = round2(currentRatio * rng.range(0.55, 0.85));
  const grossMargin = ratio(rng, tpl.grossMargin, 0.5);
  const operatingMargin = round2(netMargin * rng.range(1.15, 1.6));
  const dividendYield = ratio(rng, tpl.dividendYield, 0.5);
  const beta = round2(rng.range(tpl.beta[0], tpl.beta[1]));
  const [empLo, empHi] = tpl.employeeRevenueCr;
  const employees = Math.max(500, Math.round((revenue / rng.range(empLo, empHi)) * 1e4));
  const promoterHolding = round2(rng.range(tpl.promoter[0], tpl.promoter[1]));
  const fiiHolding = round2(rng.range(tpl.fii[0], tpl.fii[1]));

  const hiUp = rng.range(0.12, 0.35);
  const lowDown = rng.range(0.1, 0.3);
  const fiftyTwoWeekHigh = round2(price * (1 + hiUp));
  const fiftyTwoWeekLow = round2(price * (1 - lowDown));
  const ps = round2(price * shares / Math.max(revenue, 1));
  const peg = round2(pe / Math.max(revenueGrowth, 0.5));
  const avgVolume = Math.round((inst.marketCap ?? 1e5) * 1e7 / Math.max(price, 1) * 0.004);

  // ---- investability scoring (0-100) ----
  const sectorPeHi = tpl.pe[1];
  const sectorPeLo = tpl.pe[0];
  const valueScore = 100 - clamp(((pe - sectorPeLo) / Math.max(sectorPeHi - sectorPeLo, 1)) * 100, 0, 100);
  const growthScore = clamp((revenueGrowth / 25) * 100, 0, 100);
  const profitabilityScore = clamp(((roe - 5) / 30) * 100, 0, 100);
  const safetyScore = clamp(100 - debtToEquity * 30, 0, 100);
  const momentumScore = clamp(((price - fiftyTwoWeekLow) / Math.max(fiftyTwoWeekHigh - fiftyTwoWeekLow, 1)) * 100, 0, 100);
  const scaleScore = clamp((Math.log10(Math.max(inst.marketCap ?? 1, 1)) - 4) / 2 * 100, 0, 100);

  const investabilityScore = round2(
    valueScore * 0.2 + growthScore * 0.2 + profitabilityScore * 0.2 + safetyScore * 0.15 + momentumScore * 0.15 + scaleScore * 0.1,
  );
  const grade = investabilityScore >= 85 ? 'A+' : investabilityScore >= 70 ? 'A' : investabilityScore >= 55 ? 'B' : 'C';

  const fundamentals: Fundamentals = {
    instrumentId: inst.id,
    sector: inst.sector,
    industry: inst.industry,
    description: DESCRIPTION_TEMPLATES[rng.int(0, DESCRIPTION_TEMPLATES.length - 1)]
      .replace('{industry}', (inst.industry ?? 'industrial').toLowerCase())
      .replace('{sector}', (inst.sector ?? 'industrial').toLowerCase()),
    marketCap: inst.marketCap ?? 0,
    pe, pb, ps, peg,
    roe, roce: round2(roe * rng.range(0.85, 1.15)), roa: round2(roe * rng.range(0.35, 0.55)),
    debtToEquity, currentRatio, quickRatio,
    grossMargin, operatingMargin, netMargin,
    revenue, revenueGrowth, netIncome, netIncomeGrowth,
    employees, dividendYield, eps, bookValue, beta,
    fiftyTwoWeekHigh, fiftyTwoWeekLow, avgVolume,
    promoterHolding, fiiHolding,
    investabilityScore, investabilityGrade: grade,
  };

  // ---- supply-chain / ownership graph ----
  const relations: CompanyRelation[] = [];
  const pick = (arr: string[], n: number): string[] => {
    const copy = [...arr];
    const out: string[] = [];
    while (out.length < Math.min(n, copy.length)) {
      const i = rng.int(0, copy.length - 1);
      out.push(copy.splice(i, 1)[0]);
    }
    return out;
  };

  for (const name of pick(pool.suppliers, 4)) {
    relations.push({
      id: 0, instrumentId: inst.id, relationType: 'SUPPLIER', entityName: name,
      entitySymbol: null, weight: round2(rng.range(3, 18)), note: 'Key raw-material / services supplier',
    });
  }
  for (const name of pick(pool.vendors, 3)) {
    relations.push({
      id: 0, instrumentId: inst.id, relationType: 'VENDOR', entityName: name,
      entitySymbol: null, weight: round2(rng.range(2, 14)), note: 'Distribution / channel partner',
    });
  }
  for (const name of pick(pool.buyers, 4)) {
    relations.push({
      id: 0, instrumentId: inst.id, relationType: 'BUYER', entityName: name,
      entitySymbol: null, weight: round2(rng.range(4, 25)), note: 'Major customer segment',
    });
  }
  const sameSectorPeers = peers.filter((p) => p.id !== inst.id && p.sector === inst.sector);
  for (const peer of pick(sameSectorPeers.map((p) => p.name), 3)) {
    const sym = sameSectorPeers.find((p) => p.name === peer)?.symbol ?? null;
    relations.push({
      id: 0, instrumentId: inst.id, relationType: 'PEER', entityName: peer,
      entitySymbol: sym, weight: round2(rng.range(5, 25)), note: 'Direct listed competitor',
    });
  }
  for (const name of pick(pool.subsidiaries, 2)) {
    relations.push({
      id: 0, instrumentId: inst.id, relationType: 'SUBSIDIARY', entityName: name,
      entitySymbol: null, weight: round2(rng.range(10, 30)), note: 'Wholly-owned / major subsidiary',
    });
  }

  return { fundamentals, relations };
}
