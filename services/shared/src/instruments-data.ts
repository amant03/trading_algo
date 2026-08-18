export interface InstrumentSeed {
  symbol: string;
  name: string;
  exchange: string;
  segment: string;
  sector: string;
  industry: string;
  basePrice: number;
  lotSize: number;
  marketCapCr: number; // INR crores
  volatility: number; // daily stdev of returns
}

/** NIFTY 50 + select heavyweights. Prices are representative baseline values. */
export const INSTRUMENTS: InstrumentSeed[] = [
  { symbol: 'RELIANCE', name: 'Reliance Industries Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Energy', industry: 'Conglomerate / Oil & Gas', basePrice: 2950, lotSize: 1, marketCapCr: 1985000, volatility: 0.016 },
  { symbol: 'TCS', name: 'Tata Consultancy Services Ltd', exchange: 'NSE', segment: 'EQ', sector: 'IT', industry: 'IT Services', basePrice: 4200, lotSize: 1, marketCapCr: 1518000, volatility: 0.013 },
  { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Banking', industry: 'Private Bank', basePrice: 1650, lotSize: 1, marketCapCr: 1250000, volatility: 0.014 },
  { symbol: 'ICICIBANK', name: 'ICICI Bank Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Banking', industry: 'Private Bank', basePrice: 1150, lotSize: 1, marketCapCr: 805000, volatility: 0.015 },
  { symbol: 'INFY', name: 'Infosys Ltd', exchange: 'NSE', segment: 'EQ', sector: 'IT', industry: 'IT Services', basePrice: 1780, lotSize: 1, marketCapCr: 738000, volatility: 0.016 },
  { symbol: 'ITC', name: 'ITC Ltd', exchange: 'NSE', segment: 'EQ', sector: 'FMCG', industry: 'Diversified FMCG', basePrice: 468, lotSize: 1, marketCapCr: 584000, volatility: 0.012 },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Telecom', industry: 'Telecom Services', basePrice: 1450, lotSize: 1, marketCapCr: 815000, volatility: 0.015 },
  { symbol: 'SBIN', name: 'State Bank of India', exchange: 'NSE', segment: 'EQ', sector: 'Banking', industry: 'PSU Bank', basePrice: 830, lotSize: 1, marketCapCr: 740000, volatility: 0.017 },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Banking', industry: 'Private Bank', basePrice: 1800, lotSize: 1, marketCapCr: 358000, volatility: 0.016 },
  { symbol: 'AXISBANK', name: 'Axis Bank Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Banking', industry: 'Private Bank', basePrice: 1150, lotSize: 1, marketCapCr: 355000, volatility: 0.017 },
  { symbol: 'LT', name: 'Larsen & Toubro Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Capital Goods', industry: 'Engineering & Construction', basePrice: 3500, lotSize: 1, marketCapCr: 485000, volatility: 0.015 },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever Ltd', exchange: 'NSE', segment: 'EQ', sector: 'FMCG', industry: 'Household & Personal Care', basePrice: 2450, lotSize: 1, marketCapCr: 576000, volatility: 0.012 },
  { symbol: 'ITC', name: 'ITC Ltd', exchange: 'NSE', segment: 'EQ', sector: 'FMCG', industry: 'Cigarettes & FMCG', basePrice: 468, lotSize: 1, marketCapCr: 584000, volatility: 0.012 },
  { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical Industries', exchange: 'NSE', segment: 'EQ', sector: 'Pharma', industry: 'Pharmaceuticals', basePrice: 1680, lotSize: 1, marketCapCr: 402000, volatility: 0.016 },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Financials', industry: 'NBFC', basePrice: 7200, lotSize: 1, marketCapCr: 445000, volatility: 0.02 },
  { symbol: 'MARUTI', name: 'Maruti Suzuki India Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Auto', industry: 'Passenger Vehicles', basePrice: 12800, lotSize: 1, marketCapCr: 402000, volatility: 0.015 },
  { symbol: 'TITAN', name: 'Titan Company Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Consumer', industry: 'Jewellery & Watches', basePrice: 3450, lotSize: 1, marketCapCr: 306000, volatility: 0.016 },
  { symbol: 'ASIANPAINT', name: 'Asian Paints Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Consumer', industry: 'Paints', basePrice: 2850, lotSize: 1, marketCapCr: 273000, volatility: 0.014 },
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Cement', industry: 'Cement', basePrice: 11400, lotSize: 1, marketCapCr: 329000, volatility: 0.015 },
  { symbol: 'NTPC', name: 'NTPC Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Power', industry: 'Power Generation', basePrice: 370, lotSize: 1, marketCapCr: 358000, volatility: 0.014 },
  { symbol: 'ADANIENT', name: 'Adani Enterprises Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Conglomerate', industry: 'Diversified', basePrice: 3100, lotSize: 1, marketCapCr: 380000, volatility: 0.025 },
  { symbol: 'ADANIPORTS', name: 'Adani Ports & SEZ Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Infrastructure', industry: 'Ports', basePrice: 1400, lotSize: 1, marketCapCr: 302000, volatility: 0.022 },
  { symbol: 'POWERGRID', name: 'Power Grid Corp of India', exchange: 'NSE', segment: 'EQ', sector: 'Power', industry: 'Power Transmission', basePrice: 320, lotSize: 1, marketCapCr: 297000, volatility: 0.013 },
  { symbol: 'ONGC', name: 'Oil & Natural Gas Corp Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Energy', industry: 'Oil & Gas Exploration', basePrice: 285, lotSize: 1, marketCapCr: 358000, volatility: 0.016 },
  { symbol: 'TATAMOTORS', name: 'Tata Motors Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Auto', industry: 'Automobiles', basePrice: 980, lotSize: 1, marketCapCr: 335000, volatility: 0.022 },
  { symbol: 'TATASTEEL', name: 'Tata Steel Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Metals', industry: 'Steel', basePrice: 165, lotSize: 1, marketCapCr: 205000, volatility: 0.02 },
  { symbol: 'JSWSTEEL', name: 'JSW Steel Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Metals', industry: 'Steel', basePrice: 950, lotSize: 1, marketCapCr: 232000, volatility: 0.018 },
  { symbol: 'WIPRO', name: 'Wipro Ltd', exchange: 'NSE', segment: 'EQ', sector: 'IT', industry: 'IT Services', basePrice: 530, lotSize: 1, marketCapCr: 277000, volatility: 0.016 },
  { symbol: 'TECHM', name: 'Tech Mahindra Ltd', exchange: 'NSE', segment: 'EQ', sector: 'IT', industry: 'IT Services', basePrice: 1700, lotSize: 1, marketCapCr: 165000, volatility: 0.018 },
  { symbol: 'HCLTECH', name: 'HCL Technologies Ltd', exchange: 'NSE', segment: 'EQ', sector: 'IT', industry: 'IT Services', basePrice: 1580, lotSize: 1, marketCapCr: 428000, volatility: 0.015 },
  { symbol: 'NESTLEIND', name: 'Nestle India Ltd', exchange: 'NSE', segment: 'EQ', sector: 'FMCG', industry: 'Food & Beverage', basePrice: 2500, lotSize: 1, marketCapCr: 241000, volatility: 0.011 },
  { symbol: 'M&M', name: 'Mahindra & Mahindra Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Auto', industry: 'Automobiles', basePrice: 2900, lotSize: 1, marketCapCr: 360000, volatility: 0.017 },
  { symbol: 'TATACONSUM', name: 'Tata Consumer Products Ltd', exchange: 'NSE', segment: 'EQ', sector: 'FMCG', industry: 'Food & Beverage', basePrice: 1100, lotSize: 1, marketCapCr: 108000, volatility: 0.014 },
  { symbol: 'BAJAJFINSV', name: 'Bajaj Finserv Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Financials', industry: 'Financial Holding', basePrice: 1650, lotSize: 1, marketCapCr: 263000, volatility: 0.018 },
  { symbol: 'HDFCLIFE', name: 'HDFC Life Insurance Co', exchange: 'NSE', segment: 'EQ', sector: 'Insurance', industry: 'Life Insurance', basePrice: 620, lotSize: 1, marketCapCr: 133000, volatility: 0.016 },
  { symbol: 'SBILIFE', name: 'SBI Life Insurance Co', exchange: 'NSE', segment: 'EQ', sector: 'Insurance', industry: 'Life Insurance', basePrice: 1500, lotSize: 1, marketCapCr: 150000, volatility: 0.016 },
  { symbol: 'DRREDDY', name: "Dr. Reddy's Laboratories Ltd", exchange: 'NSE', segment: 'EQ', sector: 'Pharma', industry: 'Pharmaceuticals', basePrice: 1250, lotSize: 1, marketCapCr: 208000, volatility: 0.017 },
  { symbol: 'CIPLA', name: 'Cipla Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Pharma', industry: 'Pharmaceuticals', basePrice: 1520, lotSize: 1, marketCapCr: 122000, volatility: 0.016 },
  { symbol: 'APOLLOHOSP', name: 'Apollo Hospitals Enterprise', exchange: 'NSE', segment: 'EQ', sector: 'Healthcare', industry: 'Hospitals', basePrice: 6400, lotSize: 1, marketCapCr: 92000, volatility: 0.017 },
  { symbol: 'GRASIM', name: 'Grasim Industries Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Cement', industry: 'Diversified', basePrice: 2600, lotSize: 1, marketCapCr: 173000, volatility: 0.016 },
  { symbol: 'HINDALCO', name: 'Hindalco Industries Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Metals', industry: 'Aluminium', basePrice: 660, lotSize: 1, marketCapCr: 147000, volatility: 0.02 },
  { symbol: 'BPCL', name: 'Bharat Petroleum Corp Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Energy', industry: 'Oil Refining & Marketing', basePrice: 330, lotSize: 1, marketCapCr: 143000, volatility: 0.017 },
  { symbol: 'COALINDIA', name: 'Coal India Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Energy', industry: 'Coal Mining', basePrice: 470, lotSize: 1, marketCapCr: 290000, volatility: 0.016 },
  { symbol: 'EICHERMOT', name: 'Eicher Motors Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Auto', industry: 'Two-wheelers', basePrice: 4800, lotSize: 1, marketCapCr: 131000, volatility: 0.017 },
  { symbol: 'HEROMOTOCO', name: 'Hero MotoCorp Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Auto', industry: 'Two-wheelers', basePrice: 5100, lotSize: 1, marketCapCr: 102000, volatility: 0.015 },
  { symbol: 'INDUSINDBK', name: 'IndusInd Bank Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Banking', industry: 'Private Bank', basePrice: 1450, lotSize: 1, marketCapCr: 113000, volatility: 0.02 },
  { symbol: 'BRITANNIA', name: 'Britannia Industries Ltd', exchange: 'NSE', segment: 'EQ', sector: 'FMCG', industry: 'Food & Beverage', basePrice: 5550, lotSize: 1, marketCapCr: 133000, volatility: 0.012 },
  { symbol: 'DIVISLAB', name: 'Divi\'s Laboratories Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Pharma', industry: 'Pharmaceuticals', basePrice: 5200, lotSize: 1, marketCapCr: 138000, volatility: 0.018 },
  { symbol: 'BAJAJ-AUTO', name: 'Bajaj Auto Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Auto', industry: 'Two/Three-wheelers', basePrice: 9200, lotSize: 1, marketCapCr: 262000, volatility: 0.015 },
  { symbol: 'TATAPOWER', name: 'Tata Power Co Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Power', industry: 'Power Generation & Dist', basePrice: 430, lotSize: 1, marketCapCr: 137000, volatility: 0.019 },
  { symbol: 'IRCTC', name: 'Indian Railway Catering & Tourism Corp', exchange: 'NSE', segment: 'EQ', sector: 'Travel', industry: 'Travel & Tourism', basePrice: 980, lotSize: 1, marketCapCr: 78400, volatility: 0.02 },
  { symbol: 'IDEA', name: 'Vodafone Idea Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Telecom', industry: 'Telecom Services', basePrice: 13, lotSize: 1, marketCapCr: 89000, volatility: 0.03 },
  { symbol: 'HAL', name: 'Hindustan Aeronautics Ltd', exchange: 'NSE', segment: 'EQ', sector: 'Defence', industry: 'Aerospace & Defence', basePrice: 4800, lotSize: 1, marketCapCr: 320000, volatility: 0.02 },
];
